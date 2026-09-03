import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import type { Expression, PipeOp, Statement, ColorOp } from '../src/ast.js';
import {
  NAMED_COLORS,
  parseHexColor,
  normalizeRGB,
  resolveColor,
} from '../src/colors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parser -- color pipe op', () => {
  it('parses | color "red"', () => {
    const { ops } = parsePipeline('box 10 10 10 | color "red"');
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('Color');
    const colorOp = ops[0] as ColorOp;
    expect(colorOp.args).toHaveLength(1);
    expect(colorOp.args[0]).toMatchObject({ type: 'StringLit', value: 'red' });
    expect(colorOp.namedArgs).toHaveLength(0);
  });

  it('parses | color 0.8 0.2 0.1', () => {
    const { ops } = parsePipeline('box 10 10 10 | color 0.8 0.2 0.1');
    expect(ops).toHaveLength(1);
    const colorOp = ops[0] as ColorOp;
    expect(colorOp.args).toHaveLength(3);
    expect(colorOp.args[0]).toMatchObject({ type: 'NumberLit', value: 0.8 });
    expect(colorOp.args[1]).toMatchObject({ type: 'NumberLit', value: 0.2 });
    expect(colorOp.args[2]).toMatchObject({ type: 'NumberLit', value: 0.1 });
  });

  it('parses | color "#FF0000"', () => {
    const { ops } = parsePipeline('box 10 10 10 | color "#FF0000"');
    expect(ops).toHaveLength(1);
    const colorOp = ops[0] as ColorOp;
    expect(colorOp.args).toHaveLength(1);
    expect(colorOp.args[0]).toMatchObject({ type: 'StringLit', value: '#FF0000' });
  });

  it('parses | color "red" alpha:0.5', () => {
    const { ops } = parsePipeline('box 10 10 10 | color "red" alpha:0.5');
    expect(ops).toHaveLength(1);
    const colorOp = ops[0] as ColorOp;
    expect(colorOp.args).toHaveLength(1);
    expect(colorOp.args[0]).toMatchObject({ type: 'StringLit', value: 'red' });
    expect(colorOp.namedArgs).toHaveLength(1);
    expect(colorOp.namedArgs[0].key).toBe('alpha');
    expect(colorOp.namedArgs[0].value).toMatchObject({ type: 'NumberLit', value: 0.5 });
  });

  it('parses | color 255 128 0', () => {
    const { ops } = parsePipeline('box 10 10 10 | color 255 128 0');
    expect(ops).toHaveLength(1);
    const colorOp = ops[0] as ColorOp;
    expect(colorOp.args).toHaveLength(3);
    expect(colorOp.args[0]).toMatchObject({ type: 'NumberLit', value: 255 });
    expect(colorOp.args[1]).toMatchObject({ type: 'NumberLit', value: 128 });
    expect(colorOp.args[2]).toMatchObject({ type: 'NumberLit', value: 0 });
  });

  it('color can chain with other ops', () => {
    const { ops } = parsePipeline('box 10 10 10 | color "red" | fillet 2');
    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe('Color');
    expect(ops[1].type).toBe('Fillet');
  });
});

// ---------------------------------------------------------------------------
// Color palette tests
// ---------------------------------------------------------------------------

describe('color palette', () => {
  it('NAMED_COLORS["red"] = [1, 0, 0]', () => {
    expect(NAMED_COLORS.red).toEqual([1, 0, 0]);
  });

  it('NAMED_COLORS["green"] = [0, ~0.502, 0]', () => {
    const g = NAMED_COLORS.green;
    expect(g[0]).toBe(0);
    expect(g[1]).toBeCloseTo(128 / 255, 5);
    expect(g[2]).toBe(0);
  });

  it('NAMED_COLORS["silver"] exists (Tier 2)', () => {
    expect(NAMED_COLORS.silver).toBeDefined();
    expect(NAMED_COLORS.silver[0]).toBeCloseTo(192 / 255, 5);
  });

  it('NAMED_COLORS["coral"] exists (Tier 3 / CSS)', () => {
    expect(NAMED_COLORS.coral).toBeDefined();
  });

  it('grey is an alias for gray', () => {
    expect(NAMED_COLORS.grey).toEqual(NAMED_COLORS.gray);
  });

  it('darkgrey is an alias for darkgray', () => {
    expect(NAMED_COLORS.darkgrey).toEqual(NAMED_COLORS.darkgray);
  });
});

// ---------------------------------------------------------------------------
// HEX parser tests
// ---------------------------------------------------------------------------

