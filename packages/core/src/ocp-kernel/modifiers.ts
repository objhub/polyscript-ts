/**
 * OCP Kernel modifiers — fillet, chamfer, shell, offset.
 * Uses occt-wasm: kernel.fillet(), kernel.chamfer(), kernel.shell(), kernel.offsetWire2D(), kernel.outerWire().
 */

import type { JoinType } from 'occt-wasm';
import type { OC, Shape, Wire, Pnt, WpState } from './types.js';
import { cloneState } from './types.js';
import { getEdges, } from './geometry.js';
import { makeFaceFromWire, makeWireFromPoints } from './builders.js';
import { wpWorkplane } from './selection.js';

/**
 * Get edges to fillet/chamfer. Priority:
 * 1. Explicitly selected edges
 * 2. Edges derived from selected faces
 * 3. All edges of the shape
 */
function resolveEdges(oc: OC, s: WpState): any[] {
  if (s.selectedEdges.length > 0) {
    return s.selectedEdges;
  }
  if (s.selectedFaces.length > 0) {
    const edgeSet = new Set<any>();
    for (const face of s.selectedFaces) {
      for (const edge of oc.getSubShapes(face, 'edge')) {
        edgeSet.add(edge);
      }
    }
    return [...edgeSet];
  }
  return getEdges(oc, s.shape!);
}

/**
 * Apply fillet/chamfer with fallback: try all edges at once, then one-by-one.
 * OCCT sometimes fails on batch operations but succeeds per-edge.
 */
function applyEdgeOp(
  _oc: OC, shape: Shape, edges: any[],
  op: (s: Shape, e: any[], v: number) => Shape, value: number,
): Shape {
  try {
    return op(shape, edges, value);
  } catch {
    // Fallback: apply one edge at a time, skipping failures
    let result = shape;
    for (const edge of edges) {
      try {
        result = op(result, [edge], value);
      } catch {
        // Skip edges that can't be filleted/chamfered
      }
    }
    return result;
  }
}

/** Round all corners of a closed wire by `r` via the facade's
 * BRepFilletAPI_MakeFillet2d wrapper. Falls back to the input wire on failure. */
function fillet2DWire(oc: OC, wire: Wire, r: number): Wire {
  if (r <= 0) return wire;
  try {
    return oc.fillet2D(wire, r);
  } catch {
    return wire;
  }
}

export function wpFillet(s: WpState, r: number): WpState {
  const { oc } = s;
  // 2D context: round corners of each wire (and any face2D) via facade fillet2D.
  if (!s.shape) {
    if (!s.wires.length && !s.face2D) throw new Error('fillet: no shape in context');
    const newWires = s.wires.map(w => fillet2DWire(oc, w, r));
    let newFace2D = s.face2D;
    if (newFace2D) {
      const wires = oc.getSubShapes(newFace2D, 'wire');
      if (wires.length === 1) {
        newFace2D = makeFaceFromWire(oc, fillet2DWire(oc, wires[0], r));
      } else if (wires.length > 1) {
        const faces = wires.map(w => makeFaceFromWire(oc, fillet2DWire(oc, w, r)));
        newFace2D = faces.length === 1 ? faces[0] : oc.fuseAll(faces);
      }
    }
    return cloneState(s, { wires: newWires, face2D: newFace2D });
  }
  const edges = resolveEdges(oc, s);
  if (edges.length === 0) throw new Error('fillet: no edges to fillet');
  const shape = applyEdgeOp(oc, s.shape, edges,
    (s, e, v) => oc.fillet(s, e, v), r);
  return cloneState(s, { shape, selectedFaces: [], selectedEdges: [] });
}

export function wpChamfer(s: WpState, d: number): WpState {
  const { oc } = s;
  if (!s.shape) throw new Error('chamfer: no shape in context');
  const edges = resolveEdges(oc, s);
  if (edges.length === 0) throw new Error('chamfer: no edges to chamfer');
  const shape = applyEdgeOp(oc, s.shape, edges,
    (s, e, v) => oc.chamfer(s, e, v), d);
  return cloneState(s, { shape, selectedFaces: [], selectedEdges: [] });
}

export function wpShell(s: WpState, thickness: number): WpState {
  const { oc } = s;
  if (!s.shape) throw new Error('shell: no shape in context');
  // occt-wasm negates the offset itself, so a positive thickness hollows
  // inward (the CadQuery convention). 1e-3 matches the Python oracle's
  // MakeThickSolidByJoin tolerance; 1e-6 would change the topology.
  const shape = oc.shell(s.shape, s.selectedFaces, thickness, 1e-3);
  return cloneState(s, { shape, selectedFaces: [], selectedEdges: [] });
}

// ---------------------------------------------------------------------------
// Open-wire offset with square caps (cut approach)
// ---------------------------------------------------------------------------

