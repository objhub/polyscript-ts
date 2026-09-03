/**
 * Tests for placement operations: at:, angle:, polar, grid, points.
 * Covers parser, evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import type { Expression, PipeOp, Pipeline, PolarPipe, Statement } from '../src/ast.js';

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

function createMockOC() {
  let handleCounter = 100;
  const nextHandle = () => ++handleCounter as any;
  const calls: { method: string; args: any[] }[] = [];
  const mock = {
    _calls: calls,
    makeBox(dx: number, dy: number, dz: number) { calls.push({ method: 'makeBox', args: [dx, dy, dz] }); return nextHandle(); },
    makeCylinder(r: number, h: number) { calls.push({ method: 'makeCylinder', args: [r, h] }); return nextHandle(); },
    translate(shape: any, dx: number, dy: number, dz: number) { calls.push({ method: 'translate', args: [shape, dx, dy, dz] }); return nextHandle(); },
    fuse(a: any, b: any) { calls.push({ method: 'fuse', args: [a, b] }); return nextHandle(); },
    makeCompound(shapes: any[]) { calls.push({ method: 'makeCompound', args: [shapes] }); return nextHandle(); },
    getBoundingBox(_shape: any) { return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 }; },
    getBoundingBoxFast(_shape: any) { return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 }; },
    getSubShapes(_shape: any, _type: string) { return []; },
  } as any;
  return mock;
}

// ===========================================================================
// Parser
// ===========================================================================

describe('placement', () => {
  describe('parser', () => {
    // at: with tuple
    it('parses at: with tuple', () => {
      const stmt = parseFirst('cylinder 5 10 at:(20, 10)');
      expect(stmt.type).toBe('CylinderExpr');
      if (stmt.type === 'CylinderExpr') {
        expect(stmt.args).toHaveLength(2);
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
      }
    });

    it('parses grid as pipe op', () => {
      const program = parse('box 10 10 3 | grid 4 3 pitch:10');
      const stmt = program.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops[0].type).toBe('GridPipe');
    });

    it('parses polar as pipe op', () => {
      const program = parse('cylinder 2.5 10 | polar count:4 radius:15');
      const stmt = program.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops[0].type).toBe('PolarPipe');
    });

    it('parses at: with two-element tuple', () => {
      const stmt = parseFirst('box 10 10 3 at:(15, 15)');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        const val = stmt.namedArgs[0].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(2);
          expect(val.elements[0]).toMatchObject({ type: 'NumberLit', value: 15 });
          expect(val.elements[1]).toMatchObject({ type: 'NumberLit', value: 15 });
        }
      }
    });

    it('parses at: with three-element tuple (3D)', () => {
      const stmt = parseFirst('box 10 10 3 at:(15, 15, 20)');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        const val = stmt.namedArgs[0].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(3);
          expect(val.elements[0]).toMatchObject({ type: 'NumberLit', value: 15 });
          expect(val.elements[1]).toMatchObject({ type: 'NumberLit', value: 15 });
          expect(val.elements[2]).toMatchObject({ type: 'NumberLit', value: 20 });
        }
      }
    });

    it('parses at: with variable references', () => {
      const stmt = parseFirst('box 10 10 3 at:($x, $y)');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        const val = stmt.namedArgs[0].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(2);
          expect(val.elements[0]).toMatchObject({ type: 'VarRef', name: 'x' });
          expect(val.elements[1]).toMatchObject({ type: 'VarRef', name: 'y' });
        }
      }
    });

    it('parses at: with arithmetic expressions', () => {
      const stmt = parseFirst('box 10 10 3 at:($x+1, $y+1)');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        const val = stmt.namedArgs[0].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(2);
          const e0 = val.elements[0];
          expect(e0.type).toBe('BinOp');
          if (e0.type === 'BinOp') {
            expect(e0.op).toBe('+');
            expect(e0.left).toMatchObject({ type: 'VarRef', name: 'x' });
            expect(e0.right).toMatchObject({ type: 'NumberLit', value: 1 });
          }
          const e1 = val.elements[1];
          expect(e1.type).toBe('BinOp');
          if (e1.type === 'BinOp') {
            expect(e1.op).toBe('+');
            expect(e1.left).toMatchObject({ type: 'VarRef', name: 'y' });
            expect(e1.right).toMatchObject({ type: 'NumberLit', value: 1 });
          }
        }
      }
    });

    it('parses at: followed by pipe', () => {
      const stmt = parseFirst('box 10 10 3 at:(15, 15) | fillet 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('BoxExpr');
        if (stmt.source.type === 'BoxExpr') {
          expect(stmt.source.namedArgs).toHaveLength(1);
          expect(stmt.source.namedArgs[0].key).toBe('at');
          const val = stmt.source.namedArgs[0].value;
          expect(val.type).toBe('TupleLit');
          if (val.type === 'TupleLit') {
            expect(val.elements).toHaveLength(2);
          }
        }
        expect(stmt.ops).toHaveLength(1);
        expect(stmt.ops[0].type).toBe('Fillet');
      }
    });

    it('parses at: with list of tuples', () => {
      const stmt = parseFirst('box 10 10 3 at:[(0, 0), (20, 10)]');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('ListLit');
      }
    });

    it('parses bare at: without parens (2 values)', () => {
      const stmt = parseFirst('box 10 10 3 at:15 15');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        const val = stmt.namedArgs[0].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(2);
          expect(val.elements[0]).toMatchObject({ type: 'NumberLit', value: 15 });
          expect(val.elements[1]).toMatchObject({ type: 'NumberLit', value: 15 });
        }
      }
    });

    it('parses bare at: without parens (3 values)', () => {
      const stmt = parseFirst('box 10 10 3 at:15 15 20');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        const val = stmt.namedArgs[0].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(3);
        }
      }
    });

    it('parses bare at: followed by pipe', () => {
      const stmt = parseFirst('box 10 10 3 at:15 15 | fillet 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('BoxExpr');
        if (stmt.source.type === 'BoxExpr') {
          expect(stmt.source.namedArgs).toHaveLength(1);
          expect(stmt.source.namedArgs[0].key).toBe('at');
          const val = stmt.source.namedArgs[0].value;
          expect(val.type).toBe('TupleLit');
          if (val.type === 'TupleLit') {
            expect(val.elements).toHaveLength(2);
          }
        }
        expect(stmt.ops).toHaveLength(1);
      }
    });

    it('parses bare at: with multiple named args', () => {
      const stmt = parseFirst('rect 10 5 angle:45 at:3 4');
      expect(stmt.type).toBe('RectExpr');
      if (stmt.type === 'RectExpr') {
        expect(stmt.args).toHaveLength(2);
        expect(stmt.namedArgs).toHaveLength(2);
        expect(stmt.namedArgs[0].key).toBe('angle');
        expect(stmt.namedArgs[0].value).toMatchObject({ type: 'NumberLit', value: 45 });
        expect(stmt.namedArgs[1].key).toBe('at');
        const val = stmt.namedArgs[1].value;
        expect(val.type).toBe('TupleLit');
        if (val.type === 'TupleLit') {
          expect(val.elements).toHaveLength(2);
        }
      }
    });

    // Placement edge cases from parser-extra.test.ts
    it('parses at: with list literal', () => {
      const stmt = parseFirst('cylinder 5 10 at:[(0, 0), (20, 10)]');
      expect(stmt.type).toBe('CylinderExpr');
      if (stmt.type === 'CylinderExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('ListLit');
      }
    });

    it('parses at: with negative numbers via parens', () => {
      const stmt = parseFirst('cylinder 5 10 at:(-5, -10)');
      expect(stmt.type).toBe('CylinderExpr');
      if (stmt.type === 'CylinderExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
        if (stmt.namedArgs[0].value.type === 'TupleLit') {
          expect(stmt.namedArgs[0].value.elements).toHaveLength(2);
          expect(stmt.namedArgs[0].value.elements[0].type).toBe('UnaryNeg');
          expect(stmt.namedArgs[0].value.elements[1].type).toBe('UnaryNeg');
        }
      }
    });

    it('parses at: with dollar var ref via parens', () => {
      const stmt = parseFirst('cylinder 5 10 at:($x, $y)');
      expect(stmt.type).toBe('CylinderExpr');
      if (stmt.type === 'CylinderExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
      }
    });

    it('parses func call with at: named arg', () => {
      const stmt = parseFirst('myFunc 10 at:(5, 5)');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.name).toBe('myFunc');
        expect(stmt.args).toHaveLength(1);
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
      }
    });

    it('parses paren-style func call with at: named arg', () => {
      const stmt = parseFirst('myFunc(10, at:(5, 5))');
      expect(stmt.type).toBe('FuncCall');
      if (stmt.type === 'FuncCall') {
        expect(stmt.name).toBe('myFunc');
        expect(stmt.args).toHaveLength(1);
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
      }
    });

    it('parses union with at named arg', () => {
      const stmt = parseFirst('union [box 10 10 10, sphere 5] at:(20, 20)');
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
      }
    });

    // Grid/polar parser tests from grid-at.test.ts
    it('parses grid as a pipe op', () => {
      const ast = parse('box 10 10 3 | grid 4 3 20');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops).toHaveLength(1);
      expect(stmt.ops[0].type).toBe('GridPipe');
    });

    it('parses polar as a pipe op', () => {
      const ast = parse('cylinder 5 10 | polar count:6 radius:15');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops).toHaveLength(1);
      expect(stmt.ops[0].type).toBe('PolarPipe');
    });

    it('parses polar with orient:true', () => {
      const ast = parse('cylinder 5 10 | polar 6 15 orient:true');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops).toHaveLength(1);
      const op = stmt.ops[0] as PolarPipe;
      expect(op.type).toBe('PolarPipe');
      expect(op.namedArgs.some(a => a.key === 'orient')).toBe(true);
    });

    it('parses name[idx] as index access, not func call', () => {
      const ast = parse('def f(k) = ss[k] * (ha - inv(ri[k]))');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('FuncDef');
    });

    it('parses func [list] with space as func call', () => {
      const ast = parse('f [1, 2, 3]');
      expect(ast.statements[0].type).toBe('FuncCall');
    });

    it('grid + translate chain', () => {
      const ast = parse('box 10 10 3 | grid 2 2 20 | translate 50 0');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops).toHaveLength(2);
      expect(stmt.ops[0].type).toBe('GridPipe');
      expect(stmt.ops[1].type).toBe('Translate');
    });

    it('parses faces top | polar 6 20 as shorthand', () => {
      const ast = parse('box 10 10 10 | faces top | polar 6 20 | circle 3 | cut');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops.map(o => o.type)).toEqual([
        'FacesSelect', 'PolarPipe', 'Implicit2DPrimitive', 'Cut',
      ]);
    });

    it('parses faces top | grid 2 3 20 as shorthand', () => {
      const ast = parse('box 10 10 10 | faces top | grid 2 3 20 | circle 3 | cut');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      expect(stmt.ops.map(o => o.type)).toEqual([
        'FacesSelect', 'GridPipe', 'Implicit2DPrimitive', 'Cut',
      ]);
    });

    it('parses points polar 6 20 without parens', () => {
      const ast = parse('box 10 10 10 | faces top | points polar 6 20 | circle 3 | cut');
      const stmt = ast.statements[0] as Pipeline;
      expect(stmt.type).toBe('Pipeline');
      const pointsOp = stmt.ops[1];
      expect(pointsOp.type).toBe('PointsSelect');
      expect((pointsOp as any).args).toHaveLength(1);
      expect((pointsOp as any).args[0].type).toBe('PolarPipe');
    });

    it('parses points grid 2 3 20 without parens', () => {
      const ast = parse('box 10 10 10 | faces top | points grid 2 3 20 | circle 3 | cut');
      const stmt = ast.statements[0] as Pipeline;
      const pointsOp = stmt.ops[1];
      expect(pointsOp.type).toBe('PointsSelect');
      expect((pointsOp as any).args).toHaveLength(1);
      expect((pointsOp as any).args[0].type).toBe('GridPipe');
    });

    it('points (polar 6 20) with parens still works', () => {
      const ast = parse('box 10 10 10 | faces top | points (polar 6 20) | circle 3 | cut');
      const stmt = ast.statements[0] as Pipeline;
      const pointsOp = stmt.ops[1];
      expect(pointsOp.type).toBe('PointsSelect');
      expect((pointsOp as any).args).toHaveLength(1);
      expect((pointsOp as any).args[0].type).toBe('PolarPipe');
    });

    // Points select from parser-extra.test.ts
    it('parses points with list of tuples', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)]');
      expect(ops[1].type).toBe('PointsSelect');
      if (ops[1].type === 'PointsSelect') {
        expect(ops[1].args).toHaveLength(1);
      }
    });
  });

  // ===========================================================================
  // Evaluator — grid pipe operation
  // ===========================================================================

  describe('evaluator', () => {
    it('box | grid 4 3 pitch:10 produces 12 copies', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 3 | grid 4 3 pitch:10');
      const _result = evaluator.evaluate(ast);

      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      const compoundCalls = oc._calls.filter((c: any) => c.method === 'makeCompound');
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');

      expect(compoundCalls.length).toBe(1);
      expect(fuseCalls.length).toBe(0);
      expect(translateCalls.length).toBe(13);
    });

    it('pitch: keyword sets grid pitch', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 3 | grid 4 3 pitch:20');
      evaluator.evaluate(ast);

      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      const firstGridTranslate = translateCalls[1];
      expect(firstGridTranslate.args[1]).toBe(-30); // x
      expect(firstGridTranslate.args[2]).toBe(-20); // y
    });

    it('3rd positional arg sets pitch: grid 4 3 20', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 3 | grid 4 3 20');
      evaluator.evaluate(ast);

      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      const compoundCalls = oc._calls.filter((c: any) => c.method === 'makeCompound');

      expect(compoundCalls.length).toBe(1);
      const firstGridTranslate = translateCalls[1];
      expect(firstGridTranslate.args[1]).toBe(-30); // x
      expect(firstGridTranslate.args[2]).toBe(-20); // y
    });

    it('positional and keyword pitch produce identical results', () => {
      const sources = [
        'box 10 10 3 | grid 4 3 20',
        'box 10 10 3 | grid 4 3 pitch:20',
      ];

      const results = sources.map(src => {
        const oc = createMockOC();
        const evaluator = new Evaluator({ oc });
        const ast = parse(src);
        evaluator.evaluate(ast);
        return oc._calls.filter((c: any) => c.method === 'translate')
          .map((c: any) => [c.args[1], c.args[2], c.args[3]]);
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toEqual(results[0]);
      }
    });
  });
});
