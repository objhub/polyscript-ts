/**
 * Color pipe operation evaluator.
 *
 * Resolves color specification (named, HEX, or RGB) and sets
 * WpState.color and WpState.alpha accordingly.
 */

import type { Expression, ColorOp } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import { cloneState } from '../ocp-kernel/types.js';
import { resolveColor, normalizeRGB } from '../colors.js';
import { asNumber, resolveNamedArgs, getNamedNum, type Value } from './types.js';
import { EvalError } from './types.js';

export function evalColorOp(
  state: WpState,
  op: ColorOp,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => evalExprFn(e));
  const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);

  let color: [number, number, number];

  if (args.length === 1 && typeof args[0] === 'string') {
    // Named color or HEX: color "red" or color "#FF0000"
    try {
      color = resolveColor(args[0]);
    } catch (e: any) {
      throw new EvalError(e.message, op.loc);
    }
  } else if (args.length === 3) {
    // RGB: color 0.8 0.2 0.1 or color 255 128 0
    const r = asNumber(args[0]);
    const g = asNumber(args[1]);
    const b = asNumber(args[2]);
    color = normalizeRGB(r, g, b);
  } else {
    throw new EvalError(
      `color requires 1 string argument or 3 numeric arguments, got ${args.length} argument(s)`,
      op.loc,
    );
  }

  // Alpha (optional named argument, default 1.0)
  const alpha = kwargs.has('alpha') ? getNamedNum(kwargs, 'alpha') : 1.0;

  // Build colorMap: register this shape's color for export
  const colorMap = state.colorMap ? new Map(state.colorMap) : new Map();
  if (state.shape) {
    colorMap.set(state.shape, [color[0], color[1], color[2], alpha]);
  }

  return cloneState(state, { color, alpha, colorMap });
}
