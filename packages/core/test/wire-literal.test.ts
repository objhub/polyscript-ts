/**
 * Tests for wire [...] literal (open multi-segment wire).
 *
 * wire [...] is the open counterpart of sketch [...]:
 * - No auto-close (wire stays open)
 * - Supports: tuple (line), line, arc (3-point/center/radius), bezier, spline segments
 * - Primary use: sweep path (spine)
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import type { Expression, Pipeline, WireLiteralExpr, Implicit2DPrimitive } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';

/** Parse and return the first statement. */
function parseFirst(source: string): Expression {
  const program = parse(source);
  expect(program.statements.length).toBeGreaterThan(0);
  return program.statements[0] as Expression;
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

describe('parser -- path literal', () => {
  it('parses path with line segments (tuples)', () => {
    const stmt = parseFirst('wire [(0, 0), (10, 0), (10, 10)]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.start).toBeDefined();
    expect(p.start!.type).toBe('TupleLit');
    expect(p.segments).toHaveLength(2);
    // All segments are tuples (line endpoints)
    for (const seg of p.segments) {
      expect(seg.type).toBe('TupleLit');
    }
  });

  it('parses path with arc segment', () => {
    const stmt = parseFirst('wire [(0, 0), (10, 0), arc (10, 0) (10, 5) (15, 5)]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.start).toBeDefined();
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0].type).toBe('TupleLit');       // (10, 0) line
    expect(p.segments[1].type).toBe('ArcPathExpr');     // arc segment
  });

  it('parses path with arc radius: segment', () => {
    const stmt = parseFirst('wire [(0, 0), (10, 0), arc (10, 0) (15, 5) radius:5]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.segments).toHaveLength(2);
    expect(p.segments[1].type).toBe('CenterArcPathExpr');
    if (p.segments[1].type === 'CenterArcPathExpr') {
      expect(p.segments[1].args).toHaveLength(2);  // start, end
      expect(p.segments[1].namedArgs).toHaveLength(1);
      expect(p.segments[1].namedArgs[0].key).toBe('radius');
    }
  });

  it('parses path with arc center: segment', () => {
    const stmt = parseFirst('wire [(0, 0), (10, 0), arc (10, 0) (15, 5) center:(12.5, 2.5)]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.segments[1].type).toBe('CenterArcPathExpr');
    if (p.segments[1].type === 'CenterArcPathExpr') {
      expect(p.segments[1].args).toHaveLength(2);  // start, end
      expect(p.segments[1].namedArgs).toHaveLength(1);
      expect(p.segments[1].namedArgs[0].key).toBe('center');
    }
  });

  it('parses path with bezier segment', () => {
    const stmt = parseFirst('wire [(0, 0), bezier [(5, 10), (10, 10), (10, 0)]]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].type).toBe('BezierPathExpr');
  });

  it('parses path with spline segment', () => {
    const stmt = parseFirst('wire [(0, 0), spline [(5, 10), (10, 10), (10, 0)]]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].type).toBe('SplinePathExpr');
  });

  it('parses path with explicit line segment', () => {
    const stmt = parseFirst('wire [line (0, 0) (10, 5)]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    // No start (first element is a keyword-segment)
    expect(p.start).toBeUndefined();
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].type).toBe('LinePathExpr');
    if (p.segments[0].type === 'LinePathExpr') {
      expect(p.segments[0].args).toHaveLength(2);
    }
  });

  it('parses multi-line path', () => {
    const source = `wire [
  (0, 0),
  (10, 0),
  arc (10, 0) (15, 5) radius:5,
  (15, 20)
]`;
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.start).toBeDefined();
    expect(p.segments).toHaveLength(3);
    expect(p.segments[0].type).toBe('TupleLit');
    expect(p.segments[1].type).toBe('CenterArcPathExpr');
    expect(p.segments[2].type).toBe('TupleLit');
  });

  it('parses path with 3D coordinates', () => {
    const stmt = parseFirst('wire [(0, 0, 0), (10, 0, 5), (20, 10, 10)]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.start).toBeDefined();
    expect(p.segments).toHaveLength(2);
  });

  it('parses path in pipeline with sweep', () => {
    const source = 'circle 5 | sweep (wire [(0, 0), (10, 0), (10, 10)])';
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('Pipeline');
    const pl = stmt as Pipeline;
    expect(pl.source.type).toBe('CircleExpr');
    expect(pl.ops).toHaveLength(1);
    expect(pl.ops[0].type).toBe('Sweep');
  });

  it('parses path assigned to variable', () => {
    const program = parse('$p = wire [(0, 0), (10, 0)]');
    expect(program.statements).toHaveLength(1);
    const stmt = program.statements[0];
    expect(stmt.type).toBe('Assignment');
    if (stmt.type === 'Assignment') {
      expect(stmt.value.type).toBe('WireLiteralExpr');
    }
  });

  it('parses path starting with arc (no bare start point)', () => {
    const stmt = parseFirst('wire [arc (0, 0) (5, 5) (10, 0)]');
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.start).toBeUndefined();
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].type).toBe('ArcPathExpr');
  });

  it('parses mixed segment types', () => {
    const source = `wire [
  (0, 0),
  (10, 0),
  arc (10, 0) (12, 3) (15, 5),
  arc (15, 5) (20, 10) radius:5,
  (25, 10)
]`;
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('WireLiteralExpr');
    const p = stmt as WireLiteralExpr;
    expect(p.segments).toHaveLength(4);
    expect(p.segments[0].type).toBe('TupleLit');
    expect(p.segments[1].type).toBe('ArcPathExpr');
    expect(p.segments[2].type).toBe('CenterArcPathExpr');
    expect(p.segments[3].type).toBe('TupleLit');
  });
});

// ---------------------------------------------------------------------------
// Evaluator tests (with mock OC)
// ---------------------------------------------------------------------------

describe('evaluator -- path literal', () => {
  it('evaluates path with tuple line segments', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [(0, 0), (10, 0), (10, 10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    // Should create 2 line edges (start -> (10,0), (10,0) -> (10,10))
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(2);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 10, y: 10, z: 0 });

    // makeWire called once
    const wireCalls = oc._calls.filter((c: any) => c.method === 'makeWire');
    expect(wireCalls).toHaveLength(1);
  });

  it('does NOT auto-close (unlike sketch)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // path: open wire, no closing edge
    const ast = parse('wire [(0, 0), (10, 0), (10, 10)]');
    evaluator.evaluate(ast);

    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    // Only 2 edges, NOT 3 (no auto-close back to start)
    expect(lineEdgeCalls).toHaveLength(2);

    // Compare: sketch creates 3 edges (2 + auto-close)
    const oc2 = createMockOC();
    const evaluator2 = new Evaluator({ oc: oc2 });
    const ast2 = parse('sketch [(0, 0), (10, 0), (10, 10)]');
    evaluator2.evaluate(ast2);

    const sketchLineEdgeCalls = oc2._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(sketchLineEdgeCalls).toHaveLength(3); // 2 + auto-close
  });

  it('evaluates path with arc segment', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [(0, 0), (10, 0), arc (10, 0) (12, 3) (15, 5)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // 1 line edge + 1 arc edge
    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(1);
    expect(lineCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    expect(arcCalls[0].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(arcCalls[0].args[1]).toEqual({ x: 12, y: 3, z: 0 });
    expect(arcCalls[0].args[2]).toEqual({ x: 15, y: 5, z: 0 });
  });

  it('evaluates path with explicit line segment', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [line (0, 0) (10, 5)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(1);
    expect(lineCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 10, y: 5, z: 0 });
  });

  it('evaluates path with 3D coordinates', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [(0, 0, 0), (10, 0, 5), (20, 10, 10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(2);
    expect(lineCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 5 });
    expect(lineCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 5 });
    expect(lineCalls[1].args[1]).toEqual({ x: 20, y: 10, z: 10 });
  });

  it('evaluates path with bezier segment', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [(0, 0), bezier [(5, 10), (10, 10), (10, 0)]]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const bezCalls = oc._calls.filter((c: any) => c.method === 'makeBezierEdge');
    expect(bezCalls).toHaveLength(1);
    // Start point (0,0,0) prepended to bezier control points
    const pts = bezCalls[0].args[0];
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(pts[3]).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('evaluates path with spline segment', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [(0, 0), spline [(5, 10), (10, 10), (10, 0)]]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const splCalls = oc._calls.filter((c: any) => c.method === 'interpolatePoints');
    expect(splCalls).toHaveLength(1);
    // Start point (0,0,0) prepended to spline points
    const pts = splCalls[0].args[0];
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('sweep with path argument works', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('circle 5 | sweep (wire [(0, 0), (10, 0), (10, 10)])');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // Should have pipe (sweep) call
    const pipeCalls = oc._calls.filter((c: any) => c.method === 'pipe');
    expect(pipeCalls).toHaveLength(1);
  });

  it('auto-connects with implicit line when segment start does not match (path)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // arc start (5,0) does not match previous endpoint (10,0)
    // Should insert implicit line from (10,0) to (5,0), then arc
    const ast = parse('wire [(0, 0), (10, 0), arc (5, 0) (7, 3) (10, 5)]');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');

    // 1 normal line (0,0)->(10,0), 1 implicit line (10,0)->(5,0), 1 arc
    expect(lineCalls).toHaveLength(2);
    expect(arcCalls).toHaveLength(1);

    // First line: (0,0) -> (10,0)
    expect(lineCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
    // Second line: implicit (10,0) -> (5,0)
    expect(lineCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineCalls[1].args[1]).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('evaluates path with variables', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('$d = 10\nwire [(0, 0), ($d, 0), ($d, $d)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(2);
    expect(lineCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineCalls[1].args[1]).toEqual({ x: 10, y: 10, z: 0 });
  });

  it('evaluates path starting with arc (no bare start)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [arc (0, 0) (5, 5) (10, 0)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    expect(arcCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ---------------------------------------------------------------------------
// Pipe-form path tests (workplane | wire [...])
// ---------------------------------------------------------------------------

describe('parser -- path as pipe op', () => {
  it('parses workplane XZ | wire [...] as Implicit2DPrimitive(WireLiteralExpr)', () => {
    const stmt = parseFirst('workplane XZ | wire [(0,0),(10,0),(5,10)]');
    expect(stmt.type).toBe('Pipeline');
    const pl = stmt as Pipeline;
    expect(pl.source.type).toBe('Workplane');
    expect(pl.ops).toHaveLength(1);
    expect(pl.ops[0].type).toBe('Implicit2DPrimitive');
    const implicit = pl.ops[0] as Implicit2DPrimitive;
    expect(implicit.primitive.type).toBe('WireLiteralExpr');
    const path = implicit.primitive as WireLiteralExpr;
    expect(path.start).toBeDefined();
    expect(path.segments).toHaveLength(2);
  });

  it('parses workplane YZ | wire [...] with arc segments', () => {
    const stmt = parseFirst('workplane YZ | wire [(0,0), (10,0), arc (10,0) (12,3) (15,5)]');
    expect(stmt.type).toBe('Pipeline');
    const pl = stmt as Pipeline;
    expect(pl.ops).toHaveLength(1);
    expect(pl.ops[0].type).toBe('Implicit2DPrimitive');
    const implicit = pl.ops[0] as Implicit2DPrimitive;
    expect(implicit.primitive.type).toBe('WireLiteralExpr');
    const path = implicit.primitive as WireLiteralExpr;
    expect(path.segments).toHaveLength(2);
    expect(path.segments[1].type).toBe('ArcPathExpr');
  });
});

describe('evaluator -- path as pipe op', () => {
  it('workplane XZ | wire [...] produces WpState with wires', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | wire [(0,0),(10,0),(10,10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    // Should create 2 line edges
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(2);
  });

  it('workplane XZ | wire [...] preserves XZ plane in state', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | wire [(0,0),(10,0),(10,10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    // Plane should still be XZ (normal = Y-axis)
    expect(wp.plane.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('workplane YZ | wire [...] preserves YZ plane in state', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane YZ | wire [(0,0),(10,0),(10,10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    // Plane should still be YZ (normal = X-axis)
    expect(wp.plane.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('source-form wire [...] still works on XY plane (regression)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('wire [(0,0),(10,0),(10,10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);
    // Default XY plane
    expect(wp.plane.normal).toEqual({ x: 0, y: 0, z: 1 });

    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(2);
    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('workplane XZ | path maps tuple (x, y) to world (x, 0, y)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | wire [(-10, 0), (0, 0), (10, 20)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    // XZ plane: xDir=(1,0,0), yDir=(0,0,1)
    // (-10, 0) -> world (-10, 0, 0)
    // (0, 0)   -> world (0, 0, 0)
    // (10, 20) -> world (10, 0, 20)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(2);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: -10, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 10, y: 0, z: 20 });
  });

  it('workplane YZ | path maps tuple (x, y) to world (0, x, y)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane YZ | wire [(0, 0), (10, 0), (10, 20)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // YZ plane: xDir=(0,1,0), yDir=(0,0,1)
    // (0, 0)   -> world (0, 0, 0)
    // (10, 0)  -> world (0, 10, 0)
    // (10, 20) -> world (0, 10, 20)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(2);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 0, y: 10, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 0, y: 10, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 0, y: 10, z: 20 });
  });

  it('workplane XY | path maps tuple (x, y) to world (x, y, 0) — same as source form', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XY | wire [(0, 0), (10, 0), (10, 10)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // XY plane: xDir=(1,0,0), yDir=(0,1,0)
    // Same as default — (x, y) -> world (x, y, 0)
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(2);

    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineEdgeCalls[1].args[1]).toEqual({ x: 10, y: 10, z: 0 });
  });

  it('workplane XZ | path with explicit line segment maps correctly', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | wire [line (0, 0) (10, 20)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(1);
    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 20 });
  });

  it('workplane XZ | path with 3D tuple passes through as world coordinates', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('workplane XZ | wire [(0, 0, 0), (10, 5, 20)]');
    const result = evaluator.evaluate(ast);

    expect(isWpState(result)).toBe(true);

    // 3-element tuples are world coordinates, not mapped through the plane
    const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineEdgeCalls).toHaveLength(1);
    expect(lineEdgeCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lineEdgeCalls[0].args[1]).toEqual({ x: 10, y: 5, z: 20 });
  });
});
