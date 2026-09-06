/**
 * Face / Wire coercion rules for the 2D context.
 *
 * A workplane holds two kinds of 2D things: `faces` (regions, may have holes)
 * and `wires` (curves, open or closed). The type is fixed by the constructor
 * -- `circle` is a face, `wire [...]` is a wire even when it closes -- and the
 * only implicit conversion is Face → Wire, taken where a curve is required
 * (sweep spine, profile, loft section). Nothing turns a wire into a face
 * except `offset`. See devel/2d-face-wire202609.md.
 */

import type { OC, WpState, Face, Wire, Shape, Pln } from './types.js';

/** The faces an area-consuming op (extrude, cut, revolve, loft, 2D booleans)
 * works on. Wires have no area, so leaving one in the context is an error,
 * not something to close silently. */
export function requireFaces(s: WpState, op: string): Face[] {
  if (s.wires.length > 0) {
    throw new Error(
      `${op}: a wire has no area -- the context holds ${s.wires.length} wire${s.wires.length === 1 ? '' : 's'} and no face. ` +
      `Draw a closed outline with 'sketch [...]', or give the wire a width with 'offset d'`,
    );
  }
  return s.faces;
}

/** Boundary of a face, as the wire a curve-consuming op can use. A face with
 * holes has more than one boundary, so it does not coerce. */
export function faceBoundary(oc: OC, face: Face, op: string): Wire {
  const wires = oc.getSubShapes(face, 'wire');
  if (wires.length > 1) {
    throw new Error(`${op}: a face with holes cannot be used as a wire`);
  }
  if (wires.length === 1) return wires[0];
  // Mock kernels in tests return no sub-shapes; fall back to the face handle.
  return typeof (oc as { outerWire?: unknown }).outerWire === 'function' ? oc.outerWire(face) : face;
}

/** The single wire a curve-consuming op takes from a state: the most recent
 * wire, else the boundary of the one hole-free face. Null when the context is
 * empty. */
export function stateWire(s: WpState, op: string): Wire | null {
  if (s.wires.length > 0) return s.wires[s.wires.length - 1];
  if (s.faces.length === 0) return null;
  if (s.faces.length > 1) {
    throw new Error(`${op}: needs one wire, but the context holds ${s.faces.length} faces`);
  }
  return faceBoundary(s.oc, s.faces[0], op);
}

/** Split a face-level boolean result (face or compound) into single faces. */
export function explodeFaces(oc: OC, shape: Shape | null): Face[] {
  if (!shape) return [];
  const faces = oc.getSubShapes(shape, 'face');
  return faces.length > 0 ? faces : [shape];
}

/** Fuse faces into one shape (face / compound) for a 2D boolean operand.
 * unifySameDomain merges coplanar pieces that fuse() left split. */
export function combineFaces(oc: OC, faces: Face[]): Shape | null {
  if (faces.length === 0) return null;
  if (faces.length === 1) return faces[0];
  return oc.unifySameDomain(oc.fuseAll(faces));
}

/** Outer boundary and hole wires of a face. */
export function faceWires(oc: OC, face: Face): { outer: Wire; holes: Wire[] } {
  const wires = oc.getSubShapes(face, 'wire');
  if (wires.length <= 1) {
    // Mock kernels in tests return no sub-shapes; fall back to the face handle.
    return { outer: wires[0] ?? face, holes: [] };
  }
  const outer = oc.outerWire(face);
  return { outer, holes: wires.filter(w => !oc.isSame(w, outer)) };
}

/** Rebuild a face from a filleted/offset outer wire plus its hole wires. */
export function makeFaceWithHoles(oc: OC, outer: Wire, holes: Wire[]): Face {
  const face = oc.makeFace(outer);
  if (holes.length === 0) return face;
  return oc.addHolesInFace(face, holes);
}

function samePlane(a: Pln, b: Pln): boolean {
  const eq = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) =>
    Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9 && Math.abs(p.z - q.z) < 1e-9;
  return eq(a.origin, b.origin) && eq(a.normal, b.normal) && eq(a.xDir, b.xDir);
}

/**
 * Bring a tool state's 2D content onto the plane it is being used on.
 *
 * `place (circle 3)` and `diff (circle 3)` evaluate their operand on the
 * default XY workplane, while the pipeline may be drawing on a selected face.
 * Mapping the operand's plane frame onto the target frame puts it where the
 * author drew it: at the target origin, in the target orientation.
 */
export function replaneTo(tool: WpState, target: Pln): { faces: Face[]; wires: Wire[] } {
  const { oc } = tool;
  const same = { faces: tool.faces, wires: tool.wires };
  if (samePlane(tool.plane, target)) return same;
  // Mock kernels in tests may lack the facade helper.
  if (typeof (oc as { transformShapeAx3?: unknown }).transformShapeAx3 !== 'function') return same;
  const from = { origin: tool.plane.origin, normal: tool.plane.normal, xDir: tool.plane.xDir };
  const to = { origin: target.origin, normal: target.normal, xDir: target.xDir };
  const move = <T extends Shape>(sh: T): T => oc.transformShapeAx3(sh, from, to) as T;
  return { faces: tool.faces.map(move), wires: tool.wires.map(move) };
}
