/**
 * OCP Kernel boolean operations — diff, union, intersect.
 * Uses occt-wasm: kernel.cut(), kernel.fuse(), kernel.common().
 *
 * 3D context: operates on `s.shape`.
 * 2D context: operates face-level on wires (or `s.face2D`) and produces
 *   a `face2D` result that downstream extrude/revolve consume directly,
 *   preserving hole information (e.g. annulus from `circle 10 | diff (circle 3)`).
 */

import type { OC, WpState, Shape, Face } from './types.js';
import { cloneState } from './types.js';
import { ensureSolid } from './geometry.js';
import { makeFaceFromWire } from './builders.js';

type BoolOp = 'fuse' | 'cut' | 'common';

/**
 * Drop degenerate sliver solids that OCCT booleans leave behind.
 *
 * A last-resort safety net, deliberately conservative so it can never claim
 * legitimate geometry: a solid is dropped only when its volume is not
 * positive (inside-out/empty shells are invalid by construction) or its
 * characteristic thickness (volume / surface area) is under one micron.
 * The primary defense is modeling-side: a boolean tool should overhang the
 * surface it cuts instead of exactly touching it -- a tangent tool is what
 * generates these slivers. Mirrors _prune_debris_solids in the Python
 * kernel; the two implementations must agree for snapshot parity.
 */
export function pruneDebrisSolids(oc: OC, shape: Shape): Shape {
  const solids = oc.getSubShapes(shape, 'solid');
  if (solids.length < 2) return shape;
  const kept = solids.filter((s: Shape) => {
    const v = oc.getVolume(s);
    return v > 0 && v / Math.max(oc.getSurfaceArea(s), 1e-12) > 1e-3;
  });
  if (kept.length === solids.length || kept.length === 0) return shape;
  if (kept.length === 1) return kept[0];
  return oc.makeCompound(kept);
}


/**
 * Fuse two coplanar 2D shapes into a single face.
 *
 * fuse() splits same-dimension arguments at their intersections and returns
 * every piece, so overlapping profiles stay separate faces. Extruding that
 * gives one solid per piece, which matches by volume but is not a single
 * part -- the failure mode behind `tooth | polar n 0 orient:true | union
 * (circle r)`. unifySameDomain merges the coplanar pieces back into one face.
 */
function fuse2D(oc: OC, a: Shape, b: Shape): Shape {
  return oc.unifySameDomain(oc.fuse(a, b));
}

/** Fuse all faces in `faces` into a single shape (face / compound). */
function combineFaces(oc: OC, faces: Face[]): Shape | null {
  if (faces.length === 0) return null;
  if (faces.length === 1) return faces[0];
  return oc.unifySameDomain(oc.fuseAll(faces));
}

/** Build a 2D face shape from a workplane state's wires/face2D. */
function build2DShape(oc: OC, s: WpState): Shape | null {
  if (s.face2D) return s.face2D;
  if (s.wires.length === 0) return null;
  const faces = s.wires.map(w => makeFaceFromWire(oc, w));
  return combineFaces(oc, faces);
}

/** Apply a 2D boolean op between two states. Returns a new state with face2D set. */
function apply2DBool(s: WpState, other: WpState, op: BoolOp): WpState {
  const { oc } = s;
  const selfShape = build2DShape(oc, s);
  const otherShape = build2DShape(oc, other);
  if (!selfShape && !otherShape) return s;
  if (!selfShape) {
    if (op === 'fuse' && otherShape) {
      return cloneState(s, { face2D: otherShape, wires: [] });
    }
    return s;
  }
  if (!otherShape) return cloneState(s, { face2D: selfShape, wires: [] });
  let result: Shape;
  if (op === 'fuse') result = fuse2D(oc, selfShape, otherShape);
  else if (op === 'cut') result = oc.cut(selfShape, otherShape);
  else result = oc.common(selfShape, otherShape);
  return cloneState(s, { face2D: result, wires: [], shape: null });
}

export function wpDiff(s: WpState, other: WpState): WpState {
  const { oc } = s;
  if (other.shape && s.shape) {
    const shape = pruneDebrisSolids(oc, ensureSolid(oc, oc.cut(s.shape, other.shape)));
    return cloneState(s, { shape });
  }
  if (!s.shape) return apply2DBool(s, other, 'cut');
  return s;
}

export function wpUnion(s: WpState, other: WpState): WpState {
  const { oc } = s;
  if (other.shape && s.shape) {
    const shape = pruneDebrisSolids(oc, ensureSolid(oc, oc.fuse(s.shape, other.shape)));
    return cloneState(s, { shape });
  }
  if (other.shape && !s.shape) {
    return cloneState(s, { shape: other.shape });
  }
  if (!s.shape && !other.shape) return apply2DBool(s, other, 'fuse');
  return s;
}

export function wpInter(s: WpState, other: WpState): WpState {
  const { oc } = s;
  if (other.shape && s.shape) {
    const shape = pruneDebrisSolids(oc, ensureSolid(oc, oc.common(s.shape, other.shape)));
    return cloneState(s, { shape });
  }
  if (!s.shape) return apply2DBool(s, other, 'common');
  return s;
}

