/**
 * Planar cross sections, reported as numbers rather than drawn as a picture.
 *
 * A section is the one view where the coordinates matter: the point of cutting
 * a model open is to read a wall thickness or a bore diameter off it. So the
 * kernel's `sectionPlane` does the cutting (analytic geometry -- a cylinder
 * sections to a circle, not to a polygon), the loops are measured from the
 * curves themselves, and the SVG this module writes carries **millimetres** in
 * its path data with the display scale parked in a group transform.
 *
 * Requires occt-wasm >= 4.3.2-ps4 for `sectionPlane`.
 */

import type { OC, Shape } from './types.js';

/** Which axis the cutting plane is perpendicular to. */
export type SectionAxis = 'X' | 'Y' | 'Z';

export interface SectionSpec {
  /** Plane normal. */
  axis: SectionAxis;
  /** Position along `axis`. Omitted means the centre of the bounding box. */
  value?: number;
}

export interface SectionLoop {
  /** Ends meet, so the contour bounds an area. */
  closed: boolean;
  /** Contour in plane coordinates, in mm. */
  points: Array<[number, number]>;
  /** Enclosed area in mm². Exact when the loop could be faced (see
   *  `areaExact`), otherwise the shoelace area of `points`. */
  area: number;
  areaExact: boolean;
  /** Contour length in mm, measured on the curves, not on `points`. */
  length: number;
  bbox: { minU: number; minV: number; maxU: number; maxV: number };
}

export interface SectionResult {
  axis: SectionAxis;
  value: number;
  /** Which world axes the plane's u and v run along. */
  uAxis: SectionAxis;
  vAxis: SectionAxis;
  loops: SectionLoop[];
}

export interface SectionOptions {
  /** Curve sampling for the drawn contour, in mm. Small by default: the
   *  measurements come from the curves, but the path should not look faceted.
   *  Does not affect `area` when `areaExact`, nor `length`. */
  deflection?: number;
}

const AXES: Record<SectionAxis, { normal: [number, number, number]; u: SectionAxis; v: SectionAxis }> = {
  // u and v are chosen so the drawing stands up the way the model does.
  X: { normal: [1, 0, 0], u: 'Y', v: 'Z' },
  Y: { normal: [0, 1, 0], u: 'X', v: 'Z' },
  Z: { normal: [0, 0, 1], u: 'X', v: 'Y' },
};

const INDEX: Record<SectionAxis, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };

/** Endpoints closer than this are the same point. Sections are exact planar
 *  curves, so the gap between two edges of one loop is numerical noise. */
const JOIN_TOL = 1e-6;

function bboxCentre(oc: OC, shape: Shape, axis: SectionAxis): number {
  const bb = oc.getBoundingBox(shape);
  if (axis === 'X') return (bb.xmin + bb.xmax) / 2;
  if (axis === 'Y') return (bb.ymin + bb.ymax) / 2;
  return (bb.zmin + bb.zmax) / 2;
}

/** Drop points that sit on the straight line between their neighbours, so a
 *  box section reads as its four corners instead of every sampled vertex. */
function dropCollinear(pts: Array<[number, number]>, closed: boolean): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const keep: Array<[number, number]> = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = closed ? 0 : 1; i < last; i++) {
    const a = pts[(i - 1 + n) % n]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % n]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (Math.abs(cross) > scale * 1e-7) keep.push(b);
  }
  if (!closed) return [pts[0]!, ...keep, pts[n - 1]!];
  return keep.length >= 3 ? keep : pts;
}

