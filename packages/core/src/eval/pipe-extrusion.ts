/**
 * Extrusion pipe operation evaluator functions: extrude, revolve, sweep, loft, cut, hole.
 */

import type { Expression, Extrude, Revolve, Sweep, Loft, Cut, Hole } from '../ast.js';
import type { WpState, Wire } from '../ocp-kernel.js';
import { wpExtrude, wpRevolve, wpSweep, wpLoft, wpCutThruAll, wpCutBlind, wpHole, wpFaceHole } from '../ocp-kernel.js';
import { asNumber, asWpState, resolveNamedArgs, getNamedNum, EvalError, type Value } from './types.js';
import { wpWorkplane, wpMove, wpMoveTo } from '../ocp-kernel.js';

export function evalExtrudeOp(
  state: WpState,
  op: Extrude,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const h = asNumber(evalExprFn(op.args[0]));
  // Extract draft angle from named args: extrude 10 draft:5
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const draft = kwargs.has('draft') ? getNamedNum(kwargs, 'draft') : undefined;
  return wpExtrude(state, h, draft);
}

export function evalRevolveOp(
  state: WpState,
  op: Revolve,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const axisStr = String(evalExprFn(op.args[0])) as 'X' | 'Y' | 'Z';
  const degrees = op.args.length > 1 ? asNumber(evalExprFn(op.args[1])) : 360;
  return wpRevolve(state, axisStr, degrees);
}

export function evalSweepOp(
  state: WpState,
  op: Sweep,
  evalExprFn: (e: Expression) => Value,
): WpState {
  // state (pipeline subject) carries the PATH (spine).
  // op.args[0] is the PROFILE (cross-section to be swept).
  const profileVal = evalExprFn(op.args[0]);
  const profileState = asWpState(profileVal);
  if (profileState.wires.length === 0) {
    throw new EvalError('Sweep requires a profile with at least one wire');
  }
  return wpSweep(state, profileState.wires[0], profileState.plane);
}

export function evalLoftOp(
  state: WpState,
  op: Loft,
  evalExprFn: (e: Expression) => Value,
): WpState {
  if (op.args.length < 1) throw new EvalError('loft requires a sections list');

  // arg[0]: list of 2D section expressions
  const sectionsVal = evalExprFn(op.args[0]);
  if (!Array.isArray(sectionsVal)) throw new EvalError('loft first argument must be a list of sections');

  // Evaluate each section to get its wires
  const sectionWires: Wire[][] = [];
  for (const sv of sectionsVal) {
    const ws = asWpState(sv);
    if (!ws.wires.length) throw new EvalError('Each loft section must produce wires');
    sectionWires.push(ws.wires);
  }

  // arg[1]: height (number) or heights (list of numbers)
  let height: number | undefined;
  let heights: number[] | undefined;
  if (op.args.length > 1) {
    const hVal = evalExprFn(op.args[1]);
    if (Array.isArray(hVal)) {
      heights = hVal.map(v => asNumber(v));
    } else {
      height = asNumber(hVal);
    }
  }

  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const ruled = kwargs.has('ruled') ? Boolean(kwargs.get('ruled')) : false;

  return wpLoft(state, sectionWires, height, heights, ruled);
}

export function evalCutOp(
  state: WpState,
  op: Cut,
  evalExprFn: (e: Expression) => Value,
): WpState {
  if (op.args.length > 0) {
    const depth = asNumber(evalExprFn(op.args[0]));
    return wpCutBlind(state, -depth);
  }
  return wpCutThruAll(state);
}

export function evalHoleOp(
  state: WpState,
  op: Hole,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const radius = asNumber(evalExprFn(op.args[0]));
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const depth = kwargs.has('depth') ? asNumber(kwargs.get('depth')!) : undefined;
  const atVal = kwargs.has('at') ? kwargs.get('at')! : null;
  const originVal = kwargs.has('origin') ? kwargs.get('origin')! : null;

  if (atVal !== null) {
    // Position hole at specified coordinates
    const s = applyHoleAtPosition(state, atVal, originVal);
    return wpHole(s, radius, depth);
  }

  return wpHole(state, radius, depth);
}

export function evalFaceHoleOp(
  state: WpState,
  op: Hole,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const radius = asNumber(evalExprFn(op.args[0]));
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
  const depth = kwargs.has('depth') ? asNumber(kwargs.get('depth')!) : undefined;
  const atVal = kwargs.has('at') ? kwargs.get('at')! : null;
  const originVal = kwargs.has('origin') ? kwargs.get('origin')! : null;

  if (atVal !== null) {
    // at: specified -- position the hole explicitly instead of face center
    let s = wpWorkplane(state);  // insert workplane for face selection
    s = applyHoleAtPosition(s, atVal, originVal);
    return wpHole(s, radius, depth);
  }

  return wpFaceHole(state, radius, depth);
}

/**
 * Position the workplane cursor for a hole with at: kwarg.
 * 2-component at: = WP-relative (center shift)
 * 3-component at: = world coordinates (workplane origin shift)
 * origin:"world" = treat 2-component as world XY
 * origin:(ox,oy,oz) = set workplane origin, then center shift
 */
function applyHoleAtPosition(state: WpState, atVal: Value, originVal: Value | null): WpState {
  if (Array.isArray(atVal)) {
    const nums = atVal.map(v => asNumber(v));
    if (nums.length >= 3) {
      // 3-component: world coordinates (project onto face)
      const s = wpWorkplane(state, undefined, [nums[0], nums[1], nums[2]]);
      return wpMoveTo(s, 0, 0);
    }
    if (nums.length === 2) {
      if (typeof originVal === 'string' && originVal === 'world') {
        // 2-component + origin:"world": treat as world XY
        const s = wpWorkplane(state, undefined, [nums[0], nums[1], 0]);
        return wpMoveTo(s, 0, 0);
      }
      if (Array.isArray(originVal)) {
        // origin:(ox,oy,oz): set workplane origin, then WP-relative center
        const ov = originVal.map(v => asNumber(v));
        const oz = ov.length > 2 ? ov[2] : 0;
        const s = wpWorkplane(state, undefined, [ov[0], ov[1], oz]);
        return wpMove(s, nums[0], nums[1]);
      }
      // Default 2-component: WP-relative center shift
      return wpMove(state, nums[0], nums[1]);
    }
  }
  // Single value as x offset
  const x = asNumber(atVal);
  return wpMove(state, x, 0);
}
