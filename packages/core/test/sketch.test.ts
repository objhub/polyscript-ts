/**
 * Tests for sketch 2D primitive.
 *
 * Covers parser, validator, and evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator, } from '../src/evaluator.js';
import type { Expression, Pipeline, SketchExpr } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';

/** Parse and return the first statement. */
function parseFirst(source: string): Expression {
  const program = parse(source);
  expect(program.statements.length).toBeGreaterThan(0);
  return program.statements[0] as Expression;
}

/** Get validation errors for source. */
function getErrors(source: string) {
  const ast = parse(source);
  return validate(ast);
}

/** Check if a value is a WpState. */
function isWpState(v: any): v is WpState {
  return v !== null && typeof v === 'object' && 'oc' in v && 'plane' in v;
}

/** Build a mock OcctKernel that tracks calls and returns dummy handles. */
function createMockOC() {
  let handleCounter = 100;
  const nextHandle = () => ++handleCounter as any;

  const calls: { method: string; args: any[] }[] = [];

  const mock = {
    _calls: calls,
    makeLineEdge(start: any, end: any) { calls.push({ method: 'makeLineEdge', args: [start, end] }); return nextHandle(); },
    makeArcEdge(start: any, mid: any, end: any) { calls.push({ method: 'makeArcEdge', args: [start, mid, end] }); return nextHandle(); },
    makeBezierEdge(pts: any[]) { calls.push({ method: 'makeBezierEdge', args: [pts] }); return nextHandle(); },
    makeWire(edges: any[]) { calls.push({ method: 'makeWire', args: [edges] }); return nextHandle(); },
    makeFace(wire: any) { calls.push({ method: 'makeFace', args: [wire] }); return nextHandle(); },
    makeCircleEdge(center: any, normal: any, r: number) { calls.push({ method: 'makeCircleEdge', args: [center, normal, r] }); return nextHandle(); },
    makeEllipseEdge(center: any, normal: any, major: number, minor: number) { calls.push({ method: 'makeEllipseEdge', args: [center, normal, major, minor] }); return nextHandle(); },
    extrude(shape: any, dx: number, dy: number, dz: number) { calls.push({ method: 'extrude', args: [shape, dx, dy, dz] }); return nextHandle(); },
    draftPrism(shape: any, dx: number, dy: number, dz: number, angle: number) { calls.push({ method: 'draftPrism', args: [shape, dx, dy, dz, angle] }); return nextHandle(); },
    revolve(shape: any, axis: any, angle: number) { calls.push({ method: 'revolve', args: [shape, axis, angle] }); return nextHandle(); },
    fillet(shape: any, edges: any[], r: number) { calls.push({ method: 'fillet', args: [shape, edges, r] }); return nextHandle(); },
    chamfer(shape: any, edges: any[], d: number) { calls.push({ method: 'chamfer', args: [shape, edges, d] }); return nextHandle(); },
    shell(shape: any, faces: any[], t: number) { calls.push({ method: 'shell', args: [shape, faces, t] }); return nextHandle(); },
    fuse(a: any, b: any) { calls.push({ method: 'fuse', args: [a, b] }); return nextHandle(); },
    cut(a: any, b: any) { calls.push({ method: 'cut', args: [a, b] }); return nextHandle(); },
    translate(shape: any, dx: number, dy: number, dz: number) { calls.push({ method: 'translate', args: [shape, dx, dy, dz] }); return nextHandle(); },
    rotate(shape: any, axis: any, angle: number) { calls.push({ method: 'rotate', args: [shape, axis, angle] }); return nextHandle(); },
    scale(shape: any, center: any, factor: number) { calls.push({ method: 'scale', args: [shape, center, factor] }); return nextHandle(); },
    generalTransform(shape: any, matrix: number[]) { calls.push({ method: 'generalTransform', args: [shape, matrix] }); return nextHandle(); },
    makeBox(dx: number, dy: number, dz: number) { calls.push({ method: 'makeBox', args: [dx, dy, dz] }); return nextHandle(); },
    makeCylinder(r: number, h: number) { calls.push({ method: 'makeCylinder', args: [r, h] }); return nextHandle(); },
    makeSphere(r: number) { calls.push({ method: 'makeSphere', args: [r] }); return nextHandle(); },
    pipe(face: any, spine: any) { calls.push({ method: 'pipe', args: [face, spine] }); return nextHandle(); },
    buildCurves3d(wire: any) { calls.push({ method: 'buildCurves3d', args: [wire] }); },
    interpolatePoints(pts: any[]) { calls.push({ method: 'interpolatePoints', args: [pts] }); return nextHandle(); },
    getBoundingBox(_shape: any) {
      return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 };
    },
    getBoundingBoxFast(_shape: any) {
      return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 };
    },
    getSubShapes(_shape: any, type: string) {
      if (type === 'edge') return [nextHandle(), nextHandle(), nextHandle()];
      if (type === 'face') return [nextHandle()];
      return [];
    },
    getCenterOfMass(_face: any) { return { x: 0, y: 0, z: 5 }; },
    uvBounds(_face: any) { return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }; },
    surfaceNormal(_face: any, _u: number, _v: number) { return { x: 0, y: 0, z: 1 }; },
    makeHelixWire(origin: any, axis: any, pitch: number, height: number, radius: number) {
      calls.push({ method: 'makeHelixWire', args: [origin, axis, pitch, height, radius] });
      return nextHandle();
    },
  } as any;

  return mock;
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parser -- sketch', () => {
  it('parses sketch with line segments only', () => {
    const stmt = parseFirst('sketch [(0, 0), (10, 0), (10, 10), (0, 0)]');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.start.type).toBe('TupleLit');
    expect(sk.segments).toHaveLength(3);
    // All segments are tuples (line endpoints)
    for (const seg of sk.segments) {
      expect(seg.type).toBe('TupleLit');
    }
  });

  it('parses sketch with arc segment (3-arg: start through end)', () => {
    const stmt = parseFirst('sketch [(5, 0), arc (5, 0) (0, -5) (-5, 0), (0, 7), (5, 0)]');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.start.type).toBe('TupleLit');
    expect(sk.segments).toHaveLength(3);
    // First segment is an arc
    expect(sk.segments[0].type).toBe('ArcPathExpr');
    if (sk.segments[0].type === 'ArcPathExpr') {
      expect(sk.segments[0].args).toHaveLength(3);
    }
    // Remaining are tuples
    expect(sk.segments[1].type).toBe('TupleLit');
    expect(sk.segments[2].type).toBe('TupleLit');
  });

  it('parses sketch with bezier segment', () => {
    const stmt = parseFirst('sketch [(0, 0), bezier [(5, 10), (10, 10), (10, 0)], (0, 0)]');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(2);
    expect(sk.segments[0].type).toBe('BezierPathExpr');
    expect(sk.segments[1].type).toBe('TupleLit');
  });

  it('parses sketch with spline segment', () => {
    const stmt = parseFirst('sketch [(0, 0), (10, 0), spline [(15, 5), (20, 0)]]');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(2);
    expect(sk.segments[0].type).toBe('TupleLit');
    expect(sk.segments[1].type).toBe('SplinePathExpr');
  });

  it('parses multi-line sketch', () => {
    const source = `sketch [
  (5, 0),
  arc (5, 0) (0, -5) (-5, 0),
  (0, 7),
  (5, 0)
]`;
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(3);
    expect(sk.segments[0].type).toBe('ArcPathExpr');
  });

  it('parses sketch in pipeline with extrude', () => {
    const source = 'sketch [(0, 0), (10, 0), (5, 10), (0, 0)] | extrude 5';
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('Pipeline');
    const pl = stmt as Pipeline;
    expect(pl.source.type).toBe('SketchExpr');
    expect(pl.ops).toHaveLength(1);
    expect(pl.ops[0].type).toBe('Extrude');
  });

  it('parses sketch with at: named arg placement', () => {
    const stmt = parseFirst('sketch [(0, 0), (10, 0), (5, 10)] at:(5, 5)');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.namedArgs).toHaveLength(1);
    expect(sk.namedArgs[0].key).toBe('at');
    expect(sk.namedArgs[0].value.type).toBe('TupleLit');
  });
});

