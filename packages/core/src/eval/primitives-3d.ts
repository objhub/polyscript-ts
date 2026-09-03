/**
 * 3D primitive evaluator functions: box, cylinder, sphere, cone, torus.
 */

import type { BoxExpr, CylinderExpr, SphereExpr, ConeExpr, TorusExpr, WedgeExpr, Expression, NamedArg, Primitive3DExpr } from '../ast.js';
import type { OC, WpState, Shape } from '../ocp-kernel.js';
import { createWorkplane, wpBox, wpCylinder, wpSphere, wpCone, wpTorus, wpWedge, type Center3 } from '../ocp-kernel.js';
import { getOffsets } from '../ocp-kernel/workplane.js';
import { cloneState } from '../ocp-kernel/types.js';
import { asNumber, resolveNamedArgs, EvalError, type Value } from './types.js';
import { applyAtPlacement } from './placement.js';

/**
 * Apply angle rotation to a 3D shape.
 * - Single number: rotate around Z axis
 * - Tuple (rx, ry, rz): Euler angles (degrees) around X, Y, Z axes
 */
function applyAngle3D(oc: OC, shape: Shape, angleValue: Value): Shape {
  const origin = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } };
  if (typeof angleValue === 'number') {
    if (angleValue === 0) return shape;
    return oc.rotate(shape, origin, angleValue * Math.PI / 180);
  }
  if (Array.isArray(angleValue) && angleValue.length >= 3) {
    const [rx, ry, rz] = angleValue.map(v => asNumber(v));
    let s = shape;
    if (rx !== 0) {
      s = oc.rotate(s, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rx * Math.PI / 180);
    }
    if (ry !== 0) {
      s = oc.rotate(s, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, ry * Math.PI / 180);
    }
    if (rz !== 0) {
      s = oc.rotate(s, origin, rz * Math.PI / 180);
    }
    return s;
  }
  throw new EvalError(`angle: expected number or (rx, ry, rz) tuple`);
}

/** Parse center: value into [boolean, boolean, boolean]. */
function parseCenterVal3D(v: Value): Center3 {
  if (typeof v === 'boolean') return [v, v, v];
  if (Array.isArray(v)) {
    if (v.length === 3) return v.map(x => !!x) as Center3;
    throw new EvalError(`center: expected 1 or 3 values, got ${v.length}`);
  }
  throw new EvalError(`center: expected boolean or (bool, bool, bool)`);
}

/** Convert a Value to a [number, number, number] tuple. */
function asVec3(v: Value, name: string): [number, number, number] {
  if (Array.isArray(v) && v.length >= 3) {
    return [asNumber(v[0]), asNumber(v[1]), asNumber(v[2])];
  }
  throw new EvalError(`${name}: expected (x, y, z) tuple, got ${typeof v}`);
}

/** Extract angle, at, center, dir, and pnt values from namedArgs. */
function extractNamedArgs3D(
  namedArgs: NamedArg[] | undefined,
  evalExprFn: (e: Expression) => Value,
): { angleVal: Value | null; atVal: Value | null; centerVal: Center3; dirVal: [number, number, number] | null; pntVal: [number, number, number] | null } {
  if (!namedArgs || namedArgs.length === 0) return { angleVal: null, atVal: null, centerVal: [true, true, true], dirVal: null, pntVal: null };
  const kwargs = resolveNamedArgs(namedArgs, evalExprFn);
  const angleVal = kwargs.has('angle') ? kwargs.get('angle')! : null;
  const atVal = kwargs.has('at') ? kwargs.get('at')! : null;
  const centerVal = kwargs.has('center') ? parseCenterVal3D(kwargs.get('center')!) : [true, true, true] as Center3;
  const dirVal = kwargs.has('dir') ? asVec3(kwargs.get('dir')!, 'dir') : null;
  const pntVal = kwargs.has('pnt') ? asVec3(kwargs.get('pnt')!, 'pnt') : null;
  return { angleVal, atVal, centerVal, dirVal, pntVal };
}

/** Apply angle rotation and at placement to a 3D result. */
function applyNamedArgs3DToResult(oc: OC, result: WpState, namedArgs: NamedArg[], evalExprFn: (e: Expression) => Value): WpState {
  const { angleVal, atVal } = extractNamedArgs3D(namedArgs, evalExprFn);
  if (angleVal != null && result.shape) {
    result = cloneState(result, { shape: applyAngle3D(oc, result.shape, angleVal) });
  }
  if (atVal != null) {
    result = applyAtPlacement(oc, result, atVal) as WpState;
  }
  return result;
}

