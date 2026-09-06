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
import { wpRotate2D } from '../ocp-kernel/transform.js';
import { planeOrigin, to3d } from '../ocp-kernel/geometry.js';
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

/**
 * `rotate` takes a different number of angles depending on what it is
 * rotating, and the count is never padded: `rotate 0 90` used to mean
 * `rotate 0 90 0` here and "no rotation" in the Python implementation, both
 * silently (devel/parity-ledger202609.md §4). SPEC principle 7 forbids that.
 *
 *   - 2D geometry on a workplane (faces and wires): ONE angle, about the
 *     plane normal. A sketch drawn on a face turns in that face.
 *   - a solid: THREE angles about the world axes, as before.
 *   - a bare workplane / selection: nothing to rotate. Turning the drawing
 *     frame itself was considered and declined as too easy to misread.
 *
 * 2D is checked first: after `faces >Z | rect 10 5` the state still carries
 * the solid underneath, and the thing being rotated is the rectangle.
 */
export function evalRotateOp(
  state: WpState,
  op: Rotate,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalExprFn(e)));
  const has2D = state.faces.length > 0 || state.wires.length > 0;

  if (has2D) {
    if (args.length !== 1) {
      throw new EvalError(
        `rotate: on a 2D shape, 1 argument (angle about the plane normal); got ${args.length}`,
        op.loc,
      );
    }
    return wpRotate2D(state, resolve2DOrigin(state, evalExprFn, op), args[0]);
  }

  if (state.shape) {
    if (args.length !== 3) {
      throw new EvalError(`rotate: on a solid, 3 arguments (rx ry rz); got ${args.length}`, op.loc);
    }
    const [ax, ay, az] = args;
    const center = resolveOrigin(state, evalExprFn, op.namedArgs);
    let s = state;
    if (ax !== 0) s = wpRotate(s, center, [1, 0, 0], ax);
    if (ay !== 0) s = wpRotate(s, center, [0, 1, 0], ay);
    if (az !== 0) s = wpRotate(s, center, [0, 0, 1], az);
    return s;
  }

  throw new EvalError('rotate: nothing to rotate here — draw a shape first (a workplane itself cannot be rotated)', op.loc);
}

/**
 * The point a 2D rotation turns about, in world coordinates.
 *   omitted / "world"  the workplane origin
 *   "local"            the centre of the 2D geometry's bounding box
 *   (x, y)             workplane coordinates
 *   (x, y, z)          a world point
 */
function resolve2DOrigin(
  state: WpState,
  evalExprFn: (e: Expression) => Value,
  op: Rotate | Mirror,
): [number, number, number] {
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const origin = kwargs.get('origin');
  if (origin === undefined || origin === 'world') {
    const o = planeOrigin(state.plane);
    return [o.x, o.y, o.z];
  }
  if (origin === 'local') {
    const all = [...state.faces, ...state.wires];
    const geometry = all.length === 1 ? all[0] : state.oc.makeCompound(all);
    const bb = boundingBox(state.oc, geometry);
    return [(bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2];
  }
  if (Array.isArray(origin)) {
    const nums = origin.map(v => asNumber(v));
    if (nums.length === 2) {
      const p = to3d(state.oc, state.plane, nums[0], nums[1]);
      return [p.x, p.y, p.z];
    }
    if (nums.length === 3) return [nums[0], nums[1], nums[2]];
  }
  throw new EvalError(`${op.type === 'Mirror' ? 'mirror' : 'rotate'}: origin must be "world", "local", (x, y) or (x, y, z)`, op.loc);
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

/**
 * `mirror "X"|"Y"|"Z"` reflects; it does not also keep the original. That is
 * what SPEC says and what OpenSCAD, CadQuery and build123d do, and it keeps
 * mirror in the same family as translate/rotate/scale: a pure transform.
 * The "build half, mirror to finish" idiom is `keep:true`, one fuse away
 * (CadQuery spells it `union=True`). The Python implementation fused by
 * default; that divergence is recorded in devel/parity-ledger202609.md §4.
 *
 *   keep:true     reflection fused with the original (2D: both kept)
 *   origin:       a point on the mirror plane; same forms as rotate's
 */
export function evalMirrorOp(
  state: WpState,
  op: Mirror,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => evalExprFn(e));
  const axis = args.length === 1 && typeof args[0] === 'string' ? args[0].toUpperCase() : null;
  const has2D = state.faces.length > 0 || state.wires.length > 0;
  const valid = has2D ? ['X', 'Y'] : ['X', 'Y', 'Z'];
  if (!axis || !valid.includes(axis)) {
    throw new EvalError(
      `mirror requires one axis name, ${valid.map(a => `"${a}"`).join(' / ')}; got ${args.length === 0 ? 'nothing' : args.map(a => JSON.stringify(a)).join(' ')}`,
      op.loc,
    );
  }
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const keep = kwargs.get('keep');
  if (keep !== undefined && typeof keep !== 'boolean') {
    throw new EvalError('mirror: keep must be true or false', op.loc);
  }
  if (!has2D && !state.shape) {
    throw new EvalError('mirror: nothing to mirror here — draw a shape first', op.loc);
  }
  const center = kwargs.has('origin')
    ? (has2D ? resolve2DOrigin(state, evalExprFn, op) : resolveOrigin(state, evalExprFn, op.namedArgs))
    : undefined;
  return wpMirror(state, axis, { keep: keep === true, center });
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
