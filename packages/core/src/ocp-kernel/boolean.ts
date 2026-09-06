/**
 * OCP Kernel boolean operations — diff, union, intersect.
 * Uses occt-wasm: kernel.cut(), kernel.fuse(), kernel.common().
 *
 * 3D context: operates on `s.shape`.
 * 2D context: operates on `s.faces` and stores the result back as faces,
 *   so hole information survives to extrude/revolve/cut (e.g. annulus from
 *   `circle 10 | diff (circle 3)`). Wires have no area and are rejected.
 * Mixing a solid with a 2D shape is a type error (see applyBool).
 *
 * All three spellings -- pipe op (`a | diff b`), source form (`diff [a, b]`)
 * and shape operator (`a - b`) -- end here via applyBoolean in the evaluator.
 */

import type { OC, WpState, Shape } from './types.js';
import { cloneState } from './types.js';
import { ensureSolid } from './geometry.js';
import { requireFaces, combineFaces, explodeFaces, replaneTo } from './faces.js';

type BoolOp = 'fuse' | 'cut' | 'common';
const BOOL_NAME: Record<BoolOp, string> = { fuse: 'union', cut: 'diff', common: 'inter' };

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

/** Build a 2D shape from a workplane state's faces (null when it has none). */
function build2DShape(oc: OC, s: WpState, op: string): Shape | null {
  return combineFaces(oc, requireFaces(s, op));
}

/** Apply a 2D boolean op between two states. Returns a new state whose faces
 * are the result. The tool is brought onto the state's plane first. */
function apply2DBool(s: WpState, other: WpState, op: BoolOp): WpState {
  const { oc } = s;
  const name = BOOL_NAME[op];
  const selfShape = build2DShape(oc, s, name);
  const otherShape = combineFaces(oc, requireFaces(cloneState(other, replaneTo(other, s.plane)), name));
  if (!selfShape && !otherShape) return s;
  if (!selfShape) {
    if (op === 'fuse' && otherShape) {
      return cloneState(s, { faces: explodeFaces(oc, otherShape) });
    }
    return s;
  }
  if (!otherShape) return s;
  let result: Shape;
  if (op === 'fuse') result = fuse2D(oc, selfShape, otherShape);
  else if (op === 'cut') result = oc.cut(selfShape, otherShape);
  else result = oc.common(selfShape, otherShape);
  return cloneState(s, { faces: explodeFaces(oc, result) });
}

/** Nothing at all: no solid, no drawing. */
function isBlank(s: WpState): boolean {
  return !s.shape && s.faces.length === 0 && s.wires.length === 0;
}

/** What a boolean operand holds, for the type-mismatch message. */
export function describeOperand(s: WpState): string {
  const drawn = s.faces.length > 0 || s.wires.length > 0;
  if (s.shape) return drawn ? 'a solid with a drawing on it' : 'a solid';
  if (s.faces.length > 0) return 'a face';
  if (s.wires.length > 0) return 'a wire';
  return 'an empty workplane';
}

/**
 * A solid and a 2D shape have no boolean in common: the operands must both be
 * solids (3D) or both faces on one workplane (2D). Say which pair was given
 * instead of guessing at one side -- `box | faces >Z | diff [rect 10 10,
 * circle 3]` reads as if the list were a source expression, but it is a fold
 * of two faces onto a bare solid, and `(rect 10 10) + (box 5 5 5)` used to
 * return the box and drop the rect.
 */
function rejectMixed(op: BoolOp, s: WpState, other: WpState): never {
  const name = BOOL_NAME[op];
  throw new Error(
    `${name}: cannot combine ${describeOperand(s)} with ${describeOperand(other)}. ` +
    `Both operands must be solids, or both faces on one workplane. ` +
    `To draw on a solid, select a face first ('box | faces >Z | rect 10 10 | ${name} (circle 3) | cut 2'); ` +
    `to combine 2D shapes as a source, write '${name} [rect 10 10, circle 3]'`,
  );
}

/**
 * Fuse two solids. BRepAlgoAPI_Fuse occasionally fails on disjoint complex
 * shapes; a compound of the two is the safety net (the parts are then
 * unfused, which `poly info` reports as solids > 1).
 */
function fuse3D(oc: OC, a: Shape, b: Shape): Shape {
  try {
    return ensureSolid(oc, oc.fuse(a, b));
  } catch (err) {
    console.warn(`fuse failed in union; falling back to compound: ${err instanceof Error ? err.message : String(err)}`);
    return oc.makeCompound([a, b]);
  }
}

/**
 * Dispatch one boolean on operand kinds.
 *
 * solid x solid -> 3D boolean on `s.shape`. A drawing on the solid (`box |
 * faces >Z | rect 10 10 | union (cylinder 2 30)`) is kept.
 * 2D x 2D -> boolean on the faces; also when the drawing sits on a selected
 * face of a solid (`box | faces >Z | rect 10 10 | diff (circle 3) | cut 2`),
 * where `s.shape` is still the box.
 * empty x solid -> `union` adopts the solid (`workplane XZ | union (box)`).
 * Anything else mixes a solid with a 2D shape and is a type error.
 */
function applyBool(s: WpState, other: WpState, op: BoolOp): WpState {
  const { oc } = s;
  if (isBlank(other)) return s;
  if (other.shape) {
    if (s.shape) {
      let shape: Shape;
      if (op === 'fuse') shape = fuse3D(oc, s.shape, other.shape);
      else if (op === 'cut') shape = ensureSolid(oc, oc.cut(s.shape, other.shape));
      else shape = ensureSolid(oc, oc.common(s.shape, other.shape));
      return cloneState(s, { shape: pruneDebrisSolids(oc, shape) });
    }
    if (op === 'fuse' && isBlank(s)) return cloneState(s, { shape: other.shape });
    return rejectMixed(op, s, other);
  }
  if (!s.shape || s.faces.length > 0 || s.wires.length > 0) return apply2DBool(s, other, op);
  return rejectMixed(op, s, other);
}

export function wpDiff(s: WpState, other: WpState): WpState {
  return applyBool(s, other, 'cut');
}

export function wpUnion(s: WpState, other: WpState): WpState {
  return applyBool(s, other, 'fuse');
}

export function wpInter(s: WpState, other: WpState): WpState {
  return applyBool(s, other, 'common');
}
