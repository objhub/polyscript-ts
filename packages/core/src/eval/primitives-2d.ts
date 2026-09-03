/**
 * 2D primitive evaluator functions: rect, circle, ellipse, polyline, polygon, text.
 */

import type {
  Expression, NamedArg, Primitive2DExpr,
  RectExpr, CircleExpr, EllipseExpr, PolylineExpr, PolygonExpr, TextExpr,
} from '../ast.js';
import type { OC, WpState, Wire, Shape } from '../ocp-kernel.js';
import {
  createWorkplane, wpWorkplane,
  wpRect, wpCircle, wpEllipse, wpPolygon, wpText, type Center2,
} from '../ocp-kernel.js';
import { asNumber, asString, asTupleList, resolveNamedArgs, getNamedNum, EvalError, type Value } from './types.js';
import { planeNormal } from '../ocp-kernel/geometry.js';
import { applyAtPlacement, placementToPoints } from './placement.js';

/**
 * Rotate wires that were newly added by a 2D primitive around the workplane normal.
 * Only rotates wires added after `prevWireCount`.
 */
function applyAngle2D(oc: OC, state: WpState, prevWireCount: number, angleDeg: number): WpState {
  if (angleDeg === 0 || state.wires.length <= prevWireCount) return state;
  const normal = planeNormal(state.plane);
  const angleRad = angleDeg * Math.PI / 180;
  const newWires = [...state.wires];
  for (let i = prevWireCount; i < newWires.length; i++) {
    // Rotate around the workplane origin (center of the primitive placement)
    const center = state.plane.origin;
    newWires[i] = oc.rotate(
      newWires[i],
      { point: center, direction: normal },
      angleRad,
    ) as Wire;
  }
  return { ...state, wires: newWires };
}

/**
 * Apply at-placement to newly added wires only (wires after prevWireCount).
 * Unlike applyAtPlacement, this does NOT translate shapes — only wires.
 * This is important when a 2D primitive with at: is used in a pipe after
 * face selection: the base shape must not be moved.
 */
function applyAt2D(oc: OC, state: WpState, prevWireCount: number, placementVal: Value, originVal: Value | null = null): WpState {
  if (Array.isArray(placementVal)) {
    const atNums = placementVal.map(v => asNumber(v));
    if (atNums.length >= 3) {
      // 3-component at: is always world coordinates (project onto face)
      return applyAtWithWorldOrigin(oc, state, prevWireCount, [atNums[0], atNums[1], atNums[2]]);
    }
    if (atNums.length === 2 && originVal !== null) {
      if (typeof originVal === 'string' && originVal === 'world') {
        // 2-component + origin:"world": treat as world XY
        return applyAtWithWorldOrigin(oc, state, prevWireCount, [atNums[0], atNums[1], 0]);
      }
      if (Array.isArray(originVal)) {
        // origin:(ox,oy,oz): shift workplane origin, then WP-relative center
        const ov = originVal.map(v => asNumber(v));
        const oz = ov.length > 2 ? ov[2] : 0;
        return applyAtWithOriginAndOffset(oc, state, prevWireCount, [ov[0], ov[1], oz], atNums[0], atNums[1]);
      }
    }
  }

  // Default: 2-component at: or non-tuple placement = WP-relative
  const points = placementToPoints(placementVal);
  if (points.length === 0) return state;
  const oldWires = state.wires.slice(0, prevWireCount);
  const newWires = state.wires.slice(prevWireCount);
  const plane = state.plane;
  const translated: Shape[] = [];
  for (const wire of newWires) {
    for (const [lx, ly] of points) {
      // Convert local 2D coordinates (lx, ly) to global displacement
      // using the workplane's xDir/yDir basis vectors
      const dx = lx * plane.xDir.x + ly * plane.yDir.x;
      const dy = lx * plane.xDir.y + ly * plane.yDir.y;
      const dz = lx * plane.xDir.z + ly * plane.yDir.z;
      translated.push((dx !== 0 || dy !== 0 || dz !== 0) ? oc.translate(wire, dx, dy, dz) : wire);
    }
  }
  return { ...state, wires: [...oldWires, ...translated] };
}

/**
 * Apply at: with world-coordinate origin shift.
 * Redraws the 2D primitive on a new workplane whose origin is the given world point.
 */
