import { describe, it, expect } from 'vitest';
import {
  Environment, EvalError, MATH_FUNCS,
  asNumber, asString, asWpState, isWpState, isUserFunc, asTupleList,
  resolveNamedArgs, getNamedNum, getNamedStr,
  type Value, type UserFunc,
} from '../src/eval/types.js';

describe('Environment', () => {
  it('sets and gets a value', () => {
    const env = new Environment();
    env.set('x', 42);
    expect(env.get('x')).toBe(42);
  });

  it('throws on undefined variable', () => {
    const env = new Environment();
    expect(() => env.get('x')).toThrow('Undefined variable: x');
  });

  it('has() returns true for defined variable', () => {
    const env = new Environment();
    env.set('x', 42);
    expect(env.has('x')).toBe(true);
  });

  it('has() returns false for undefined variable', () => {
    const env = new Environment();
    expect(env.has('x')).toBe(false);
  });

  it('child environment inherits parent bindings', () => {
    const parent = new Environment();
    parent.set('x', 42);
    const child = parent.child();
    expect(child.get('x')).toBe(42);
  });

  it('child environment can shadow parent bindings', () => {
    const parent = new Environment();
    parent.set('x', 42);
    const child = parent.child();
    child.set('x', 100);
    expect(child.get('x')).toBe(100);
    expect(parent.get('x')).toBe(42);
  });

  it('child has() checks parent', () => {
    const parent = new Environment();
    parent.set('x', 42);
    const child = parent.child();
    expect(child.has('x')).toBe(true);
    expect(child.has('y')).toBe(false);
  });

  it('grandchild inherits from grandparent', () => {
    const gp = new Environment();
    gp.set('x', 1);
    const p = gp.child();
    p.set('y', 2);
    const c = p.child();
    expect(c.get('x')).toBe(1);
    expect(c.get('y')).toBe(2);
    expect(c.has('x')).toBe(true);
  });
});

describe('EvalError', () => {
  it('creates error without location', () => {
    const err = new EvalError('test error');
    expect(err.message).toBe('test error');
    expect(err.name).toBe('EvalError');
    expect(err.loc).toBeUndefined();
  });

  it('creates error with location', () => {
    const err = new EvalError('test error', { line: 5, column: 10 });
    expect(err.message).toBe('test error at line 5, column 10');
    expect(err.loc).toEqual({ line: 5, column: 10 });
  });
});

describe('asNumber', () => {
  it('returns number from number', () => {
    expect(asNumber(42)).toBe(42);
  });

  it('converts true to 1', () => {
    expect(asNumber(true)).toBe(1);
  });

  it('converts false to 0', () => {
    expect(asNumber(false)).toBe(0);
  });

  it('throws for string', () => {
    expect(() => asNumber('hello' as any)).toThrow('Expected number');
  });

  it('throws for null', () => {
    expect(() => asNumber(null)).toThrow('Expected number');
  });

  it('throws for array', () => {
    expect(() => asNumber([1, 2] as any)).toThrow('Expected number');
  });
});

describe('asString', () => {
  it('returns string from string', () => {
    expect(asString('hello')).toBe('hello');
  });

  it('converts number to string', () => {
    expect(asString(42)).toBe('42');
  });

  it('converts boolean to string', () => {
    expect(asString(true)).toBe('true');
  });

  it('converts null to string', () => {
    expect(asString(null)).toBe('null');
  });
});