// ---------------------------------------------------------------------------
// Validator tests
// ---------------------------------------------------------------------------

describe('validator -- sketch', () => {
  it('accepts sketch | extrude pipeline', () => {
    const errors = getErrors('sketch [(0, 0), (10, 0), (5, 10), (0, 0)] | extrude 5');
    expect(errors).toHaveLength(0);
  });

  it('accepts sketch | revolve pipeline', () => {
    const errors = getErrors('sketch [(5, 0), arc (5, 0) (0, -5) (-5, 0), (0, 7), (5, 0)] | revolve Y');
    expect(errors).toHaveLength(0);
  });

  it('rejects sketch | fillet (3D fillet needs 3D context)', () => {
    // fillet is valid in 2D context too, so this should pass
    const errors = getErrors('sketch [(0, 0), (10, 0), (10, 10), (0, 0)] | fillet 1');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Evaluator tests (with mock OC)
// ---------------------------------------------------------------------------

describe('evaluator -- sketch', () => {
  it('evaluates simple triangle sketch', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(0, 0), (10, 0), (5, 10), (0, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    // Should create 3 line edges (last point == start, so no auto-close edge)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(3);

    // First line: (0,0,0) -> (10,0,0)
    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });

    // Second line: (10,0,0) -> (5,10,0)
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 5, y: 10, z: 0 });

    // Third line: (5,10,0) -> (0,0,0)
    expect(lineEdgeCalls[2].args[0]).toEqual({ x: 5, y: 10, z: 0 });
    expect(lineEdgeCalls[2].args[1]).toEqual({ x: 0, y: 0, z: 0 });

    // makeWire called once
    const wireCalls = oc._calls.filter((c: any) => c.method === 'makeWire');
    expect(wireCalls).toHaveLength(1);
  });

  it('evaluates sketch with auto-close', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // Triangle without explicit close (last point != start)
    const ast = parse('sketch [(0, 0), (10, 0), (5, 10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should create 3 line edges: 2 explicit + 1 auto-close
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(3);

    // Auto-close edge: (5,10,0) -> (0,0,0)
    expect(lineEdgeCalls[2].args[0]).toEqual({ x: 5, y: 10, z: 0 });
    expect(lineEdgeCalls[2].args[1]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('evaluates sketch with arc segment (3-arg: start through end)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(5, 0), arc (5, 0) (0, -5) (-5, 0), (0, 7), (5, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should have 1 arc edge and 2 line edges
    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    // Arc: start=(5,0,0), through=(0,-5,0), end=(-5,0,0)
    expect(arcCalls[0].args[0]).toEqual({ x: 5, y: 0, z: 0 });
    expect(arcCalls[0].args[1]).toEqual({ x: 0, y: -5, z: 0 });
    expect(arcCalls[0].args[2]).toEqual({ x: -5, y: 0, z: 0 });

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(2);
  });

  it('evaluates sketch with bezier segment', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(0, 0), bezier [(5, 10), (10, 10), (10, 0)], (0, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should have 1 bezier edge and 1 line edge
    const bezCalls = oc._calls.filter((c: any) => c.method === 'makeBezierEdge');
    expect(bezCalls).toHaveLength(1);
    // Bezier control points: current (0,0,0) + [(5,10,0), (10,10,0), (10,0,0)]
    const pts = bezCalls[0].args[0];
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(pts[1]).toEqual({ x: 5, y: 10, z: 0 });
    expect(pts[2]).toEqual({ x: 10, y: 10, z: 0 });
    expect(pts[3]).toEqual({ x: 10, y: 0, z: 0 });

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(1);
  });

  it('evaluates sketch with spline segment', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(0, 0), (10, 0), spline [(15, 5), (20, 0)]]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should have 1 line edge + 1 spline edge + 1 auto-close line edge
    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(2); // explicit line + auto-close

    const splCalls = oc._calls.filter((c: any) => c.method === 'interpolatePoints');
    expect(splCalls).toHaveLength(1);
    // Spline points: current (10,0,0) + [(15,5,0), (20,0,0)]
    const pts = splCalls[0].args[0];
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(pts[1]).toEqual({ x: 15, y: 5, z: 0 });
    expect(pts[2]).toEqual({ x: 20, y: 0, z: 0 });
  });

  it('throws EvalError for spline with no arguments', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // spline with empty list -> evaluates to empty array -> error
    const ast = parse('sketch [(0, 0), spline []]');
    expect(() => evaluator.evaluate(ast)).toThrow('spline in sketch requires a list of points');
  });

  it('throws EvalError for spline with non-array argument', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // spline with a scalar instead of a list
    const ast = parse('sketch [(0, 0), spline 42]');
    expect(() => evaluator.evaluate(ast)).toThrow('spline in sketch requires a list of points');
  });

  it('evaluates sketch with variables', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('$r = 5\nsketch [($r, 0), (0, $r), (-$r, 0), (0, -$r)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    // 3 explicit lines + 1 auto-close
    expect(lineCalls).toHaveLength(4);
    expect(lineCalls[0].args[0]).toEqual({ x: 5, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 0, y: 5, z: 0 });
  });

  it('sketch | extrude pipeline works', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(0, 0), (10, 0), (5, 10), (0, 0)] | extrude 5');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should have extrude call
    const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
    expect(extrudeCalls).toHaveLength(1);
  });

  it('skips a zero-length segment instead of asking the kernel for one', () => {
    // A parametric sketch lands two consecutive points on the same spot for
    // some parameter values (ex2/22_phone_stand at lip_d == t). OCCT cannot
    // build a zero-length edge; Python skips it under GEOMETRY_TOLERANCE and
    // so must we. Five points, one duplicated -> four line edges, not five.
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(0, 0), (10, 0), (10, 5), (10, 5), (0, 5)] | extrude 2');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const lines = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lines).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Workplane-aware sketch tests
// ---------------------------------------------------------------------------

describe('evaluator -- sketch with workplane', () => {
  it('workplane XZ | sketch maps tuple (x, y) to world (x, 0, y)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | sketch [(-10, 0), (0, 0), (10, 20), (-10, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    // XZ plane: xDir=(1,0,0), yDir=(0,0,1)
    // (-10, 0) -> world (-10, 0, 0)
    // (0, 0)   -> world (0, 0, 0)
    // (10, 20) -> world (10, 0, 20)
    // (-10, 0) -> world (-10, 0, 0) (close)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(3);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: -10, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 10, y: 0, z: 20 });
    expect(lineEdgeCalls[2].args[0]).toEqual({ x: 10, y: 0, z: 20 });
    expect(lineEdgeCalls[2].args[1]).toEqual({ x: -10, y: 0, z: 0 });
  });

  it('workplane YZ | sketch maps tuple (x, y) to world (0, x, y)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane YZ | sketch [(0, 0), (10, 0), (10, 20), (0, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // YZ plane: xDir=(0,1,0), yDir=(0,0,1)
    // (0, 0)   -> world (0, 0, 0)
    // (10, 0)  -> world (0, 10, 0)
    // (10, 20) -> world (0, 10, 20)
    // (0, 0)   -> world (0, 0, 0) (close)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(3);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 0, y: 10, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 0, y: 10, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 0, y: 10, z: 20 });
    expect(lineEdgeCalls[2].args[0]).toEqual({ x: 0, y: 10, z: 20 });
    expect(lineEdgeCalls[2].args[1]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('workplane XY | sketch maps tuple (x, y) to world (x, y, 0) -- same as source form', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XY | sketch [(0, 0), (10, 0), (5, 10), (0, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // XY plane: xDir=(1,0,0), yDir=(0,1,0)
    // Same as default -- (x, y) -> world (x, y, 0)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(3);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 5, y: 10, z: 0 });
    expect(lineEdgeCalls[2].args[0]).toEqual({ x: 5, y: 10, z: 0 });
    expect(lineEdgeCalls[2].args[1]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('source form sketch [...] defaults to XY (regression)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // Source form without workplane should behave exactly as before
    const ast = parse('sketch [(0, 0), (10, 0), (5, 10), (0, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(3);

    // (0,0) -> (0,0,0), (10,0) -> (10,0,0), (5,10) -> (5,10,0)
    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 5, y: 10, z: 0 });
    expect(lineEdgeCalls[2].args[0]).toEqual({ x: 5, y: 10, z: 0 });
    expect(lineEdgeCalls[2].args[1]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('workplane XZ | sketch [...] | extrude 5 produces shape', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | sketch [(-10, 0), (0, 0), (10, 20), (-10, 0)] | extrude 5');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should have extrude call
    const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
    expect(extrudeCalls).toHaveLength(1);

    // Extrude direction should be along the plane normal (Y axis for XZ)
    // XZ plane normal = (0, 1, 0), so extrude(shape, 0, 5, 0)
    expect(extrudeCalls[0].args[1]).toBe(0);  // dx
    expect(extrudeCalls[0].args[2]).toBe(5);  // dy
    expect(extrudeCalls[0].args[3]).toBe(0);  // dz

    // Verify the sketch vertices are in XZ plane (Y=0)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    for (const call of lineEdgeCalls) {
      expect(call.args[0].y).toBe(0);
      expect(call.args[1].y).toBe(0);
    }
  });
});