function applyAtWithWorldOrigin(oc: OC, state: WpState, prevWireCount: number, worldOrigin: [number, number, number]): WpState {
  // Rebuild wires by shifting the workplane origin and redrawing at (0,0)
  const oldWires = state.wires.slice(0, prevWireCount);
  const newWires = state.wires.slice(prevWireCount);
  // Create a workplane with the new origin
  const s = wpWorkplane(state, undefined, worldOrigin);
  // The new wires need to be translated from the old center to the new center
  // Calculate the 3D displacement between new and old workplane origins
  const oldOrigin = state.plane.origin;
  const newOrigin = s.plane.origin;
  const dx = newOrigin.x - oldOrigin.x;
  const dy = newOrigin.y - oldOrigin.y;
  const dz = newOrigin.z - oldOrigin.z;
  const translated = newWires.map(w =>
    (dx !== 0 || dy !== 0 || dz !== 0) ? oc.translate(w, dx, dy, dz) : w
  );
  return { ...s, wires: [...oldWires, ...translated] };
}

/**
 * Apply at: with origin:(ox,oy,oz) shift + WP-relative offset.
 * Sets workplane origin to (ox,oy,oz) then offsets by (lx,ly) in WP coordinates.
 */
function applyAtWithOriginAndOffset(oc: OC, state: WpState, prevWireCount: number, worldOrigin: [number, number, number], lx: number, ly: number): WpState {
  const oldWires = state.wires.slice(0, prevWireCount);
  const newWires = state.wires.slice(prevWireCount);
  const s = wpWorkplane(state, undefined, worldOrigin);
  // Calculate displacement from old origin to new origin + local offset
  const plane = s.plane;
  const oldOrigin = state.plane.origin;
  const newBase = {
    x: plane.origin.x + lx * plane.xDir.x + ly * plane.yDir.x,
    y: plane.origin.y + lx * plane.xDir.y + ly * plane.yDir.y,
    z: plane.origin.z + lx * plane.xDir.z + ly * plane.yDir.z,
  };
  const dx = newBase.x - oldOrigin.x;
  const dy = newBase.y - oldOrigin.y;
  const dz = newBase.z - oldOrigin.z;
  const translated = newWires.map(w =>
    (dx !== 0 || dy !== 0 || dz !== 0) ? oc.translate(w, dx, dy, dz) : w
  );
  return { ...s, wires: [...oldWires, ...translated] };
}

/** Parse center: value into [boolean, boolean]. */
function parseCenterVal2D(v: Value): Center2 {
  if (typeof v === 'boolean') return [v, v];
  if (Array.isArray(v)) {
    if (v.length === 2) return v.map(x => !!x) as Center2;
    throw new EvalError(`center: expected 1 or 2 values, got ${v.length}`);
  }
  throw new EvalError(`center: expected boolean or (bool, bool)`);
}

/** Extract angle, at, origin, and center from namedArgs if present. */
function extractNamedArgs(
  namedArgs: NamedArg[] | undefined,
  evalExprFn: (e: Expression) => Value,
): { angle: number; atVal: Value | null; originVal: Value | null; centerVal: Center2 } {
  if (!namedArgs || namedArgs.length === 0) return { angle: 0, atVal: null, originVal: null, centerVal: [true, true] };
  const kwargs = resolveNamedArgs(namedArgs, evalExprFn);
  const angle = kwargs.has('angle') ? asNumber(kwargs.get('angle')!) : 0;
  const atVal = kwargs.has('at') ? kwargs.get('at')! : null;
  const originVal = kwargs.has('origin') ? kwargs.get('origin')! : null;
  const centerVal = kwargs.has('center') ? parseCenterVal2D(kwargs.get('center')!) : [true, true] as Center2;
  return { angle, atVal, originVal, centerVal };
}

