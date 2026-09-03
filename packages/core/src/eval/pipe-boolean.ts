/**
 * Boolean pipe operation evaluator functions: diff, union, inter.
 *
 * The operand is one shape expression, or a list of them (`diff [a, b]`).
 * A list folds left, one boolean per element -- the same order Python uses,
 * so `state | diff [a, b]` is `state.cut(a).cut(b)`. Lists are recognised
 * by their runtime value, matching the source-position `union [...]` path,
 * so a variable holding a list works too.
 */

import type { Expression, Diff, Union, Inter } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import { wpDiff, wpUnion, wpInter } from '../ocp-kernel.js';
import { mergeColorMaps } from '../ocp-kernel/types.js';
import { asWpState, type Value } from './types.js';

/** Evaluate the operand into the list of tool states to fold over. */
function toolStates(op: Diff | Union | Inter, evalExprFn: (e: Expression) => Value): WpState[] {
  const v = evalExprFn(op.args[0]);
  const items: Value[] = Array.isArray(v) ? (v as Value[]) : [v];
  return items.map(asWpState);
}

/** A tool with no geometry at all is a no-op, not an error. */
function isEmpty(t: WpState): boolean {
  return !t.shape && t.wires.length === 0 && !t.face2D;
}

export function evalDiffOp(
  state: WpState,
  op: Diff,
  evalExprFn: (e: Expression) => Value,
): WpState {
  for (const tool of toolStates(op, evalExprFn)) {
    if (isEmpty(tool)) continue;
    state = wpDiff(state, tool);
  }
  return state;
}

export function evalUnionOp(
  state: WpState,
  op: Union,
  evalExprFn: (e: Expression) => Value,
): WpState {
  for (const tool of toolStates(op, evalExprFn)) {
    if (isEmpty(tool)) continue;
    const result = wpUnion(state, tool);
    const colorMap = mergeColorMaps(state.colorMap, tool.colorMap);
    if (colorMap) result.colorMap = colorMap;
    state = result;
  }
  return state;
}

export function evalInterOp(
  state: WpState,
  op: Inter,
  evalExprFn: (e: Expression) => Value,
): WpState {
  for (const tool of toolStates(op, evalExprFn)) {
    if (isEmpty(tool)) continue;
    const result = wpInter(state, tool);
    const colorMap = mergeColorMaps(state.colorMap, tool.colorMap);
    if (colorMap) result.colorMap = colorMap;
    state = result;
  }
  return state;
}