export function evalBox(oc: OC, node: BoxExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const [w = 1, h = 1, d = 1] = args;
  const { centerVal } = extractNamedArgs3D(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpBox(state, w, h, d, centerVal);
  return applyNamedArgs3DToResult(oc, result, node.namedArgs, evalExprFn);
}

export function evalCylinder(oc: OC, node: CylinderExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const [r = 1, h = 1] = args;
  const { centerVal, dirVal, pntVal } = extractNamedArgs3D(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpCylinder(state, h, r, centerVal, dirVal, pntVal);
  return applyNamedArgs3DToResult(oc, result, node.namedArgs, evalExprFn);
}

export function evalSphere(oc: OC, node: SphereExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const [r = 1] = args;
  const { centerVal } = extractNamedArgs3D(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpSphere(state, r, centerVal);
  return applyNamedArgs3DToResult(oc, result, node.namedArgs, evalExprFn);
}

export function evalCone(oc: OC, node: ConeExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const [r1 = 1, r2 = 0, h = 1] = args;
  const { centerVal, dirVal, pntVal } = extractNamedArgs3D(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpCone(state, h, r1, r2, centerVal, dirVal, pntVal);
  return applyNamedArgs3DToResult(oc, result, node.namedArgs, evalExprFn);
}

export function evalTorus(oc: OC, node: TorusExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const [r1 = 5, r2 = 1] = args;
  const { centerVal } = extractNamedArgs3D(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpTorus(state, r1, r2, centerVal);
  return applyNamedArgs3DToResult(oc, result, node.namedArgs, evalExprFn);
}

export function evalWedge(oc: OC, node: WedgeExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const [dx = 1, dy = 1, dz = 1, ltx = 0] = args;
  const { centerVal } = extractNamedArgs3D(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpWedge(state, dx, dy, dz, ltx, centerVal);
  return applyNamedArgs3DToResult(oc, result, node.namedArgs, evalExprFn);
}

/**
 * Evaluate a 3D primitive in pipe context (e.g. VertexSelection).
 * Creates a 3D shape at each offset point in state.points, translating
 * each copy to its workplane position, then combining via compound.
 */
export function eval3DPrimitive(
  state: WpState,
  expr: Primitive3DExpr,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const { oc } = state;
  const offsets = getOffsets(state);

  // Create the base 3D shape on a fresh workplane
  const baseState = createWorkplane(oc);
  const namedArgs = expr.namedArgs;
  const { centerVal, dirVal, pntVal } = extractNamedArgs3D(namedArgs, evalExprFn);
  let baseShape: WpState;
  switch (expr.type) {
    case 'BoxExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      baseShape = wpBox(baseState, args[0] ?? 1, args[1] ?? 1, args[2] ?? 1, centerVal);
      break;
    }
    case 'CylinderExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      baseShape = wpCylinder(baseState, args[1] ?? 1, args[0] ?? 1, centerVal, dirVal, pntVal);
      break;
    }
    case 'SphereExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      baseShape = wpSphere(baseState, args[0] ?? 1, centerVal);
      break;
    }
    case 'ConeExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      const [cr1 = 1, cr2 = 0, ch = 1] = args;
      baseShape = wpCone(baseState, ch, cr1, cr2, centerVal, dirVal, pntVal);
      break;
    }
    case 'TorusExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      baseShape = wpTorus(baseState, args[0] ?? 5, args[1] ?? 1, centerVal);
      break;
    }
    case 'WedgeExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      const [wdx = 1, wdy = 1, wdz = 1, wltx = 0] = args;
      baseShape = wpWedge(baseState, wdx, wdy, wdz, wltx, centerVal);
      break;
    }
    default:
      throw new EvalError(`Not a 3D primitive: ${(expr as {type: string}).type}`);
  }

  if (!baseShape.shape) {
    throw new EvalError(`3D primitive produced no shape`);
  }

  // Apply angle rotation and at placement if specified
  const { angleVal, atVal } = extractNamedArgs3D(namedArgs, evalExprFn);
  if (angleVal != null) {
    baseShape = cloneState(baseShape, { shape: applyAngle3D(oc, baseShape.shape, angleVal) });
  }
  if (atVal != null) {
    baseShape = applyAtPlacement(oc, baseShape, atVal) as WpState;
  }

  // Convert 2D workplane offsets to 3D positions using the plane
  const plane = state.plane;
  const shapes = offsets.map(([u, v]) => {
    const x = plane.origin.x + u * plane.xDir.x + v * plane.yDir.x;
    const y = plane.origin.y + u * plane.xDir.y + v * plane.yDir.y;
    const z = plane.origin.z + u * plane.xDir.z + v * plane.yDir.z;
    return oc.translate(baseShape.shape!, x, y, z);
  });

  const combined = shapes.length === 1 ? shapes[0] : oc.makeCompound(shapes);
  return cloneState(state, { shape: combined, wires: [], points: null, selectedVertices: [] });
}
