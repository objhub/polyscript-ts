/**
 * Tests for variables, functions (def), import, optional $ prefix.
 * Covers parser, validator, evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import {
  evaluateExpressions, evaluate, EvalError, Evaluator,
  type Value,
} from '../src/evaluator.js';
import type { Expression, PipeOp, Statement } from '../src/ast.js';

function parseFirst(source: string): Statement {
  const program = parse(source);
  expect(program.statements.length).toBeGreaterThan(0);
  return program.statements[0];
}

function parsePipeline(source: string): { source: Expression; ops: PipeOp[] } {
  const stmt = parseFirst(source);
  if (stmt.type === 'Pipeline') return { source: stmt.source, ops: stmt.ops };
  return { source: stmt as Expression, ops: [] };
}

function getErrors(source: string) {
  const ast = parse(source);
  return validate(ast);
}

function evalExpr(source: string): Value {
  const ast = parse(source);
  return evaluateExpressions(ast);
}

// ===========================================================================
// Parser
// ===========================================================================

describe('variables', () => {
  describe('parser', () => {
    it('parses variable assignment', () => {
      const stmt = parseFirst('$size = 10');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.name).toBe('size');
        expect(stmt.value).toMatchObject({ type: 'NumberLit', value: 10 });
      }
    });

    it('parses function definition', () => {
      const stmt = parseFirst('def plate($size) = box $size $size 3');
      expect(stmt.type).toBe('FuncDef');
      if (stmt.type === 'FuncDef') {
        expect(stmt.name).toBe('plate');
        expect(stmt.params).toEqual(['size']);
        expect(stmt.body.type).toBe('BoxExpr');
      }
    });

    it('parses function definition with pipeline body', () => {
      const stmt = parseFirst(`def plate($size) = box $size $size 3 | fillet 1`);
      expect(stmt.type).toBe('FuncDef');
      if (stmt.type === 'FuncDef') {
        expect(stmt.body.type).toBe('Pipeline');
      }
    });

    it('parses import', () => {
      const stmt = parseFirst('import "gear"');
      expect(stmt.type).toBe('Import');
      if (stmt.type === 'Import') {
        expect(stmt.path).toBe('gear');
      }
    });

    it('parses function call with args', () => {
      const stmt = parseFirst('plate 40');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.name).toBe('plate');
        expect(stmt.args).toHaveLength(1);
      }
    });

    it('parses variable reference', () => {
      const stmt = parseFirst('box 80 60 10 | diff $holes');
      if (stmt.type === 'Pipeline') {
        const diff = stmt.ops[0];
        if (diff.type === 'Diff') {
          expect(diff.args[0].type).toBe('VarRef');
        }
      }
    });

    it('parses variable reference with $', () => {
      const stmt = parseFirst('$x = $myvar');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('VarRef');
      }
    });

    it('parses multi-statement program', () => {
      const program = parse(`$size = 10
$height = 20
box $size $size $height`);
      expect(program.statements).toHaveLength(3);
      expect(program.statements[0].type).toBe('Assignment');
      expect(program.statements[1].type).toBe('Assignment');
      expect(program.statements[2].type).toBe('BoxExpr');
    });

    // Function definition with multiple params
    it('parses def with multiple params', () => {
      const stmt = parseFirst('def add($a, $b, $c) = $a + $b + $c');
      expect(stmt.type).toBe('FuncDef');
      if (stmt.type === 'FuncDef') {
        expect(stmt.params).toEqual(['a', 'b', 'c']);
      }
    });

    it('parses def with no params', () => {
      const stmt = parseFirst('def unit() = 1');
      expect(stmt.type).toBe('FuncDef');
      if (stmt.type === 'FuncDef') {
        expect(stmt.params).toEqual([]);
      }
    });

    // Paren-style function call
    it('parses func_call with parenthesized args', () => {
      const stmt = parseFirst('foo(1, 2, 3)');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.name).toBe('foo');
        expect(stmt.args).toHaveLength(3);
      }
    });

    it('parses func_call with named args in parens', () => {
      const stmt = parseFirst('foo(x:1, y:2)');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.namedArgs).toHaveLength(2);
        expect(stmt.namedArgs[0].key).toBe('x');
      }
    });

    it('parses func_call with no args', () => {
      const stmt = parseFirst('foo()');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.args).toHaveLength(0);
        expect(stmt.namedArgs).toHaveLength(0);
      }
    });

    it('parses func_call with trailing comma', () => {
      const stmt = parseFirst('foo(1, 2,)');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.args).toHaveLength(2);
      }
    });

    it('parses func call with newlines in arg list', () => {
      const stmt = parseFirst(`foo(1,
  2,
  3)`);
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.args).toHaveLength(3);
      }
    });

    // Optional $ prefix
    it('parses assignment without $ prefix', () => {
      const stmt = parseFirst('size = 10');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.name).toBe('size');
        expect(stmt.value).toMatchObject({ type: 'NumberLit', value: 10 });
      }
    });

    it('parses variable reference without $ prefix', () => {
      const stmt = parseFirst('x = size + 1');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.name).toBe('x');
        expect(stmt.value.type).toBe('BinOp');
        if (stmt.value.type === 'BinOp') {
          expect(stmt.value.left).toMatchObject({ type: 'VarRef', name: 'size' });
        }
      }
    });

    it('parses assignment with $ prefix (backward compat)', () => {
      const stmt = parseFirst('$size = 10');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.name).toBe('size');
      }
    });

    it('parses $-prefixed keyword variable reference ($offset)', () => {
      const stmt = parseFirst('$offset = 5\nbox $offset $offset $offset');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.name).toBe('offset');
      }
      const program = parse('$offset = 5\nbox $offset $offset $offset');
      const boxStmt = program.statements[1];
      expect(boxStmt.type).toBe('BoxExpr');
      if (boxStmt.type === 'BoxExpr') {
        expect(boxStmt.args).toHaveLength(3);
        expect(boxStmt.args[0]).toMatchObject({ type: 'VarRef', name: 'offset' });
        expect(boxStmt.args[1]).toMatchObject({ type: 'VarRef', name: 'offset' });
        expect(boxStmt.args[2]).toMatchObject({ type: 'VarRef', name: 'offset' });
      }
    });

    it('parses $-prefixed keyword variable reference ($scale)', () => {
      const program = parse('$scale = 2\nbox 10 10 10 | scale $scale');
      const boxStmt = program.statements[1];
      expect(boxStmt.type).toBe('Pipeline');
      if (boxStmt.type === 'Pipeline') {
        const scaleOp = boxStmt.ops[0];
        expect(scaleOp.args[0]).toMatchObject({ type: 'VarRef', name: 'scale' });
      }
    });

    it('parses VarRef without $ in greedy args', () => {
      const stmt = parseFirst('box w h d');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0]).toMatchObject({ type: 'VarRef', name: 'w' });
        expect(stmt.args[1]).toMatchObject({ type: 'VarRef', name: 'h' });
        expect(stmt.args[2]).toMatchObject({ type: 'VarRef', name: 'd' });
      }
    });

    it('parses list comprehension with $-less for variable', () => {
      const stmt = parseFirst('x = [i for i in range(6)]');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListComp');
        if (stmt.value.type === 'ListComp') {
          expect(stmt.value.variable).toBe('i');
          expect(stmt.value.expr).toMatchObject({ type: 'VarRef', name: 'i' });
        }
      }
    });

    it('parses @param annotation with $-less assignment', () => {
      const stmt = parseFirst('@param 1..100\nsize = 50');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.name).toBe('size');
        expect(stmt.annotation).toBeDefined();
        expect(stmt.annotation!.options.min).toBe(1);
        expect(stmt.annotation!.options.max).toBe(100);
      }
    });

    it('does not allow keyword as variable name', () => {
      const stmt = parseFirst('box 10 10 10');
      expect(stmt.type).toBe('BoxExpr');
    });

    it('parses def with $-less params', () => {
      const stmt = parseFirst('def add(a, b) = a + b');
      expect(stmt.type).toBe('FuncDef');
      if (stmt.type === 'FuncDef') {
        expect(stmt.params).toEqual(['a', 'b']);
      }
    });

    it('parses mixed $ and non-$ in same program', () => {
      const program = parse('$a = 1\nb = $a + 1\nc = b * 2');
      expect(program.statements).toHaveLength(3);
      expect(program.statements[0].type).toBe('Assignment');
      expect(program.statements[1].type).toBe('Assignment');
      expect(program.statements[2].type).toBe('Assignment');
      if (program.statements[1].type === 'Assignment') {
        expect(program.statements[1].name).toBe('b');
      }
      if (program.statements[2].type === 'Assignment') {
        expect(program.statements[2].name).toBe('c');
      }
    });

    it('as $tag still requires $ prefix', () => {
      const { ops } = parsePipeline('box 10 10 10 | as $myTag');
      expect(ops[0].type).toBe('AsTag');
      if (ops[0].type === 'AsTag') {
        expect(ops[0].name).toBe('myTag');
      }
    });

    it('parses paren pipe source with $-less variable arg', () => {
      const stmt = parseFirst('(myFunc myVar) | fillet 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('FuncCall');
      }
    });

    // Parenthesized pipeline source
    it('parses (box ...) | pipe', () => {
      const stmt = parseFirst('(box 10 10 10) | fillet 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('BoxExpr');
      }
    });

    it('parses (funcName args) as pipe source', () => {
      const stmt = parseFirst('(myFunc 10 20) | fillet 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('FuncCall');
      }
    });
  });

  // ===========================================================================
  // Validator
  // ===========================================================================

  describe('validator', () => {
    it('skips validation for VarRef source', () => {
      const errors = getErrors('$myShape | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('skips validation for FuncCall source', () => {
      const errors = getErrors('make_box(10) | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('validates pipeline in function body', () => {
      const errors = getErrors('def f($x) = box $x $x $x | extrude 5');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('validates valid function body', () => {
      const errors = getErrors('def f($x) = box $x $x $x | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('validates pipeline in assignment', () => {
      const errors = getErrors('$x = box 10 10 10 | fillet 2');
      expect(errors).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Evaluator
  // ===========================================================================

  describe('evaluator', () => {
    // Variables
    it('reads assigned variable', () => {
      const ast = parse('$size = 10\n$x = $size + 5');
      const val = evaluateExpressions(ast);
      expect(val).toBe(15);
    });

    it('reads multiple assignments', () => {
      const ast = parse('$a = 3\n$b = 4\n$x = $a * $b');
      const val = evaluateExpressions(ast);
      expect(val).toBe(12);
    });

    it('throws on undefined variable', () => {
      expect(() => evalExpr('$x = $unknown_var')).toThrow();
    });

    // Functions
    it('evaluates user function', () => {
      const ast = parse('def double($n) = $n * 2\n$x = double(5)');
      const val = evaluateExpressions(ast);
      expect(val).toBe(10);
    });

    it('evaluates function with multiple params', () => {
      const ast = parse('def add($a, $b) = $a + $b\n$x = add(3, 7)');
      const val = evaluateExpressions(ast);
      expect(val).toBe(10);
    });

    it('evaluates nested function calls', () => {
      const ast = parse('def double($n) = $n * 2\ndef quad($n) = double(double($n))\n$x = quad(3)');
      const val = evaluateExpressions(ast);
      expect(val).toBe(12);
    });

    it('evaluates function with named args', () => {
      const ast = parse('def f($a, $b) = $a + $b\n$x = f(1, b:10)');
      const val = evaluateExpressions(ast);
      expect(val).toBe(11);
    });

    it('returns value when calling a variable holding a number', () => {
      const ast = parse('$x = 42\n$y = x()');
      const val = evaluateExpressions(ast);
      expect(val).toBe(42);
    });

    it('throws on completely unknown function', () => {
      expect(() => evalExpr('$x = unknown_func(1)')).toThrow('Unknown function');
    });

    // Tag reference
    it('evaluates $name as variable reference', () => {
      const ast = parse('$myTag = 42\n$x = $myTag');
      const val = evaluateExpressions(ast);
      expect(val).toBe(42);
    });

    // Multi-statement returning last
    it('returns last expression value', () => {
      const ast = parse('$a = 1\n$b = 2\n$c = $a + $b\n$c');
      const val = evaluateExpressions(ast);
      expect(val).toBe(3);
    });

    it('func def returns null', () => {
      const ast = parse('def f($x) = $x');
      const val = evaluateExpressions(ast);
      expect(val).toBe(null);
    });

    it('returns last value', () => {
      const ast = parse('$a = 1\n$b = 2\n$a + $b');
      const val = evaluateExpressions(ast) as number;
      expect(val).toBeCloseTo(3);
    });

    // Import
    it('throws without import resolver', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({ oc: mockOC });
      const ast = parse('import "test"');
      expect(() => evaluator.evaluate(ast)).toThrow('no import resolver');
    });

    it('throws when import not found', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({
        oc: mockOC,
        importResolver: () => null,
      });
      const ast = parse('import "nonexistent"');
      expect(() => evaluator.evaluate(ast)).toThrow('Cannot find import');
    });

    it('imports and uses function from another module', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({
        oc: mockOC,
        importResolver: (path: string) => {
          if (path === 'utils') return 'def double($n) = $n * 2';
          return null;
        },
        parseFn: parse,
      });
      const ast = parse('import "utils"\n$x = double(5)');
      const val = evaluator.evaluate(ast);
      expect(val).toBe(10);
    });

    it('does not import same path twice', () => {
      let importCount = 0;
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({
        oc: mockOC,
        importResolver: (_path: string) => {
          importCount++;
          return '$x = 1';
        },
        parseFn: parse,
      });
      const ast = parse('import "lib"\nimport "lib"');
      evaluator.evaluate(ast);
      expect(importCount).toBe(1);
    });

    it('throws when parseFn is not provided for import', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({
        oc: mockOC,
        importResolver: () => '$x = 1',
      });
      const ast = parse('import "test"');
      expect(() => evaluator.evaluate(ast)).toThrow('parse function');
    });

    // Import E2E
    it('imports variable from another module', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({
        oc: mockOC,
        importResolver: (path: string) => {
          if (path === 'constants') return '$PI_APPROX = 3';
          return null;
        },
        parseFn: parse,
      });
      const ast = parse('import "constants"\n$x = $PI_APPROX + 1');
      const val = evaluator.evaluate(ast);
      expect(val).toBe(4);
    });

    it('imports and chains multiple functions', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({
        oc: mockOC,
        importResolver: (path: string) => {
          if (path === 'math_utils') {
            return 'def double($n) = $n * 2\ndef triple($n) = $n * 3';
          }
          return null;
        },
        parseFn: parse,
      });
      const ast = parse('import "math_utils"\n$x = double(triple(2))');
      const val = evaluator.evaluate(ast);
      expect(val).toBe(12);
    });

    // $ keyword variable reference
    it('evaluates $offset variable in expression', () => {
      expect(evalExpr('$offset = 5\n$x = $offset + 1')).toBe(6);
    });

    it('evaluates $scale variable in expression', () => {
      expect(evalExpr('$scale = 2\n$x = $scale * 3')).toBe(6);
    });

    it('evaluates $mirror variable in expression', () => {
      expect(evalExpr('$mirror = "X"\n$x = $mirror')).toBe('X');
    });

    // getShape
    it('returns null for non-shape value', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({ oc: mockOC });
      expect(evaluator.getShape(42)).toBeNull();
      expect(evaluator.getShape(null)).toBeNull();
      expect(evaluator.getShape('hello')).toBeNull();
    });

    it('returns null for empty array', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({ oc: mockOC });
      expect(evaluator.getShape([])).toBeNull();
    });

    it('returns null for array of non-WpState', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({ oc: mockOC });
      expect(evaluator.getShape([1, 2, 3])).toBeNull();
    });

    // Unknown expression type
    it('throws on unknown expression type', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const evaluator = new Evaluator({ oc: mockOC });
      const fakeExpr = { type: 'UnknownExpr' } as any;
      expect(() => evaluator.evalExpr(fakeExpr)).toThrow('Unknown expression type');
    });

    // Error location propagation
    it('attaches location to EvalError when available', () => {
      try {
        evalExpr('$x = $unknown_var');
        expect.unreachable('should throw');
      } catch (e: any) {
        expect(e.message).toContain('Undefined variable');
      }
    });

    // evaluate() convenience function
    it('works with mock OC for expression-only programs', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const ast = parse('$x = 2 + 3');
      const val = evaluate(ast, mockOC);
      expect(val).toBe(5);
    });

    it('accepts options parameter', () => {
      const mockOC = new Proxy({}, {
        get: () => { throw new EvalError('No OC'); },
      }) as any;
      const ast = parse('$x = 10');
      const val = evaluate(ast, mockOC, { importResolver: undefined, parseFn: undefined });
      expect(val).toBe(10);
    });
  });
});
