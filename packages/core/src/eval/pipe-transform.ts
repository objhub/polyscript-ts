/**
 * Transform pipe operation evaluator functions: translate, rotate.
 *
 * Both translate and rotate support an optional `origin` keyword argument:
 *   - "world"  (default) — use world origin (0,0,0) as reference
 *   - "local"  — use BoundingBox center of the shape as reference
 *   - (x,y,z)  — use an arbitrary point as reference
 */

import type { Expression, Translate, Rotate, Scale, Move, MoveTo, Mirror } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import { wpTranslate, wpRotate, wpScale, wpMove, wpMoveTo, wpMirror, wpWorkplane, boundingBox } from '../ocp-kernel.js';
import { cloneState } from '../ocp-kernel/types.js';
import { asNumber, resolveNamedArgs, type Value, EvalError } from './types.js';

/**
 * Resolve the `origin` kwarg to a [x, y, z] center point.
 * Returns [0, 0, 0] for "world" or when omitted.
 */
function resolveOrigin(
  state: WpState,
  evalExprFn: (e: Expression) => Value,
  namedArgs: Translate['namedArgs'] | Rotate['namedArgs'],
): [number, number, number] {
  const kwargs = resolveNamedArgs(namedArgs, evalExprFn);
  const origin = kwargs.get('origin');

  if (origin === undefined || origin === 'world') {
    return [0, 0, 0];
  }

  if (origin === 'local') {
    if (!state.shape) {
      throw new EvalError('Cannot use origin:"local" — no shape available');
    }
    const bb = boundingBox(state.oc, state.shape);
    return [
      (bb.xmin + bb.xmax) / 2,
      (bb.ymin + bb.ymax) / 2,
      (bb.zmin + bb.zmax) / 2,
    ];
  }

  // Tuple: [x, y, z]
  if (Array.isArray(origin)) {
    const nums = origin.map(v => asNumber(v));
    if (nums.length < 3) {
      throw new EvalError(`origin tuple must have 3 elements, got ${nums.length}`);
    }
    return [nums[0], nums[1], nums[2]];
  }

  throw new EvalError(`Invalid origin value: expected "world", "local", or (x, y, z) tuple`);
}

export function evalTranslateOp(
  state: WpState,
  op: Translate,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalExprFn(e)));
  const [dx = 0, dy = 0, dz = 0] = args;

  // VertexSelection / PointSelection context: shift plane origin instead of shape
  if (state.points !== null || state.selectedVertices.length > 0) {
    const plane = state.plane;
    const newPlane = {
      ...plane,
      origin: {
        x: plane.origin.x + dx,
        y: plane.origin.y + dy,
        z: plane.origin.z + dz,
      },
    };
    return cloneState(state, { plane: newPlane });
  }

  const origin = resolveOrigin(state, evalExprFn, op.namedArgs);

  if (origin[0] === 0 && origin[1] === 0 && origin[2] === 0) {
    // World origin — simple translate (backward compatible)
    return wpTranslate(state, dx, dy, dz);
  }

  // Non-world origin: translate relative to origin point.
  // 1. Move shape so origin becomes world origin
  // 2. Apply the translation
  // 3. Move shape back
  let s = state;
  s = wpTranslate(s, -origin[0], -origin[1], -origin[2]);
  s = wpTranslate(s, dx, dy, dz);
  s = wpTranslate(s, origin[0], origin[1], origin[2]);
  return s;
}

export function evalRotateOp(
  state: WpState,
  op: Rotate,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalExprFn(e)));
  const [ax = 0, ay = 0, az = 0] = args;
  const center = resolveOrigin(state, evalExprFn, op.namedArgs);

  let s = state;
  if (ax !== 0) s = wpRotate(s, center, [1, 0, 0], ax);
  if (ay !== 0) s = wpRotate(s, center, [0, 1, 0], ay);
  if (az !== 0) s = wpRotate(s, center, [0, 0, 1], az);
  return s;
}

export function evalScaleOp(
  state: WpState,
  op: Scale,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalExprFn(e)));
  let sx: number, sy: number, sz: number;

  if (args.length === 1) {
    // Uniform scale
    sx = sy = sz = args[0];
  } else if (args.length === 3) {
    // Non-uniform scale
    [sx, sy, sz] = args;
  } else {
    throw new EvalError(`scale requires 1 or 3 arguments, got ${args.length}`);
  }

  const center = resolveOrigin(state, evalExprFn, op.namedArgs);
  return wpScale(state, center, sx, sy, sz);
}

/**
 * Resolve a world-coordinate origin for move/moveto operations.
 * When selected faces are present, uses wpWorkplane to project onto the face.
 * When no face selection (2D context), directly shifts the plane origin.
 */
function applyOriginShift(state: WpState, worldOrigin: [number, number, number]): WpState {
  if (state.selectedFaces.length > 0) {
    // Face selection context: use wpWorkplane to project onto face
    return wpWorkplane(state, undefined, worldOrigin);
  }
  // 2D context: directly set plane origin and reset center
  const plane = {
    ...state.plane,
    origin: {
      x: worldOrigin[0],
      y: worldOrigin[1],
      z: worldOrigin[2],
    },
  };
  return cloneState(state, { plane, centerX: 0, centerY: 0 });
}

export function evalMoveOp(
  state: WpState,
  op: Move,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalExprFn(e)));
  const [dx = 0, dy = 0] = args;
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const originVal = kwargs.get('origin');

  if (originVal !== undefined) {
    // origin:"world" -> set workplane origin to (0,0,0) then center(dx,dy)
    if (originVal === 'world') {
      const s = applyOriginShift(state, [0, 0, 0]);
      return wpMove(s, dx, dy);
    }
    // origin:(ox,oy,oz) -> set workplane origin to that point then center(dx,dy)
    if (Array.isArray(originVal)) {
      const nums = originVal.map(v => asNumber(v));
      const oz = nums.length > 2 ? nums[2] : 0;
      const s = applyOriginShift(state, [nums[0], nums[1], oz]);
      return wpMove(s, dx, dy);
    }
  }
  return wpMove(state, dx, dy);
}

export function evalMoveToOp(
  state: WpState,
  op: MoveTo,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalExprFn(e)));
  const [x = 0, y = 0] = args;
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const originVal = kwargs.get('origin');

  if (originVal !== undefined) {
    // origin:"world" -> project world (x,y,0) onto face workplane
    if (originVal === 'world') {
      const s = applyOriginShift(state, [x, y, 0]);
      return wpMoveTo(s, 0, 0);
    }
    // origin:(ox,oy,oz) -> set workplane origin to that point then moveTo(x,y)
    if (Array.isArray(originVal)) {
      const nums = originVal.map(v => asNumber(v));
      const oz = nums.length > 2 ? nums[2] : 0;
      const s = applyOriginShift(state, [nums[0], nums[1], oz]);
      return wpMoveTo(s, x, y);
    }
  }
  return wpMoveTo(state, x, y);
}

export function evalMirrorOp(
  state: WpState,
  op: Mirror,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => evalExprFn(e));
  const axis = args.length > 0 && typeof args[0] === 'string' ? args[0] : 'X';
  return wpMirror(state, axis);
}

/**
 * floor — align bottom face to z=0.
 * Computes the bounding box of the current shape and translates by -zmin.
 */
export function evalFloorOp(state: WpState): WpState {
  if (!state.shape) return state;
  const bb = boundingBox(state.oc, state.shape);
  return wpTranslate(state, 0, 0, -bb.zmin);
}