describe('isWpState / asWpState', () => {
  const fakeWpState = {
    oc: {},
    plane: {},
    shape: null,
    selectedFaces: [],
    selectedEdges: [],
    selectedVertices: [],
    points: [],
    wires: [],
    tags: {},
  };

  it('isWpState returns true for valid WpState', () => {
    expect(isWpState(fakeWpState as any)).toBe(true);
  });

  it('isWpState returns false for null', () => {
    expect(isWpState(null)).toBe(false);
  });

  it('isWpState returns false for number', () => {
    expect(isWpState(42)).toBe(false);
  });

  it('isWpState returns false for plain object', () => {
    expect(isWpState({ foo: 'bar' } as any)).toBe(false);
  });

  it('asWpState returns the value for valid WpState', () => {
    expect(asWpState(fakeWpState as any)).toBe(fakeWpState);
  });

  it('asWpState throws for non-WpState', () => {
    expect(() => asWpState(42)).toThrow('Expected shape/workplane state');
  });

  it('asWpState throws for null', () => {
    expect(() => asWpState(null)).toThrow('Expected shape/workplane state');
  });
});

describe('isUserFunc', () => {
  it('returns true for valid UserFunc', () => {
    const func: UserFunc = {
      __kind: 'func',
      name: 'test',
      params: [],
      body: { type: 'NumberLit', value: 1 },
      closure: new Environment(),
    };
    expect(isUserFunc(func)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isUserFunc(null)).toBe(false);
  });

  it('returns false for number', () => {
    expect(isUserFunc(42)).toBe(false);
  });

  it('returns false for plain object without __kind', () => {
    expect(isUserFunc({ name: 'test' } as any)).toBe(false);
  });

  it('returns false for object with wrong __kind', () => {
    expect(isUserFunc({ __kind: 'other' } as any)).toBe(false);
  });
});

describe('asTupleList', () => {
  it('converts array of tuples', () => {
    const result = asTupleList([[1, 2], [3, 4]]);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('throws for non-array', () => {
    expect(() => asTupleList(42)).toThrow('Expected list of tuples');
  });

  it('throws for array of non-tuples', () => {
    expect(() => asTupleList([1, 2, 3])).toThrow('Expected (x, y) tuple');
  });

  it('handles tuples with more than 2 elements', () => {
    const result = asTupleList([[1, 2, 3], [4, 5, 6]]);
    expect(result).toEqual([[1, 2], [4, 5]]);
  });
});

describe('resolveNamedArgs', () => {
  it('resolves named args', () => {
    const namedArgs = [
      { key: 'a', value: { type: 'NumberLit' as const, value: 1 } },
      { key: 'b', value: { type: 'NumberLit' as const, value: 2 } },
    ];
    const result = resolveNamedArgs(namedArgs, (e: any) => e.value);
    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBe(2);
  });

  it('returns empty map for empty args', () => {
    const result = resolveNamedArgs([], () => null);
    expect(result.size).toBe(0);
  });
});

describe('getNamedNum', () => {
  it('returns number from map', () => {
    const map = new Map<string, Value>([['x', 42]]);
    expect(getNamedNum(map, 'x')).toBe(42);
  });

  it('returns default when key missing', () => {
    const map = new Map<string, Value>();
    expect(getNamedNum(map, 'x', 10)).toBe(10);
  });

  it('throws when key missing and no default', () => {
    const map = new Map<string, Value>();
    expect(() => getNamedNum(map, 'x')).toThrow('Missing required named argument: x');
  });
});

describe('getNamedStr', () => {
  it('returns string from map', () => {
    const map = new Map<string, Value>([['x', 'hello']]);
    expect(getNamedStr(map, 'x')).toBe('hello');
  });

  it('returns default when key missing', () => {
    const map = new Map<string, Value>();
    expect(getNamedStr(map, 'x', 'default')).toBe('default');
  });

  it('throws when key missing and no default', () => {
    const map = new Map<string, Value>();
    expect(() => getNamedStr(map, 'x')).toThrow('Missing required named argument: x');
  });

  it('converts non-string to string', () => {
    const map = new Map<string, Value>([['x', 42]]);
    expect(getNamedStr(map, 'x')).toBe('42');
  });
});

describe('MATH_FUNCS', () => {
  it('len returns array length', () => {
    expect(MATH_FUNCS.len([1, 2, 3] as any)).toBe(3);
  });

  it('len returns 0 for non-array', () => {
    expect(MATH_FUNCS.len(42 as any)).toBe(0);
  });
});
