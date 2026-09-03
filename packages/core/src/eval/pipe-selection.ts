/**
 * Selection pipe operation evaluator functions.
 */

import type { Expression, FacesSelect, EdgesSelect, VertsSelect, PointsSelect } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import { wpFaces, wpEdges, wpVertices, wpPushPoints, wpWorkplane } from '../ocp-kernel.js';
import { asString, type Value } from './types.js';

export type PlacementToPointsFn = (val: Value) => [number, number][];

const SELECTOR_NAME_ALIASES: Record<string, string> = {
  top: '>Z', bottom: '<Z',
  right: '>X', left: '<X',
  front: '<Y', back: '>Y',
};

const SELECTOR_SYMBOL_MAP: Record<string, string> = {
  '>': '>', '<': '<', '=': '|', '+': '#',
};

/** Translate a selector to the kernel's internal form.
 *
 * A compound selector written as one string (`">Z and =X"`) has to be
 * translated part by part. Translating only the leading symbol would leave
 * `=X` in place, which the kernel does not recognise -- and an unrecognised
 * part used to mean "no filtering", i.e. silently selecting everything.
 *
 * Mirrors `_selector_to_cadquery` in the Python evaluator.
 */
function normalizeSelector(sel: string): string {
  for (const joiner of [' and ', ' or ']) {
    if (sel.includes(joiner)) {
      return sel.split(joiner).map(part => normalizeSelector(part.trim())).join(joiner);
    }
  }
  const named = SELECTOR_NAME_ALIASES[sel];
  if (named) sel = named;
  const mapped = SELECTOR_SYMBOL_MAP[sel[0]];
  if (sel.length >= 2 && mapped) return mapped + sel.slice(1);
  return sel;
}

/** Build a compound selector string from args.
 *  Multiple args → AND (intersection).
 *  A single list arg → OR (union): edges [>Z, >X] */
function joinSelectors(args: Expression[], evalExprFn: (e: Expression) => Value): string | undefined {
  if (args.length === 0) return undefined;
  // Single list arg → OR
  if (args.length === 1) {
    const val = evalExprFn(args[0]);
    if (Array.isArray(val)) {
      return val.map(v => normalizeSelector(asString(v))).join(' or ');
    }
    return normalizeSelector(asString(val));
  }
  // Multiple args → AND
  return args.map(a => normalizeSelector(asString(evalExprFn(a)))).join(' and ');
}

export function evalFacesSelect(
  state: WpState,
  op: FacesSelect,
  evalExprFn: (e: Expression) => Value,
): WpState {
  return wpFaces(state, joinSelectors(op.args, evalExprFn), op.tag);
}

export function evalEdgesSelect(
  state: WpState,
  op: EdgesSelect,
  evalExprFn: (e: Expression) => Value,
): WpState {
  return wpEdges(state, joinSelectors(op.args, evalExprFn), op.tag);
}

export function evalVertsSelect(
  state: WpState,
  op: VertsSelect,
  evalExprFn: (e: Expression) => Value,
): WpState {
  return wpVertices(state, joinSelectors(op.args, evalExprFn), op.tag);
}

export function evalPointsSelect(
  state: WpState,
  op: PointsSelect,
  evalExprFn: (e: Expression) => Value,
  placementToPointsFn: PlacementToPointsFn,
): WpState {
  // When faces are selected, create workplane from face first — matching Python behaviour
  // where points(...) always calls .workplane() before pushPoints().
  const s = state.selectedFaces.length > 0 ? wpWorkplane(state) : state;
  const args = op.args.map(e => evalExprFn(e));
  if (args.length > 0) {
    const pts = placementToPointsFn(args[0]);
    return wpPushPoints(s, pts);
  }
  return s;
}
