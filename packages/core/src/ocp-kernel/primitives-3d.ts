/**
 * OCP Kernel 3D primitives — box, cylinder, sphere.
 * Uses occt-wasm: makeBox, makeCylinder, makeSphere + translate for centering.
 */

import type { WpState, Shape } from './types.js';
import { cloneState } from './types.js';
import { pushWarning } from '../diagnostics.js';
import { alignZToDir } from './geometry.js';

/** Guard: ensure all dimensions are positive and finite. */
function requirePositive(name: string, ...values: number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`${name}: dimensions must be positive (got ${v})`);
    }
  }
}

export type Center3 = [boolean, boolean, boolean];

export function wpBox(s: WpState, w: number, h: number, d: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('box', w, h, d);
  const { oc } = s;
  let shape = oc.makeBox(w, h, d);
  const tx = center[0] ? -w / 2 : 0;
  const ty = center[1] ? -h / 2 : 0;
  const tz = center[2] ? -d / 2 : 0;
  shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpCylinder(
  s: WpState, h: number, r: number,
  center: Center3 = [true, true, true],
  dir?: [number, number, number] | null,
  pnt?: [number, number, number] | null,
): WpState {
  requirePositive('cylinder', h, r);
  const { oc } = s;
  let shape = oc.makeCylinder(r, h);
  // 1. centering (Z-axis-relative, before rotation)
  const tx = center[0] ? 0 : r;
  const ty = center[1] ? 0 : r;
  const tz = center[2] ? -h / 2 : 0;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  // 2. dir rotation
  if (dir) shape = alignZToDir(oc, shape, dir);
  // 3. pnt translation
  if (pnt) shape = oc.translate(shape, pnt[0], pnt[1], pnt[2]);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpSphere(s: WpState, r: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('sphere', r);
  const { oc } = s;
  let shape = oc.makeSphere(r);
  const tx = center[0] ? 0 : r;
  const ty = center[1] ? 0 : r;
  const tz = center[2] ? 0 : r;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpCone(
  s: WpState, height: number, r1: number, r2: number,
  center: Center3 = [true, true, true],
  dir?: [number, number, number] | null,
  pnt?: [number, number, number] | null,
): WpState {
  requirePositive('cone', height);
  if (!Number.isFinite(r1) || r1 < 0 || !Number.isFinite(r2) || r2 < 0 || (r1 === 0 && r2 === 0)) {
    throw new Error(`cone: at least one radius must be positive`);
  }
  const { oc } = s;
  const maxR = Math.max(r1, r2);
  let shape = oc.makeCone(r1, r2, height);
  // 1. centering (Z-axis-relative, before rotation)
  const tx = center[0] ? 0 : maxR;
  const ty = center[1] ? 0 : maxR;
  const tz = center[2] ? -height / 2 : 0;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  // 2. dir rotation
  if (dir) shape = alignZToDir(oc, shape, dir);
  // 3. pnt translation
  if (pnt) shape = oc.translate(shape, pnt[0], pnt[1], pnt[2]);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpTorus(s: WpState, r1: number, r2: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('torus', r1, r2);
  const { oc } = s;
  let shape = oc.makeTorus(r1, r2);
  const tx = center[0] ? 0 : r1 + r2;
  const ty = center[1] ? 0 : r1 + r2;
  const tz = center[2] ? 0 : r2;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpWedge(s: WpState, dx: number, dy: number, dz: number, ltx: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('wedge', dx, dy, dz);
  const { oc } = s;
  // Build wedge via loft: bottom rect (dx × dz) at y=0 → top rect (ltx × dz) at y=dy.
  // OCC MakeWedge convention: base on XZ plane, height along Y.
  const bottomWire = oc.makeWire([
    oc.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: dx, y: 0, z: 0 }),
    oc.makeLineEdge({ x: dx, y: 0, z: 0 }, { x: dx, y: 0, z: dz }),
    oc.makeLineEdge({ x: dx, y: 0, z: dz }, { x: 0, y: 0, z: dz }),
    oc.makeLineEdge({ x: 0, y: 0, z: dz }, { x: 0, y: 0, z: 0 }),
  ]);
  const xOff = (dx - ltx) / 2;
  const topWire = oc.makeWire([
    oc.makeLineEdge({ x: xOff, y: dy, z: 0 }, { x: xOff + ltx, y: dy, z: 0 }),
    oc.makeLineEdge({ x: xOff + ltx, y: dy, z: 0 }, { x: xOff + ltx, y: dy, z: dz }),
    oc.makeLineEdge({ x: xOff + ltx, y: dy, z: dz }, { x: xOff, y: dy, z: dz }),
    oc.makeLineEdge({ x: xOff, y: dy, z: dz }, { x: xOff, y: dy, z: 0 }),
  ]);
  let shape = oc.loft([bottomWire, topWire], true, false);
  const tx = center[0] ? -dx / 2 : 0;
  const ty = center[1] ? -dy / 2 : 0;
  const tz = center[2] ? -dz / 2 : 0;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}

/**
 * External V thread, centred like `cylinder` (z from -h/2 to h/2 unless
 * `center` says otherwise). Built directly as a B-Rep rather than as a
 * cylinder minus a swept groove: per turn, three ruled faces between
 * one-turn helix edges (the crest land on the cylinder and the two flanks);
 * consecutive turns share their helix geometry, so sewing joins them exactly.
 * Each end is closed with a ruled face from the end helix to the axis plus a
 * planar wedge in the profile's half-plane, which gives a closed solid with
 * no boolean. The ends are then trimmed to [0, h] by two small cuts. The
 * swept-groove construction instead spent its time projecting every edge
 * onto a thread-long B-spline face.
 */
export function wpThread(
  s: WpState, r: number, pitch: number, h: number,
  opts: { depth: number; land: number; chamfer: { bottom: number; top: number } },
  center: Center3 = [true, true, true],
): WpState {
  requirePositive('thread', r, pitch, h);
  const { depth, land, chamfer } = opts;
  if (!Number.isFinite(depth) || depth <= 0 || depth >= r) {
    throw new Error(`thread: depth (${depth}) must be between 0 and r (${r}) -- reduce depth, or increase r; the default is (pitch - land) / 2 * sqrt(3), so a pitch this large needs a bigger r`);
  }
  if (!Number.isFinite(land) || land < 0 || land >= pitch) {
    throw new Error(`thread: land (${land}) must be between 0 and pitch (${pitch}) -- the crest flat cannot be wider than the pitch; reduce land`);
  }
  for (const c of [chamfer.bottom, chamfer.top]) {
    if (!Number.isFinite(c) || c < 0 || c >= r) {
      throw new Error(`thread: chamfer (${c}) must be between 0 and r (${r}) -- the 45-degree chamfer cannot reach the axis; reduce chamfer`);
    }
  }
  if (h < pitch) {
    pushWarning(
      `thread: h (${h}) is shorter than pitch (${pitch}) -- the thread has less than one turn`,
      { code: 'thread.short', hint: 'if a longer thread was meant, the arguments are r pitch h; check whether pitch and h are swapped' },
    );
  }
  const { oc } = s;
  const Z = { x: 0, y: 0, z: 1 };
  const hw = (pitch - land) / 2;
  // profile per period as (rho, z) from (r, 0); the period closes at (r, pitch).
  // With land = 0 the crest is sharp and the first segment disappears.
  const prof: [number, number][] = land > 0 ? [[r, 0], [r, land], [r - depth, land + hw]] : [[r, 0], [r - depth, hw]];
  // One turn of each helix is built once and translated per turn: every
  // turn's helix at a given radius is the previous one shifted by one pitch.
  const base = prof.map(([rho, z]) => oc.getSubShapes(oc.makeHelixWire({ x: 0, y: 0, z }, Z, pitch, pitch, rho), 'edge')[0]);
  const helixAt = (i: number, k: number) => (k === 0 ? base[i] : oc.translate(base[i], 0, 0, k * pitch));
  // turns: one below z = 0 so the bottom closure lies under the cut, and past the top
  const k0 = -1;
  const k1 = Math.ceil((h + pitch) / pitch);
  const E: Shape[][] = [];
  for (let k = k0; k <= k1 + 1; k++) {
    const n = k === k1 + 1 ? 1 : prof.length;
    E.push(prof.slice(0, n).map((_, i) => helixAt(i, k)));
  }
  const faces: Shape[] = [];
  for (let k = k0; k <= k1; k++) {
    const ek = E[k - k0];
    for (let i = 0; i + 1 < ek.length; i++) faces.push(oc.makeRuledFace(ek[i], ek[i + 1]));
    faces.push(oc.makeRuledFace(ek[ek.length - 1], E[k - k0 + 1][0]));
  }
  const closure = (helix: Shape, zb: number) => {
    faces.push(oc.makeRuledFace(helix, oc.makeLineEdge({ x: 0, y: 0, z: zb }, { x: 0, y: 0, z: zb + pitch })));
    const pts = [...prof.map(([rho, z]) => ({ x: rho, y: 0, z: zb + z })),
      { x: r, y: 0, z: zb + pitch }, { x: 0, y: 0, z: zb + pitch }, { x: 0, y: 0, z: zb }];
    const edges = pts.map((p, i) => oc.makeLineEdge(p, pts[(i + 1) % pts.length]));
    faces.push(oc.makeFace(oc.makeWire(edges)));
  };
  closure(E[0][0], k0 * pitch);
  closure(E[k1 - k0 + 1][0], (k1 + 1) * pitch);
  // sewing can hand the shell back inside out; the booleans need it outward
  const solid = oc.orientClosedSolid(oc.sewAndSolidify(faces, 1e-5));
  // Trim to [0, h] by cutting the two ends off instead of intersecting with a
  // full-height clip: a cutter's bounding box then overlaps only the few
  // one-turn faces near its plane, not every face along the thread. With a
  // chamfer c, the cutter also takes the material outside the 45-degree cone
  // through (r, c from the end): a cylinder with the cone removed.
  const top = (k1 + 2) * pitch + 1; // past the solid's highest point
  const { bottom: cb, top: ct } = chamfer;
  // without a chamfer the cutter starts at the end plane; with one it starts a
  // unit beyond the cone's base so the cone can be subtracted from it cleanly
  const aboveStart = ct > 0 ? h - ct - 1 : h;
  let above = oc.translate(oc.makeCylinder(r + 1, top - aboveStart), 0, 0, aboveStart);
  if (ct > 0) above = oc.cut(above, oc.translate(oc.makeCone(r + 1, r - ct, ct + 1), 0, 0, aboveStart));
  const belowEnd = cb > 0 ? cb + 1 : 0;
  let below = oc.translate(oc.makeCylinder(r + 1, belowEnd + 2 * pitch), 0, 0, -2 * pitch);
  if (cb > 0) below = oc.cut(below, oc.makeCone(r - cb, r + 1, cb + 1));
  const trimmed = oc.cut(oc.cut(solid, below), above);
  const solids = oc.getSubShapes(trimmed, 'solid');
  if (solids.length !== 1) {
    throw new Error(`thread: trimming the ends left ${solids.length} solids -- the groove must not reach the axis; check depth against r`);
  }
  let shape = solids[0];
  const tz = center[2] ? -h / 2 : 0;
  if (tz !== 0) shape = oc.translate(shape, 0, 0, tz);
  return cloneState(s, { shape, faces: [], wires: [], selectedFaces: [], selectedEdges: [] });
}