function shoelace(pts: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** The exact area a closed loop of section edges bounds, or null when OCCT
 *  cannot make a face of it (an open contour, or one that self-touches). */
function facedArea(oc: OC, edges: Shape[]): number | null {
  try {
    const wire = oc.makeWire(edges);
    const face = oc.makeFace(wire);
    return oc.getSurfaceArea(face);
  } catch {
    return null;
  }
}

/** Cut `shape` with one plane and measure the contours it leaves. */
export function sectionShape(
  oc: OC,
  shape: Shape,
  spec: SectionSpec,
  options: SectionOptions = {},
): SectionResult {
  const { normal, u, v } = AXES[spec.axis];
  const value = spec.value ?? bboxCentre(oc, shape, spec.axis);
  const ni = INDEX[spec.axis];
  const origin: [number, number, number] = [0, 0, 0];
  origin[ni] = value;

  const sec = oc.sectionPlane(
    shape,
    { x: origin[0], y: origin[1], z: origin[2] },
    { x: normal[0], y: normal[1], z: normal[2] },
  );
  const edges = oc.getSubShapes(sec, 'edge');
  if (edges.length === 0) {
    return { axis: spec.axis, value, uAxis: u, vAxis: v, loops: [] };
  }

  const deflection = options.deflection ?? 1e-3;
  const ui = INDEX[u];
  const vi = INDEX[v];

  // One polyline per edge, in plane coordinates.
  interface Piece { pts: Array<[number, number]>; edge: Shape }
  const pieces: Piece[] = [];
  for (const e of edges) {
    const { points, edgeGroups } = oc.wireframe(e, deflection);
    for (let g = 0; g < edgeGroups.length; g += 3) {
      const start = edgeGroups[g]!;
      const count = edgeGroups[g + 1]!;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < count; i += 3) {
        const xyz = [points[start + i]!, points[start + i + 1]!, points[start + i + 2]!];
        pts.push([xyz[ui]!, xyz[vi]!]);
      }
      if (pts.length >= 2) pieces.push({ pts, edge: e });
    }
  }

  const near = (a: [number, number], b: [number, number]): boolean =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= JOIN_TOL;

  // Walk the pieces end to end. `sectionPlane` hands back the edges of every
  // contour in one compound with no grouping, so the loops are rebuilt here.
  const used = new Array<boolean>(pieces.length).fill(false);
  const loops: SectionLoop[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [...pieces[i]!.pts];
    const chainEdges = [pieces[i]!.edge];
    let grew = true;
    while (grew) {
      grew = false;
      const tail = chain[chain.length - 1]!;
      for (let j = 0; j < pieces.length; j++) {
        if (used[j]) continue;
        const p = pieces[j]!;
        const head = p.pts[0]!;
        const foot = p.pts[p.pts.length - 1]!;
        if (near(tail, head)) {
          chain.push(...p.pts.slice(1));
        } else if (near(tail, foot)) {
          chain.push(...p.pts.slice(0, -1).reverse());
        } else {
          continue;
        }
        used[j] = true;
        chainEdges.push(p.edge);
        grew = true;
        break;
      }
    }

    const closed = chain.length > 2 && near(chain[0]!, chain[chain.length - 1]!);
    if (closed) chain.pop();
    const pts = dropCollinear(chain, closed);
    const exact = closed ? facedArea(oc, chainEdges) : null;
    let length = 0;
    for (const e of chainEdges) length += oc.getLength(e);
    const us = pts.map((p) => p[0]);
    const vs = pts.map((p) => p[1]);
    loops.push({
      closed,
      points: pts,
      area: exact ?? (closed ? shoelace(pts) : 0),
      areaExact: exact !== null,
      length,
      bbox: {
        minU: Math.min(...us), maxU: Math.max(...us),
        minV: Math.min(...vs), maxV: Math.max(...vs),
      },
    });
  }

  // Biggest contour first: the outline, then what is cut out of it.
  loops.sort((a, b) => b.area - a.area);
  return { axis: spec.axis, value, uAxis: u, vAxis: v, loops };
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * One `<svg>` holding every section, side by side.
 *
 * Path coordinates are millimetres — `v` is negated so the drawing stands up
 * under SVG's downward y, and the only scaling lives in each group's
 * `transform`. Read a wall thickness straight out of the `d` attribute.
 */
export function sectionSVG(results: SectionResult[], scale = 2): string {
  const pad = 8;
  const panels = results.map((r) => {
    const us = r.loops.flatMap((l) => [l.bbox.minU, l.bbox.maxU]);
    const vs = r.loops.flatMap((l) => [l.bbox.minV, l.bbox.maxV]);
    const minU = us.length ? Math.min(...us) : 0;
    const maxU = us.length ? Math.max(...us) : 0;
    const minV = vs.length ? Math.min(...vs) : 0;
    const maxV = vs.length ? Math.max(...vs) : 0;
    return { r, minU, maxU, minV, maxV, w: (maxU - minU) * scale, h: (maxV - minV) * scale };
  });

  const totalW = panels.reduce((s, p) => s + p.w + pad * 2, 0);
  const totalH = Math.max(...panels.map((p) => p.h), 1) + pad * 2 + 16;

  let x = 0;
  let body = '';
  for (const p of panels) {
    const label = `${p.r.uAxis}${p.r.vAxis} @ ${p.r.axis}=${round(p.r.value)}`;
    // The group maps millimetres to pixels; the path stays in millimetres.
    body += `<g transform="translate(${round(x + pad - p.minU * scale)} `
      + `${round(pad + p.maxV * scale)}) scale(${scale} ${-scale})">`;
    for (const l of p.r.loops) {
      const d = l.points
        .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${round(pt[0])} ${round(pt[1])}`)
        .join(' ') + (l.closed ? ' Z' : '');
      body += `<path d="${d}" fill="none" stroke="#111111" stroke-width="${round(0.8 / scale)}"/>`;
    }
    body += '</g>';
    body += `<text x="${round(x + pad)}" y="${round(totalH - 4)}" font-size="11" fill="#444">${label}</text>`;
    x += p.w + pad * 2;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(totalW)}" height="${round(totalH)}" `
    + `viewBox="0 0 ${round(totalW)} ${round(totalH)}">`
    + `<rect width="${round(totalW)}" height="${round(totalH)}" fill="#ffffff"/>`
    + `${body}</svg>`;
}

/** The loop table: what the numbers say, without opening the SVG. */
export function formatSectionReport(results: SectionResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    const n = r.loops.length;
    lines.push(`section ${r.uAxis}${r.vAxis} @ ${r.axis}=${round(r.value)}: `
      + `${n} loop${n === 1 ? '' : 's'}`);
    r.loops.forEach((l, i) => {
      const w = round(l.bbox.maxU - l.bbox.minU);
      const h = round(l.bbox.maxV - l.bbox.minV);
      lines.push(`  loop ${i}: ${l.closed ? 'closed' : 'open  '}`
        + `  bbox ${w}x${h} at (${round(l.bbox.minU)},${round(l.bbox.minV)})`
        + `  area ${round(l.area)}${l.areaExact ? '' : '~'}`
        + `  length ${round(l.length)}`
        + `  points ${l.points.length}`);
    });
  }
  return lines;
}

/** Parse `xz`, `yz`, `xy`, `Z=10`, `Y=-4.5` into specs. Comma-separated. */
export function parseSectionSpecs(text: string): SectionSpec[] {
  return text.split(',').map((raw) => {
    const t = raw.trim();
    const eq = /^([XYZxyz])\s*=\s*(-?[\d.]+)$/.exec(t);
    if (eq) return { axis: eq[1]!.toUpperCase() as SectionAxis, value: Number(eq[2]) };
    const plane = t.toUpperCase();
    // A plane is named by the two axes it contains; the normal is the third.
    if (plane === 'XY' || plane === 'YX') return { axis: 'Z' as SectionAxis };
    if (plane === 'XZ' || plane === 'ZX') return { axis: 'Y' as SectionAxis };
    if (plane === 'YZ' || plane === 'ZY') return { axis: 'X' as SectionAxis };
    throw new Error(
      `unknown section plane '${t}' -- expected xy, xz, yz, or an axis value like Z=10`,
    );
  });
}