/** Get ordered vertex points from a wire, removing consecutive duplicates. */
function getWirePoints(oc: OC, wire: Wire): Pnt[] {
  const vertices = oc.getSubShapes(wire, 'vertex');
  const points: Pnt[] = [];
  for (const v of vertices) {
    const p = oc.vertexPosition(v);
    if (points.length > 0) {
      const prev = points[points.length - 1];
      if (Math.abs(p.x - prev.x) < 1e-8 && Math.abs(p.y - prev.y) < 1e-8 && Math.abs(p.z - prev.z) < 1e-8) continue;
    }
    points.push(p);
  }
  return points;
}

function isWireClosed(points: Pnt[]): boolean {
  if (points.length < 3) return false;
  const f = points[0], l = points[points.length - 1];
  return Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6 && Math.abs(f.z - l.z) < 1e-6;
}

/**
 * Trim round caps from an offset wire using boolean cut.
 * 1. offsetWire2D → closed wire with round caps
 * 2. makeFace → planar face
 * 3. At each endpoint, build a cutting half-plane (large rect perpendicular to tangent)
 * 4. cut face by half-planes → square caps
 * 5. outerWire → result wire
 */
function trimRoundCaps(oc: OC, wire: Wire, offsetWire: Wire, distance: number): Wire {
  const points = getWirePoints(oc, wire);
  const n = points.length;
  const d = Math.abs(distance);
  const z = points[0].z;
  // Large enough to cover offset area
  const big = d * 4;

  // Start tangent: direction from first to second point
  const sdx = points[1].x - points[0].x;
  const sdy = points[1].y - points[0].y;
  const slen = Math.sqrt(sdx * sdx + sdy * sdy);
  const stx = sdx / slen, sty = sdy / slen; // tangent at start (inward)

  // End tangent: direction from second-to-last to last point
  const edx = points[n - 1].x - points[n - 2].x;
  const edy = points[n - 1].y - points[n - 2].y;
  const elen = Math.sqrt(edx * edx + edy * edy);
  const etx = edx / elen, ety = edy / elen; // tangent at end (inward)

  // Build cutting rect at start: centered on start point, extending outward from tangent
  // The rect is perpendicular to tangent, on the "outside" (behind start point)
  const sp = points[0];
  const startRect = makeWireFromPoints(oc, [
    { x: sp.x - stx * big - sty * big, y: sp.y - sty * big + stx * big, z },
    { x: sp.x - stx * big + sty * big, y: sp.y - sty * big - stx * big, z },
    { x: sp.x              + sty * big, y: sp.y              - stx * big, z },
    { x: sp.x              - sty * big, y: sp.y              + stx * big, z },
  ], true);

  // Build cutting rect at end: centered on end point, extending outward
  const ep = points[n - 1];
  const endRect = makeWireFromPoints(oc, [
    { x: ep.x              - ety * big, y: ep.y              + etx * big, z },
    { x: ep.x              + ety * big, y: ep.y              - etx * big, z },
    { x: ep.x + etx * big + ety * big, y: ep.y + ety * big - etx * big, z },
    { x: ep.x + etx * big - ety * big, y: ep.y + ety * big + etx * big, z },
  ], true);

  let face: Shape = oc.makeFace(offsetWire);
  const startFace = oc.makeFace(startRect);
  const endFace = oc.makeFace(endRect);
  face = oc.cut(face, startFace);
  face = oc.cut(face, endFace);

  // Extract the outer wire from the result
  const faces = oc.getSubShapes(face, 'face');
  if (faces.length > 0) {
    return oc.outerWire(faces[0]);
  }
  // face may be a compound after boolean cut; outerWire expects a face-like shape
  return oc.outerWire(face);
}

// ---------------------------------------------------------------------------
// wpOffset
// ---------------------------------------------------------------------------

/**
 * 2D wire offset.
 *
 * Works in two contexts:
 * 1. **Face selection** — extracts the outer wire of the first selected face,
 *    creates a workplane on that face, then offsets the wire.
 * 2. **2D context** — offsets existing wires on the current workplane.
 *
 * Positive distance = outward, negative = inward.
 * cap: "square" for perpendicular end caps on open wires (default "round").
 */
export function wpOffset(s: WpState, distance: number, joinType?: JoinType, cap?: string): WpState {
  const { oc } = s;

  // Face selection context: extract outer wire and create workplane
  if (s.selectedFaces.length > 0) {
    const face = s.selectedFaces[0];
    const outerWire = oc.outerWire(face);
    // Create workplane from the face (sets plane, clears wires)
    const wpState = wpWorkplane(s);
    // Offset the extracted wire (always closed, cap irrelevant)
    const offsetWire = oc.offsetWire2D(outerWire, distance, joinType);
    return cloneState(wpState, { wires: [offsetWire] });
  }

  // 2D context: offset existing wires
  if (s.wires.length === 0) {
    throw new Error('offset: no wires or selected faces in context');
  }

  const newWires: Wire[] = [];
  for (const wire of s.wires) {
    const offsetWire = oc.offsetWire2D(wire, distance, joinType);
    if (cap === 'square') {
      const points = getWirePoints(oc, wire);
      if (!isWireClosed(points)) {
        newWires.push(trimRoundCaps(oc, wire, offsetWire, distance));
        continue;
      }
    }
    newWires.push(offsetWire);
  }
  return cloneState(s, { wires: newWires });
}
