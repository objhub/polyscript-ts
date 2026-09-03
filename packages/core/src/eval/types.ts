/**
 * Evaluator types, helpers, and utilities.
 */

import type { Expression, NamedArg, SourceLocation } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** Runtime value — either a primitive or a WpState (shape context). */
export type Value =
  | number
  | string
  | boolean
  | null
  | Value[]
  | [number, number]
  | WpState
  | UserFunc;

export interface UserFunc {
  __kind: 'func';
  name: string;
  params: string[];
  body: Expression;
  closure: Environment;
}

// ---------------------------------------------------------------------------
// Environment (variable scope)
// ---------------------------------------------------------------------------

export class Environment {
  private bindings: Map<string, Value>;
  private parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.bindings = new Map();
    this.parent = parent;
  }

  get(name: string): Value {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    if (this.parent) return this.parent.get(name);
    throw new EvalError(`Undefined variable: ${name}`);
  }

  set(name: string, value: Value): void {
    this.bindings.set(name, value);
  }

  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  child(): Environment {
    return new Environment(this);
  }
}

// ---------------------------------------------------------------------------
// Evaluation error
// ---------------------------------------------------------------------------

export class EvalError extends Error {
  loc?: SourceLocation;
  constructor(message: string, loc?: SourceLocation) {
    const locStr = loc ? ` at line ${loc.line}, column ${loc.column}` : '';
    super(message + locStr);
    this.name = 'EvalError';
    this.loc = loc;
  }
}

// ---------------------------------------------------------------------------
// Math builtins
// ---------------------------------------------------------------------------

export const MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sin: (deg: number) => Math.sin(deg * Math.PI / 180),
  cos: (deg: number) => Math.cos(deg * Math.PI / 180),
  tan: (deg: number) => Math.tan(deg * Math.PI / 180),
  asin: (x: number) => Math.asin(x) * 180 / Math.PI,
  acos: (x: number) => Math.acos(x) * 180 / Math.PI,
  atan: (x: number) => Math.atan(x) * 180 / Math.PI,
  atan2: (y: number, x: number) => Math.atan2(y, x) * 180 / Math.PI,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  radians: (deg: number) => deg * Math.PI / 180,
  degrees: (rad: number) => rad * 180 / Math.PI,
  rad: (deg: number) => deg * Math.PI / 180,
  deg: (rad: number) => rad * 180 / Math.PI,
  // len accepts an array at runtime despite the numeric signature; callers
  // bypass asNumber() for len.  The cast keeps the Record<> key uniform.
  len: ((arr: unknown) => Array.isArray(arr) ? arr.length : 0) as (...args: number[]) => number,
};

// ---------------------------------------------------------------------------
// Named arg helpers
// ---------------------------------------------------------------------------

export function resolveNamedArgs(
  namedArgs: NamedArg[],
  evalExpr: (e: Expression) => Value,
): Map<string, Value> {
  const map = new Map<string, Value>();
  for (const na of namedArgs) {
    map.set(na.key, evalExpr(na.value));
  }
  return map;
}

export function getNamedNum(kwargs: Map<string, Value>, key: string, def?: number): number {
  if (kwargs.has(key)) return asNumber(kwargs.get(key)!);
  if (def !== undefined) return def;
  throw new EvalError(`Missing required named argument: ${key}`);
}

export function getNamedStr(kwargs: Map<string, Value>, key: string, def?: string): string {
  if (kwargs.has(key)) return String(kwargs.get(key)!);
  if (def !== undefined) return def;
  throw new EvalError(`Missing required named argument: ${key}`);
}

// ---------------------------------------------------------------------------
// Type coercions
// ---------------------------------------------------------------------------

export function asNumber(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new EvalError(`Expected number, got ${typeof v}`);
}

export function asString(v: Value): string {
  if (typeof v === 'string') return v;
  return String(v);
}

export function asWpState(v: Value): WpState {
  if (v && typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>;
    if ('oc' in obj && 'plane' in obj) return v as WpState;
  }
  throw new EvalError(`Expected shape/workplane state`);
}

export function isWpState(v: Value): v is WpState {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as unknown as Record<string, unknown>;
  return 'oc' in obj && 'plane' in obj;
}

export function isUserFunc(v: Value): v is UserFunc {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as unknown as Record<string, unknown>;
  return '__kind' in obj && obj.__kind === 'func';
}

export function asTupleList(v: Value): [number, number][] {
  if (Array.isArray(v)) {
    return v.map(item => {
      if (Array.isArray(item) && item.length >= 2) {
        return [asNumber(item[0]), asNumber(item[1])];
      }
      throw new EvalError(`Expected (x, y) tuple in list`);
    });
  }
  throw new EvalError(`Expected list of tuples`);
}
