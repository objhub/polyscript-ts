/**
 * Tests for Phase 3.1 C2: whitespace-aware +/- in greedy argument context.
 *
 * Rules:
 * - `a + b` (spaced +) is always binary addition within a greedy arg
 * - `a - b` (spaced -) is binary subtraction within a greedy arg
 * - `-5`   (no trailing space) is unary minus, starts a new greedy arg
 * - `f -a` (no trailing space) is unary minus, starts a new greedy arg
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
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

describe('greedy arithmetic: whitespace-aware binary minus', () => {
  // --- Core verification cases from the spec ---

  it('extrude h + 5 -> extrude(h+5), 1 arg with binary add', () => {
    const { ops } = parsePipeline('circle 10 | extrude h + 5');
    expect(ops).toHaveLength(1);
    const ext = ops[0];
    expect(ext.type).toBe('Extrude');
    if (ext.type === 'Extrude') {
      expect(ext.args).toHaveLength(1);
      expect(ext.args[0].type).toBe('BinOp');
      if (ext.args[0].type === 'BinOp') {
        expect(ext.args[0].op).toBe('+');
      }
    }
  });

  it('extrude h - 5 -> extrude(h-5), 1 arg with binary sub', () => {
    const { ops } = parsePipeline('circle 10 | extrude h - 5');
    expect(ops).toHaveLength(1);
    const ext = ops[0];
    expect(ext.type).toBe('Extrude');
    if (ext.type === 'Extrude') {
      expect(ext.args).toHaveLength(1);
      expect(ext.args[0].type).toBe('BinOp');
      if (ext.args[0].type === 'BinOp') {
        expect(ext.args[0].op).toBe('-');
        expect(ext.args[0].left.type).toBe('VarRef');
        expect(ext.args[0].right.type).toBe('NumberLit');
      }
    }
  });

  it('box 10 -5 10 -> box(10, -5, 10), 3 args (regression)', () => {
    const stmt = parseFirst('box 10 -5 10');
    expect(stmt.type).toBe('BoxExpr');
    if (stmt.type === 'BoxExpr') {
      expect(stmt.args).toHaveLength(3);
      expect(stmt.args[0].type).toBe('NumberLit');
      expect(stmt.args[1].type).toBe('UnaryNeg');
      expect(stmt.args[2].type).toBe('NumberLit');
    }
  });

  it('cylinder r1 + 1 r1 + 2 -> cylinder(r1+1, r1+2), 2 binary args', () => {
    const stmt = parseFirst('cylinder r1 + 1 r1 + 2');
    expect(stmt.type).toBe('CylinderExpr');
    if (stmt.type === 'CylinderExpr') {
      expect(stmt.args).toHaveLength(2);
      expect(stmt.args[0].type).toBe('BinOp');
      expect(stmt.args[1].type).toBe('BinOp');
      if (stmt.args[0].type === 'BinOp') {
        expect(stmt.args[0].op).toBe('+');
      }
      if (stmt.args[1].type === 'BinOp') {
        expect(stmt.args[1].op).toBe('+');
      }
    }
  });

  it('f -a -> f(-a), 1 arg with unary minus (no trailing space)', () => {
    // "f" is not a keyword, so it becomes a greedy function call
    const stmt = parseFirst('$x = f(-$a)');
    if (stmt.type === 'Assignment') {
      const call = stmt.value;
      expect(call.type).toBe('FuncCall');
      if (call.type === 'FuncCall') {
        expect(call.args).toHaveLength(1);
        expect(call.args[0].type).toBe('UnaryNeg');
      }
    }
  });

  // --- Mixed operations ---

  it('extrude h - 5 + 2 -> binary sub then add', () => {
    const { ops } = parsePipeline('circle 10 | extrude h - 5 + 2');
    const ext = ops[0];
    expect(ext.type).toBe('Extrude');
    if (ext.type === 'Extrude') {
      expect(ext.args).toHaveLength(1);
      // Should parse as (h - 5) + 2
      const expr = ext.args[0];
      expect(expr.type).toBe('BinOp');
      if (expr.type === 'BinOp') {
        expect(expr.op).toBe('+');
        expect(expr.left.type).toBe('BinOp');
        if (expr.left.type === 'BinOp') {
          expect(expr.left.op).toBe('-');
        }
      }
    }
  });

  it('translate x - 1 y - 2 z -> 3 args with binary sub', () => {
    const { ops } = parsePipeline('box 10 10 10 | translate x - 1 y - 2 z');
    const tr = ops[0];
    expect(tr.type).toBe('Translate');
    if (tr.type === 'Translate') {
      expect(tr.args).toHaveLength(3);
      // First arg: x - 1
      expect(tr.args[0].type).toBe('BinOp');
      if (tr.args[0].type === 'BinOp') {
        expect(tr.args[0].op).toBe('-');
      }
      // Second arg: y - 2
      expect(tr.args[1].type).toBe('BinOp');
      if (tr.args[1].type === 'BinOp') {
        expect(tr.args[1].op).toBe('-');
      }
      // Third arg: z (plain variable)
      expect(tr.args[2].type).toBe('VarRef');
    }
  });

  // --- Regression: unary minus remains correct ---

  it('offset -10 -> 1 arg with unary neg (no trailing space)', () => {
    const { ops } = parsePipeline('box 80 60 10 | faces >Z | offset -10');
    const offset = ops[1];
    expect(offset.type).toBe('Offset');
    if (offset.type === 'Offset') {
      expect(offset.args).toHaveLength(1);
      expect(offset.args[0].type).toBe('UnaryNeg');
    }
  });

  it('fillet 4 -1 -> 2 args (4, unary -1)', () => {
    const { ops } = parsePipeline('box 10 10 10 | fillet 4 -1');
    const fillet = ops[0];
    expect(fillet.type).toBe('Fillet');
    if (fillet.type === 'Fillet') {
      expect(fillet.args).toHaveLength(2);
      expect(fillet.args[0].type).toBe('NumberLit');
      expect(fillet.args[1].type).toBe('UnaryNeg');
    }
  });

  it('fillet -1 -> 1 arg with unary neg', () => {
    const { ops } = parsePipeline('box 10 10 10 | fillet -1');
    const fillet = ops[0];
    expect(fillet.type).toBe('Fillet');
    if (fillet.type === 'Fillet') {
      expect(fillet.args).toHaveLength(1);
      expect(fillet.args[0].type).toBe('UnaryNeg');
    }
  });

  it('named arg with negative value: at:0 0 -5 -> unary neg (no trailing space)', () => {
    const stmt = parseFirst('circle 8 at:0 0 -5');
    expect(stmt.type).toBe('CircleExpr');
    if (stmt.type === 'CircleExpr') {
      const atArg = stmt.namedArgs.find((a: { key: string }) => a.key === 'at');
      expect(atArg).toBeDefined();
      if (atArg && atArg.value.type === 'TupleLit') {
        expect(atArg.value.elements).toHaveLength(3);
        expect(atArg.value.elements[2].type).toBe('UnaryNeg');
      }
    }
  });

  // --- Edge case: subtraction with multiplication ---

  it('extrude h - 2 * 3 -> extrude(h - (2*3)), precedence preserved', () => {
    const { ops } = parsePipeline('circle 10 | extrude h - 2 * 3');
    const ext = ops[0];
    expect(ext.type).toBe('Extrude');
    if (ext.type === 'Extrude') {
      expect(ext.args).toHaveLength(1);
      const expr = ext.args[0];
      expect(expr.type).toBe('BinOp');
      if (expr.type === 'BinOp') {
        expect(expr.op).toBe('-');
        expect(expr.right.type).toBe('BinOp');
        if (expr.right.type === 'BinOp') {
          expect(expr.right.op).toBe('*');
        }
      }
    }
  });

  // --- Spaced minus with variables ---

  it('sphere r - 1 -> sphere(r - 1), 1 arg with binary sub', () => {
    const stmt = parseFirst('sphere r - 1');
    expect(stmt.type).toBe('SphereExpr');
    if (stmt.type === 'SphereExpr') {
      expect(stmt.args).toHaveLength(1);
      expect(stmt.args[0].type).toBe('BinOp');
      if (stmt.args[0].type === 'BinOp') {
        expect(stmt.args[0].op).toBe('-');
      }
    }
  });

  it('fillet r - 0.5 -> fillet(r - 0.5), 1 arg with binary sub', () => {
    const { ops } = parsePipeline('box 10 10 10 | fillet r - 0.5');
    const fillet = ops[0];
    expect(fillet.type).toBe('Fillet');
    if (fillet.type === 'Fillet') {
      expect(fillet.args).toHaveLength(1);
      expect(fillet.args[0].type).toBe('BinOp');
      if (fillet.args[0].type === 'BinOp') {
        expect(fillet.args[0].op).toBe('-');
      }
    }
  });
});
