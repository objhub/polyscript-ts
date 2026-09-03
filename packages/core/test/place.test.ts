/**
 * Tests for the `place` pipe operation.
 * - Parser: correctly parses `place $var`, `place sketch [...]`, `place (rect ...)`
 * - Validator: accepts place in face/workplane/2D/vertex/point contexts, rejects in 3D/edge
 * - Evaluator: place produces 2D context with wires from the referenced shape
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parser - place pipe op', () => {
  it('parses place with variable reference', () => {
    const { ops } = parsePipeline('box 10 10 10 | faces >Z | place $s');
    const placeOp = ops.find(o => o.type === 'Place');
    expect(placeOp).toBeDefined();
    if (placeOp && 'args' in placeOp) {
      expect(placeOp.args).toHaveLength(1);
      expect(placeOp.args[0]).toMatchObject({ type: 'VarRef', name: 's' });
    }
  });

  it('parses place with inline sketch', () => {
    const { ops } = parsePipeline('box 10 10 10 | faces >Z | place sketch [(5,0), (0,5), (-5,0), (5,0)]');
    const placeOp = ops.find(o => o.type === 'Place');
    expect(placeOp).toBeDefined();
    if (placeOp && 'args' in placeOp) {
      expect(placeOp.args).toHaveLength(1);
      expect(placeOp.args[0].type).toBe('SketchExpr');
    }
  });

  it('parses place with inline rect', () => {
    const { ops } = parsePipeline('box 10 10 10 | faces >Z | place rect 5 5');
    const placeOp = ops.find(o => o.type === 'Place');
    expect(placeOp).toBeDefined();
    if (placeOp && 'args' in placeOp) {
      expect(placeOp.args).toHaveLength(1);
      expect(placeOp.args[0].type).toBe('RectExpr');
    }
  });

  it('parses place followed by cut', () => {
    const { ops } = parsePipeline('box 10 10 10 | faces >Z | place $s | cut');
    expect(ops.map(o => o.type)).toEqual(['FacesSelect', 'Place', 'Cut']);
  });

  it('parses place followed by extrude', () => {
    const { ops } = parsePipeline('box 10 10 10 | faces >Z | place $s | extrude 5');
    expect(ops.map(o => o.type)).toEqual(['FacesSelect', 'Place', 'Extrude']);
  });
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe('validator - place context', () => {
  it('accepts place in FaceSelection context', () => {
    const errors = getErrors('box 10 10 10 | faces >Z | place $s | cut');
    const placeErrors = errors.filter(e => e.nodeType === 'Place');
    expect(placeErrors).toHaveLength(0);
  });

  it('accepts place in 2D context (after another 2D op)', () => {
    const errors = getErrors('box 10 10 10 | faces >Z | circle 5 | place $s | cut');
    const placeErrors = errors.filter(e => e.nodeType === 'Place');
    expect(placeErrors).toHaveLength(0);
  });

  it('rejects place in 3D context', () => {
    const errors = getErrors('box 10 10 10 | place $s');
    const placeErrors = errors.filter(e => e.nodeType === 'Place');
    expect(placeErrors.length).toBeGreaterThan(0);
    expect(placeErrors[0].message).toContain('not valid in 3D');
  });

  it('rejects place in EdgeSelection context', () => {
    const errors = getErrors('box 10 10 10 | edges >Z | place $s');
    const placeErrors = errors.filter(e => e.nodeType === 'Place');
    expect(placeErrors.length).toBeGreaterThan(0);
    expect(placeErrors[0].message).toContain('not valid in EdgeSelection');
  });

  it('place transitions to 2D context (extrude is valid after place)', () => {
    const errors = getErrors('box 10 10 10 | faces >Z | place $s | extrude 5');
    const extrudeErrors = errors.filter(e => e.nodeType === 'Extrude');
    expect(extrudeErrors).toHaveLength(0);
  });
});
