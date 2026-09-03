/**
 * Modifier pipe operation evaluator functions: fillet, chamfer, shell, offset.
 */

import { JoinType } from 'occt-wasm';
import type { Expression, Fillet, Chamfer, Shell, Offset } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import { wpFillet, wpChamfer, wpShell, wpOffset } from '../ocp-kernel.js';
import { asNumber, asString, resolveNamedArgs, type Value } from './types.js';

export function evalFilletOp(
  state: WpState,
  op: Fillet,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const r = asNumber(evalExprFn(op.args[0]));
  return wpFillet(state, r);
}

export function evalChamferOp(
  state: WpState,
  op: Chamfer,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const d = asNumber(evalExprFn(op.args[0]));
  return wpChamfer(state, d);
}

export function evalShellOp(
  state: WpState,
  op: Shell,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const thickness = asNumber(evalExprFn(op.args[0]));
  return wpShell(state, thickness);
}

export function evalOffsetOp(
  state: WpState,
  op: Offset,
  evalExprFn: (e: Expression) => Value,
): WpState {
  const distance = asNumber(evalExprFn(op.args[0]));
  let joinType: JoinType | undefined;
  let cap: string | undefined;
  if (op.namedArgs?.length) {
    const kwargs = resolveNamedArgs(op.namedArgs, evalExprFn);
    const joinVal = kwargs.get('join');
    if (joinVal !== undefined) {
      const name = asString(joinVal);
      joinType = name === 'miter' ? JoinType.Intersection
               : name === 'tangent' ? JoinType.Tangent
               : JoinType.Arc;
    }
    const capVal = kwargs.get('cap');
    if (capVal !== undefined) cap = asString(capVal);
  }
  return wpOffset(state, distance, joinType, cap);
}
