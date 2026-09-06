/**
 * Shape operators: `a + b` (union), `a - b` (diff), `a * b` (inter).
 *
 * They are spellings of the boolean pipe ops and share their implementation
 * (applyBoolean), so the cases here are about what is specific to the
 * operator form: parsing next to parenthesised pipelines, precedence against
 * `|`, static typing in the validator, and the type errors for non-shapes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { validate } from '../src/validator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}

function volume(source: string): number {
  return oc.getVolume(run(source).shape!);
}

const PI = Math.PI;
const BOX_MINUS_CYL = 1000 - 9 * PI * 10;

describe('shape operators: parsing', () => {
  it('a statement may start with a parenthesised pipeline followed by an operator', () => {
    const prog = parse('(box 10 10 10 | fillet 1) - (cylinder 3 20) | color "red"');
    expect(prog.statements).toHaveLength(1);
    const stmt = prog.statements[0] as any;
    expect(stmt.type).toBe('Pipeline');
    expect(stmt.source.type).toBe('BinOp');
    expect(stmt.source.op).toBe('-');
    expect(stmt.source.left.type).toBe('Pipeline');
    expect(stmt.source.right.type).toBe('CylinderExpr');
  });

  it('operators bind tighter than the pipe, and * tighter than + -', () => {
    const stmt = parse('a - b * c | fillet 1').statements[0] as any;
    expect(stmt.type).toBe('Pipeline');
    expect(stmt.source.op).toBe('-');
    expect(stmt.source.right.op).toBe('*');
  });

  it('a command followed by " - x" is still greedy argument arithmetic', () => {
    // Not a shape operator: the operator form only works between atoms.
    const stmt = parse('box 10 10 10 - 5').statements[0] as any;
    expect(stmt.type).toBe('BoxExpr');
    expect(stmt.args).toHaveLength(3);
    expect(stmt.args[2].type).toBe('BinOp');
  });
});

describe('shape operators: 3D', () => {
  it('- is diff, + is union, * is inter, with the pipe ops\' results', () => {
    const withVars = (expr: string) => volume(`a = box 10 10 10\nb = cylinder 3 20\n${expr}`);
    expect(withVars('a - b')).toBeCloseTo(BOX_MINUS_CYL, 3);
    expect(withVars('a - b')).toBeCloseTo(withVars('a | diff b'), 6);
    expect(withVars('a + b')).toBeCloseTo(1000 + 9 * PI * 10, 3);
    expect(withVars('a * b')).toBeCloseTo(9 * PI * 10, 3);
  });

  it('a list operand folds like diff [a, b]', () => {
    expect(volume('a = box 10 10 10\na - [cylinder 1 20, cylinder 1 20 at:(3,3)]'))
      .toBeCloseTo(1000 - 2 * PI * 10, 3);
  });

  it('chains left-to-right and feeds the pipe', () => {
    const three = '(box 10 10 10) + (box 10 10 10 at:(10,0,0)) + (box 10 10 10 at:(20,0,0))';
    expect(volume(three)).toBeCloseTo(3000, 3);
    expect(oc.getSubShapes(run(three).shape!, 'solid')).toHaveLength(1);
    expect(volume('(box 10 10 10) - (cylinder 3 20) | faces >Z | fillet 1'))
      .toBeLessThan(BOX_MINUS_CYL);
  });

  it('union keeps the operands\' colours', () => {
    const wp = run('a = box 10 10 10 | color "red"\nb = box 10 10 10 at:(20,0,0) | color "blue"\na + b');
    expect(wp.colorMap?.size).toBe(2);
  });
});

describe('shape operators: 2D', () => {
  it('Face - Face is a 2D boolean whose hole survives extrude', () => {
    expect(volume('(rect 10 10) - (circle 3) | extrude 2')).toBeCloseTo((100 - 9 * PI) * 2, 3);
    expect(volume('r = rect 10 10\nr - (circle 3) * (rect 4 4) | extrude 2')).toBeCloseTo(200 - 32, 3);
  });

  it('works as a place operand on a selected face', () => {
    expect(volume('box 20 20 20 | faces >Z | place ((rect 10 10) - (circle 3)) | cut 2'))
      .toBeCloseTo(8000 - (100 - 9 * PI) * 2, 3);
  });

  it('a Wire operand is refused like in diff', () => {
    expect(() => run('(wire [(0,0),(10,0),(10,10)]) - (circle 3)')).toThrow(/a wire has no area/);
  });

  it('a 2D tool against a bare solid is the same error as diff', () => {
    expect(() => run('a = box 10 10 10\na - (circle 3)')).toThrow(/cannot combine a solid with a face/);
  });
});

describe('shape operators: type errors', () => {
  it('other operators are not defined for shapes', () => {
    expect(() => run('a = box 10 10 10\na / 2')).toThrow(/'\/' is not defined for shapes/);
  });
  it('a number on either side is a type error naming the side', () => {
    expect(() => run('a = box 10 10 10\n3 - a')).toThrow(/left operand of '-' must be a shape, got number/);
    expect(() => run('a = box 10 10 10\na - 3')).toThrow(/right operand of '-' must be a shape/);
  });
});

describe('shape operators: validator', () => {
  it('a 2D boolean is a Face; a 3D one is 3D', () => {
    expect(validate(parse('(rect 10 10) - (circle 3) | extrude 2'))).toHaveLength(0);
    expect(validate(parse('(rect 10 10) - (circle 3) | fillet 1 | extrude 2'))).toHaveLength(0);
    expect(validate(parse('(rect 10 10) - (circle 3) | shell 1'))[0].message)
      .toMatch(/not valid in Face context/);
    expect(validate(parse('(box 10 10 10) - (cylinder 3 20) | extrude 2'))[0].message)
      .toMatch(/not valid in 3D context/);
  });

  it('an unresolvable side does not invent a context', () => {
    expect(validate(parse('a - (circle 3) | extrude 2'))).toHaveLength(0);
    expect(validate(parse('a - b | extrude 2'))).toHaveLength(0);
    expect(validate(parse('a - b | fillet 1'))).toHaveLength(0);
  });

  it('nested pipelines inside operands are validated', () => {
    expect(validate(parse('(rect 10 10 | shell 1) - (circle 3)'))[0].message)
      .toMatch(/not valid in Face context/);
  });
});