export function eval2DPrimitive(
  state: WpState,
  expr: Primitive2DExpr,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const prevWireCount = state.wires.length;
  const namedArgs = expr.namedArgs;
  const { centerVal } = extractNamedArgs(namedArgs, evalExprFn);
  let result: WpState;
  switch (expr.type) {
    case 'RectExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      result = wpRect(state, args[0] ?? 1, args[1] ?? 1, centerVal);
      break;
    }
    case 'CircleExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      result = wpCircle(state, args[0] ?? 1, centerVal);
      break;
    }
    case 'EllipseExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      result = wpEllipse(state, args[0] ?? 1, args[1] ?? 1, centerVal);
      break;
    }
    case 'PolylineExpr': {
      const args = expr.args.map(e => evalExprFn(e));
      const pts = asTupleList(args[0] ?? []);
      result = wpPolygon(state, pts);
      break;
    }
    case 'PolygonExpr': {
      const args = expr.args.map(e => asNumber(evalExprFn(e)));
      const pts = polygonPoints(args[0] ?? 6, args[1] ?? 1);
      result = wpPolygon(state, pts);
      break;
    }
    case 'TextExpr': {
      const args = expr.args.map(e => evalExprFn(e));
      const kwargs = resolveNamedArgs(namedArgs, evalExprFn);
      const textSize = kwargs.has('size') ? getNamedNum(kwargs, 'size') : asNumber(args[1] ?? 10);
      result = wpText(state, asString(args[0] ?? ''), textSize, 1);
      break;
    }
    default:
      throw new EvalError(`Not a 2D primitive: ${(expr as {type: string}).type}`);
  }

  // Apply angle rotation and at placement if specified
  const { angle, atVal, originVal } = extractNamedArgs(namedArgs, evalExprFn);
  if (angle !== 0) {
    result = applyAngle2D(state.oc, result, prevWireCount, angle);
  }
  if (atVal != null) {
    result = applyAt2D(state.oc, result, prevWireCount, atVal, originVal);
  }
  return result;
}

/** Apply angle and at to a standalone 2D result. */
function applyNamedArgs2D(oc: OC, result: WpState, namedArgs: NamedArg[], evalExprFn: (e: Expression) => Value): WpState {
  const { angle, atVal } = extractNamedArgs(namedArgs, evalExprFn);
  if (angle !== 0) result = applyAngle2D(oc, result, 0, angle);
  if (atVal != null) result = applyAtPlacement(oc, result, atVal);
  return result;
}

export function evalRect(oc: OC, node: RectExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const { centerVal } = extractNamedArgs(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpRect(state, args[0] ?? 1, args[1] ?? 1, centerVal);
  return applyNamedArgs2D(oc, result, node.namedArgs, evalExprFn);
}

export function evalCircle(oc: OC, node: CircleExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const { centerVal } = extractNamedArgs(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpCircle(state, args[0] ?? 1, centerVal);
  return applyNamedArgs2D(oc, result, node.namedArgs, evalExprFn);
}

export function evalEllipse(oc: OC, node: EllipseExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const { centerVal } = extractNamedArgs(node.namedArgs, evalExprFn);
  const state = createWorkplane(oc);
  const result = wpEllipse(state, args[0] ?? 1, args[1] ?? 1, centerVal);
  return applyNamedArgs2D(oc, result, node.namedArgs, evalExprFn);
}

function polygonPoints(n: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return pts;
}

export function evalPolyline(oc: OC, node: PolylineExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => evalExprFn(e));
  const pts = asTupleList(args[0] ?? []);
  const state = createWorkplane(oc);
  const result = wpPolygon(state, pts);
  return applyNamedArgs2D(oc, result, node.namedArgs, evalExprFn);
}

export function evalPolygon(oc: OC, node: PolygonExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => asNumber(evalExprFn(e)));
  const pts = polygonPoints(args[0] ?? 6, args[1] ?? 1);
  const state = createWorkplane(oc);
  const result = wpPolygon(state, pts);
  return applyNamedArgs2D(oc, result, node.namedArgs, evalExprFn);
}

export function evalText(oc: OC, node: TextExpr, evalExprFn: (e: Expression) => Value): Value {
  const args = node.args.map(e => evalExprFn(e));
  const kwargs = resolveNamedArgs(node.namedArgs, evalExprFn);
  const textSize = kwargs.has('size') ? getNamedNum(kwargs, 'size') : asNumber(args[1] ?? 10);
  const state = createWorkplane(oc);
  const result = wpText(state, asString(args[0] ?? ''), textSize, 1);
  return applyNamedArgs2D(oc, result, node.namedArgs, evalExprFn);
}