describe('parseHexColor', () => {
  it('"#FF0000" -> [1, 0, 0]', () => {
    expect(parseHexColor('#FF0000')).toEqual([1, 0, 0]);
  });

  it('"#F00" -> [1, 0, 0]', () => {
    expect(parseHexColor('#F00')).toEqual([1, 0, 0]);
  });

  it('"#00FF00" -> [0, 1, 0]', () => {
    expect(parseHexColor('#00FF00')).toEqual([0, 1, 0]);
  });

  it('"#abc" -> correct values', () => {
    const result = parseHexColor('#abc');
    expect(result).not.toBeNull();
    expect(result![0]).toBeCloseTo(0xaa / 255, 5);
    expect(result![1]).toBeCloseTo(0xbb / 255, 5);
    expect(result![2]).toBeCloseTo(0xcc / 255, 5);
  });

  it('returns null for invalid hex', () => {
    expect(parseHexColor('#GG0000')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('FF0000')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RGB normalization tests
// ---------------------------------------------------------------------------

describe('normalizeRGB', () => {
  it('(255, 128, 0) -> (1, ~0.502, 0)', () => {
    const [r, g, b] = normalizeRGB(255, 128, 0);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(128 / 255, 3);
    expect(b).toBe(0);
  });

  it('(0.5, 0.3, 0.1) -> unchanged', () => {
    const [r, g, b] = normalizeRGB(0.5, 0.3, 0.1);
    expect(r).toBe(0.5);
    expect(g).toBe(0.3);
    expect(b).toBe(0.1);
  });

  it('(1, 1, 1) -> unchanged (all <= 1)', () => {
    expect(normalizeRGB(1, 1, 1)).toEqual([1, 1, 1]);
  });

  it('(2, 0, 0) -> treated as 0..255', () => {
    const [r, g, b] = normalizeRGB(2, 0, 0);
    expect(r).toBeCloseTo(2 / 255, 5);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveColor tests
// ---------------------------------------------------------------------------

describe('resolveColor', () => {
  it('resolves named color "red"', () => {
    expect(resolveColor('red')).toEqual([1, 0, 0]);
  });

  it('resolves HEX "#FF0000"', () => {
    expect(resolveColor('#FF0000')).toEqual([1, 0, 0]);
  });

  it('resolves RGB tuple', () => {
    expect(resolveColor([0.5, 0.3, 0.1])).toEqual([0.5, 0.3, 0.1]);
  });

  it('resolves RGB 0..255 tuple', () => {
    const [r, g, b] = resolveColor([255, 128, 0]);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(128 / 255, 3);
    expect(b).toBe(0);
  });

  it('is case-insensitive for named colors', () => {
    expect(resolveColor('RED')).toEqual([1, 0, 0]);
    expect(resolveColor('Red')).toEqual([1, 0, 0]);
  });

  it('throws on unknown color name', () => {
    expect(() => resolveColor('notacolor')).toThrow('Unknown color name: "notacolor"');
  });
});

// ---------------------------------------------------------------------------
// Evaluator integration tests (using mock OC)
// ---------------------------------------------------------------------------

describe('evaluator -- color op on WpState', () => {
  // Import the evalColorOp function directly to test with a mock WpState
  it('sets color on WpState for named color', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockState = createMockWpState();
    const op: ColorOp = {
      type: 'Color',
      args: [{ type: 'StringLit', value: 'red' }],
      namedArgs: [],
    };

    const result = evalColorOp(mockState, op, evalMockExpr);
    expect(result.color).toEqual([1, 0, 0]);
    expect(result.alpha).toBe(1.0);
  });

  it('sets color on WpState for HEX', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockState = createMockWpState();
    const op: ColorOp = {
      type: 'Color',
      args: [{ type: 'StringLit', value: '#00FF00' }],
      namedArgs: [],
    };

    const result = evalColorOp(mockState, op, evalMockExpr);
    expect(result.color).toEqual([0, 1, 0]);
  });

  it('sets color on WpState for RGB float', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockState = createMockWpState();
    const op: ColorOp = {
      type: 'Color',
      args: [
        { type: 'NumberLit', value: 0.8 },
        { type: 'NumberLit', value: 0.2 },
        { type: 'NumberLit', value: 0.1 },
      ],
      namedArgs: [],
    };

    const result = evalColorOp(mockState, op, evalMockExpr);
    expect(result.color).toEqual([0.8, 0.2, 0.1]);
  });

  it('sets color on WpState for RGB int (auto-normalize)', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockState = createMockWpState();
    const op: ColorOp = {
      type: 'Color',
      args: [
        { type: 'NumberLit', value: 255 },
        { type: 'NumberLit', value: 128 },
        { type: 'NumberLit', value: 0 },
      ],
      namedArgs: [],
    };

    const result = evalColorOp(mockState, op, evalMockExpr);
    expect(result.color![0]).toBeCloseTo(1, 5);
    expect(result.color![1]).toBeCloseTo(128 / 255, 3);
    expect(result.color![2]).toBe(0);
  });

  it('sets alpha from named arg', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockState = createMockWpState();
    const op: ColorOp = {
      type: 'Color',
      args: [{ type: 'StringLit', value: 'blue' }],
      namedArgs: [{ key: 'alpha', value: { type: 'NumberLit', value: 0.5 } }],
    };

    const result = evalColorOp(mockState, op, evalMockExpr);
    expect(result.color).toEqual([0, 0, 1]);
    expect(result.alpha).toBe(0.5);
  });

  it('throws on unknown color name', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockState = createMockWpState();
    const op: ColorOp = {
      type: 'Color',
      args: [{ type: 'StringLit', value: 'notacolor' }],
      namedArgs: [],
    };

    expect(() => evalColorOp(mockState, op, evalMockExpr)).toThrow('Unknown color name');
  });

  it('preserves shape when setting color', async () => {
    const { evalColorOp } = await import('../src/eval/pipe-color.js');

    const mockShape = { id: 'mock-shape' };
    const mockState = createMockWpState(mockShape as any);
    const op: ColorOp = {
      type: 'Color',
      args: [{ type: 'StringLit', value: 'red' }],
      namedArgs: [],
    };

    const result = evalColorOp(mockState, op, evalMockExpr);
    expect(result.shape).toBe(mockShape);
    expect(result.color).toEqual([1, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockWpState(shape: any = null): any {
  return {
    oc: {},
    plane: {
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      xDir: { x: 1, y: 0, z: 0 },
      yDir: { x: 0, y: 1, z: 0 },
    },
    shape,
    wires: [],
    selectedFaces: [],
    selectedEdges: [],
    selectedVertices: [],
    tags: new Map(),
    points: null,
    centerX: 0,
    centerY: 0,
  };
}

function evalMockExpr(expr: Expression): any {
  switch (expr.type) {
    case 'NumberLit': return expr.value;
    case 'StringLit': return expr.value;
    case 'BoolConst': return expr.value;
    default: throw new Error(`Mock evaluator cannot handle ${expr.type}`);
  }
}
