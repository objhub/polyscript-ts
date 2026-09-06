/**
 * OCP Kernel modifiers — fillet, chamfer, shell, offset.
 * Uses occt-wasm: kernel.fillet(), kernel.chamfer(), kernel.shell(), kernel.offsetWire2D(), kernel.outerWire().
 */

import type { JoinType } from 'occt-wasm';
import type { OC, Shape, Wire, Face, Pnt, WpState } from './types.js';
import { cloneState } from './types.js';
import { getEdges, } from './geometry.js';
import { makeFaceFromWire, makeWireFromPoints } from './builders.js';
import { wpWorkplane } from './selection.js';
import { makeFaceWithHoles, explodeFaces, faceWires } from './faces.js';

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
  // 2D context: round the corners of every face boundary (holes included)
  // and every wire via facade fillet2D.
  if (!s.shape) {
    if (!s.faces.length && !s.wires.length) throw new Error('fillet: no shape in context');
    const newFaces = s.faces.map(f => {
      const { outer, holes } = faceWires(oc, f);
      return makeFaceWithHoles(oc, fillet2DWire(oc, outer, r), holes.map(w => fillet2DWire(oc, w, r)));
    });
    const newWires = s.wires.map(w => fillet2DWire(oc, w, r));
    return cloneState(s, { faces: newFaces, wires: newWires });
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

/** A wire is closed when every vertex is shared by two edges: distinct vertex
 * positions then number as many as the edges (one fewer than an open chain).
 * Explorer order is not path order, so first == last is not the test. */
function isWireClosed(oc: OC, wire: Wire): boolean {
  const edges = oc.getSubShapes(wire, 'edge').length;
  if (edges === 0) return false;
  const distinct: Pnt[] = [];
  for (const v of oc.getSubShapes(wire, 'vertex')) {
    const p = oc.vertexPosition(v);
    if (!distinct.some(q => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.z - q.z) < 1e-6)) {
      distinct.push(p);
    }
  }
  return distinct.length === edges;
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
 * 2D offset.
 *
 * Works in three contexts:
 * 1. **Face selection** -- extracts the outer wire of the first selected face,
 *    creates a workplane on that face, then offsets the wire into a face.
 * 2. **Faces** -- grows (positive) or shrinks (negative) each region.
 * 3. **Wires** -- the one operation that turns a wire into a face: an open
 *    wire becomes a band of width 2|d| (cap: "square" for perpendicular ends,
 *    default round), a closed wire becomes a ring of that width.
 */
export function wpOffset(s: WpState, distance: number, joinType?: JoinType, cap?: string): WpState {
  const { oc } = s;

  // Face selection context: extract outer wire and create workplane
  if (s.selectedFaces.length > 0) {
    const face = s.selectedFaces[0];
    const outerWire = oc.outerWire(face);
    // Create workplane from the face (sets plane, clears 2D content)
    const wpState = wpWorkplane(s);
    // Offset the extracted wire (always closed, cap irrelevant)
    const offsetWire = oc.offsetWire2D(outerWire, distance, joinType);
    return cloneState(wpState, { faces: [makeFaceFromWire(oc, offsetWire)] });
  }

  if (s.faces.length === 0 && s.wires.length === 0) {
    throw new Error('offset: no wires, faces or selected faces in context');
  }

  const newFaces: Face[] = [];
  for (const face of s.faces) {
    const { outer, holes } = faceWires(oc, face);
    if (holes.length > 0) {
      throw new Error('offset: a face with holes cannot be offset yet; offset the outline before cutting the holes');
    }
    newFaces.push(makeFaceFromWire(oc, oc.offsetWire2D(outer, distance, joinType)));
  }
  for (const wire of s.wires) {
    newFaces.push(...offsetWireToFaces(oc, wire, distance, joinType, cap));
  }
  return cloneState(s, { faces: newFaces, wires: [] });
}

/** Thicken a wire into faces: a band around an open wire, a ring around a
 * closed one. The sign of the distance is irrelevant -- the material sits on
 * both sides of the curve. */
function offsetWireToFaces(oc: OC, wire: Wire, distance: number, joinType?: JoinType, cap?: string): Face[] {
  const d = Math.abs(distance);
  if (!isWireClosed(oc, wire)) {
    let contour = oc.offsetWire2D(wire, d, joinType);
    if (cap === 'square') contour = trimRoundCaps(oc, wire, contour, d);
    return [makeFaceFromWire(oc, contour)];
  }
  const outer = makeFaceFromWire(oc, oc.offsetWire2D(wire, d, joinType));
  let inner: Wire;
  try {
    inner = oc.offsetWire2D(wire, -d, joinType);
  } catch {
    // The inward offset collapsed (d exceeds the inradius): the ring is a disk.
    return [outer];
  }
  return explodeFaces(oc, oc.cut(outer, makeFaceFromWire(oc, inner)));
}
