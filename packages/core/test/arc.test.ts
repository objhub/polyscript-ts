/**
 * Tests for arc keyword (unified: 3-point arc, center arc, radius arc).
 *
 * Covers parser, evaluator, and error handling for:
 * - arc start through end                 -- 3-point arc (ArcPathExpr)
 * - arc start end center:(cx,cy)          -- center-specified arc (CenterArcPathExpr)
 * - arc start end radius:radius            -- radius-specified arc (CenterArcPathExpr)
 *
 * Also tests:
 * - Path primitive forms (standalone, outside sketch)
 * - Sketch auto-line connection (when segment start doesn't match previous endpoint)
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import type { Expression, Pipeline, SketchExpr, CenterArcPathExpr, ArcPathExpr } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';
import { Evaluator } from '../src/evaluator.js';
import { computeArcAngles, computeCenterFromRadius } from '../src/ocp-kernel.js';

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
    makeCircleArc(center: any, normal: any, radius: number, startAngle: number, endAngle: number) {
      calls.push({ method: 'makeCircleArc', args: [center, normal, radius, startAngle, endAngle] });
      return nextHandle();
    },
    makeTangentArc(start: any, tangent: any, end: any) {
      calls.push({ method: 'makeTangentArc', args: [start, tangent, end] });
      return nextHandle();
    },
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
// Parser tests -- arc center/radius variants (formerly carc)
// ---------------------------------------------------------------------------

describe('parser -- arc center/radius variants', () => {
  it('parses arc with center: in sketch (2 args + center: named arg)', () => {
    const stmt = parseFirst('sketch [(10, 0), arc (10, 0) (0, 10) center:(0, 0), (0, 0), (10, 0)]');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(3);
    expect(sk.segments[0].type).toBe('CenterArcPathExpr');
    const carc = sk.segments[0] as CenterArcPathExpr;
    expect(carc.args).toHaveLength(2); // start, end
    expect(carc.namedArgs).toHaveLength(1);
    expect(carc.namedArgs[0].key).toBe('center');
  });

  it('parses arc with radius: named arg in sketch (2 args + radius:)', () => {
    const stmt = parseFirst('sketch [(10, 0), arc (10, 0) (0, 10) radius:10, (0, 0), (10, 0)]');
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.segments[0].type).toBe('CenterArcPathExpr');
    const carc = sk.segments[0] as CenterArcPathExpr;
    expect(carc.args).toHaveLength(2); // start, end
    expect(carc.namedArgs).toHaveLength(1);
    expect(carc.namedArgs[0].key).toBe('radius');
  });

  it('parses arc with center: as standalone path primitive', () => {
    const stmt = parseFirst('arc (0, 0) (0, 10) center:(0, 5)');
    expect(stmt.type).toBe('CenterArcPathExpr');
    const carc = stmt as CenterArcPathExpr;
    expect(carc.args).toHaveLength(2);
    expect(carc.namedArgs).toHaveLength(1);
    expect(carc.namedArgs[0].key).toBe('center');
  });

  it('parses arc with radius: as standalone path primitive', () => {
    const stmt = parseFirst('arc (0, 0) (0, 10) radius:10');
    expect(stmt.type).toBe('CenterArcPathExpr');
    const carc = stmt as CenterArcPathExpr;
    expect(carc.args).toHaveLength(2);
    expect(carc.namedArgs).toHaveLength(1);
    expect(carc.namedArgs[0].key).toBe('radius');
  });

  it('parses arc with variable in sketch', () => {
    const source = `$r = 10
sketch [
  ($r, 0),
  arc ($r, 0) (0, $r) radius:$r,
  (0, 0),
  ($r, 0)
]`;
    const program = parse(source);
    expect(program.statements).toHaveLength(2);
    const sk = program.statements[1] as SketchExpr;
    expect(sk.type).toBe('SketchExpr');
    expect(sk.segments[0].type).toBe('CenterArcPathExpr');
  });

  it('parses multi-line sketch with arc center:', () => {
    const source = `sketch [
  (10, 0),
  arc (10, 0) (0, 10) center:(0, 0),
  (0, 0),
  (10, 0)
]`;
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('SketchExpr');
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(3);
    expect(sk.segments[0].type).toBe('CenterArcPathExpr');
  });
});

describe('parser -- arc (3-point syntax)', () => {
  it('parses arc with 3 args in sketch', () => {
    const source = `sketch [
  (5, 0),
  arc (5, 0) (0, -5) (-5, 0),
  (0, 7),
  (5, 0)
]`;
    const stmt = parseFirst(source);
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(3);
    expect(sk.segments[0].type).toBe('ArcPathExpr');
    const arc = sk.segments[0] as ArcPathExpr;
    expect(arc.args).toHaveLength(3); // start, through, end
  });

  it('parses arc as standalone path primitive (3 args)', () => {
    const stmt = parseFirst('arc (0, 0, 0) (10, 0, 40) (20, 0, 50)');
    expect(stmt.type).toBe('ArcPathExpr');
    const arc = stmt as ArcPathExpr;
    expect(arc.args).toHaveLength(3);
  });
});

describe('parser -- arc mixed with existing segments', () => {
  it('parses sketch with 3-point arc and center arc segments', () => {
    const source = `sketch [
  (5, 0),
  arc (5, 0) (0, -5) (-5, 0),
  arc (-5, 0) (-5, 5) radius:5,
  (5, 0)
]`;
    const stmt = parseFirst(source);
    const sk = stmt as SketchExpr;
    expect(sk.segments).toHaveLength(3);
    expect(sk.segments[0].type).toBe('ArcPathExpr');
    expect(sk.segments[1].type).toBe('CenterArcPathExpr');
    expect(sk.segments[2].type).toBe('TupleLit');
  });

  it('parses sketch | extrude pipeline with arc center:', () => {
    const source = 'sketch [(10, 0), arc (10, 0) (0, 10) center:(0, 0), (0, 0), (10, 0)] | extrude 5';
    const stmt = parseFirst(source);
    expect(stmt.type).toBe('Pipeline');
    const pl = stmt as Pipeline;
    expect(pl.source.type).toBe('SketchExpr');
    expect(pl.ops).toHaveLength(1);
    expect(pl.ops[0].type).toBe('Extrude');
  });
});

// ---------------------------------------------------------------------------
// Math utility tests
// ---------------------------------------------------------------------------

describe('computeArcAngles', () => {
  it('computes 90-degree arc (quarter circle)', () => {
    const center = { x: 0, y: 0, z: 0 };
    const start = { x: 10, y: 0, z: 0 };
    const end = { x: 0, y: 10, z: 0 };
    const normal = { x: 0, y: 0, z: 1 };
    const { startAngle, endAngle } = computeArcAngles(center, start, end, normal);
    expect(startAngle).toBe(0);
    expect(endAngle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('computes 90-degree arc (CW direction)', () => {
    const center = { x: 0, y: 0, z: 0 };
    const start = { x: 10, y: 0, z: 0 };
    const end = { x: 0, y: -10, z: 0 };
    const normal = { x: 0, y: 0, z: 1 };
    const { startAngle, endAngle } = computeArcAngles(center, start, end, normal);
    expect(startAngle).toBe(0);
    // Minor arc: should be -pi/2 (CW, the short way)
    expect(endAngle).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('computes 180-degree arc (semicircle, defaults to CCW)', () => {
    const center = { x: 0, y: 0, z: 0 };
    const start = { x: 10, y: 0, z: 0 };
    const end = { x: -10, y: 0, z: 0 };
    const normal = { x: 0, y: 0, z: 1 };
    const { startAngle, endAngle } = computeArcAngles(center, start, end, normal);
    expect(startAngle).toBe(0);
    expect(endAngle).toBeCloseTo(Math.PI, 10);
  });
});

describe('computeCenterFromRadius', () => {
  it('computes center for quarter circle', () => {
    const start = { x: 10, y: 0, z: 0 };
    const end = { x: 0, y: 10, z: 0 };
    const normal = { x: 0, y: 0, z: 1 };
    const center = computeCenterFromRadius(start, end, 10, normal);
    // Center should be at (0, 0, 0) for a 90-degree arc of radius 10
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
  });

  it('throws when |SE| > 2*r', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 20, y: 0, z: 0 };
    const normal = { x: 0, y: 0, z: 1 };
    expect(() => computeCenterFromRadius(start, end, 5, normal)).toThrow('|SE|');
  });

  it('computes center for semicircle (r = d/2)', () => {
    const start = { x: -5, y: 0, z: 0 };
    const end = { x: 5, y: 0, z: 0 };
    const normal = { x: 0, y: 0, z: 1 };
    const center = computeCenterFromRadius(start, end, 5, normal);
    // For semicircle, center is the midpoint
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// Evaluator tests -- arc center/radius in sketch
// ---------------------------------------------------------------------------

describe('evaluator -- arc center/radius in sketch', () => {
  it('evaluates arc with center: named arg', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse(`sketch [
  (10, 0),
  arc (10, 0) (0, 10) center:(0, 0),
  (0, 0),
  (10, 0)
]`);
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    // center arc is built as a 3-point arc (makeArcEdge) via computed midpoint.
    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    // start = (10,0,0), end = (0,10,0), center = (0,0,0) => minor-arc midpoint at (10/sqrt(2), 10/sqrt(2), 0)
    expect(arcCalls[0].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(arcCalls[0].args[2]).toEqual({ x: 0, y: 10, z: 0 });
    const mid = arcCalls[0].args[1];
    expect(mid.x).toBeCloseTo(10 / Math.SQRT2, 5);
    expect(mid.y).toBeCloseTo(10 / Math.SQRT2, 5);
    expect(mid.z).toBeCloseTo(0, 5);

    // Should have 2 line edges: (0,10,0)->(0,0,0) and (0,0,0)->(10,0,0)
    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(2);
  });

  it('evaluates arc with radius: named arg', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse(`sketch [
  (10, 0),
  arc (10, 0) (0, 10) radius:10,
  (0, 0),
  (10, 0)
]`);
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    // Same geometry as center form: midpoint on the minor arc at radius 10 from origin.
    const mid = arcCalls[0].args[1];
    const r = Math.sqrt(mid.x * mid.x + mid.y * mid.y);
    expect(r).toBeCloseTo(10, 5);
  });

  it('evaluates arc with variable radius', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse(`$r = 10
sketch [
  ($r, 0),
  arc ($r, 0) (0, $r) radius:$r,
  (0, 0),
  ($r, 0)
]`);
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    const mid = arcCalls[0].args[1];
    expect(Math.sqrt(mid.x * mid.x + mid.y * mid.y)).toBeCloseTo(10, 5);
  });

  it('throws when arc center: has mismatched center distances', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // Center (5, 0) is 5 from start (10, 0) but ~5.59 from end (0, 3)
    // 5% tolerance: |5 - 5.59| / 5 = 0.118 > 0.05
    const ast = parse('sketch [(10, 0), arc (10, 0) (0, 3) center:(5, 0), (0, 0)]');
    expect(() => evaluator.evaluate(ast)).toThrow('differs from center-to-end distance');
  });

  it('evaluates rounded rectangle with arc radius:', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse(`$w = 20
$h = 10
$cr = 2
sketch [
  ($w/2 - $cr, -$h/2),
  arc ($w/2 - $cr, -$h/2) ($w/2, -$h/2 + $cr) radius:$cr,
  ($w/2, $h/2 - $cr),
  arc ($w/2, $h/2 - $cr) ($w/2 - $cr, $h/2) radius:$cr,
  (-$w/2 + $cr, $h/2),
  arc (-$w/2 + $cr, $h/2) (-$w/2, $h/2 - $cr) radius:$cr,
  (-$w/2, -$h/2 + $cr),
  arc (-$w/2, -$h/2 + $cr) (-$w/2 + $cr, -$h/2) radius:$cr
]`);
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    // Should have 4 makeArcEdge calls (one per corner)
    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(4);

    // Should have 4 line edges (one per straight side)
    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(4);
  });
});

describe('evaluator -- arc in sketch (3-point syntax)', () => {
  it('evaluates arc with explicit start', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sketch [(5, 0), arc (5, 0) (0, -5) (-5, 0), (0, 7), (5, 0)]');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    // Arc: start=(5,0,0), through=(0,-5,0), end=(-5,0,0)
    expect(arcCalls[0].args[0]).toEqual({ x: 5, y: 0, z: 0 });
    expect(arcCalls[0].args[1]).toEqual({ x: 0, y: -5, z: 0 });
    expect(arcCalls[0].args[2]).toEqual({ x: -5, y: 0, z: 0 });

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    expect(lineCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Auto-line connection tests (replaces start-point mismatch error tests)
// ---------------------------------------------------------------------------

describe('evaluator -- auto-line connection in sketch', () => {
  it('inserts implicit line when arc start does not match previous segment endpoint', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // Start of sketch: (5, 0). Arc start: (10, 0) -- mismatch!
    // Should insert implicit line from (5,0) to (10,0), then arc
    const ast = parse('sketch [(5, 0), arc (10, 0) (5, -5) (0, 0), (0, 0)]');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);

    // First call should be the implicit line (5,0) -> (10,0)
    expect(lineCalls[0].args[0]).toEqual({ x: 5, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('inserts implicit line when arc center: start does not match', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // Start of sketch: (10, 0). arc start: (5, 0) -- mismatch!
    // center (0, 0) is equidistant from (5, 0) and (0, 5): both dist = 5
    const ast = parse('sketch [(10, 0), arc (5, 0) (0, 5) center:(0, 0), (0, 0)]');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const lineCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    // Should have implicit line (10,0) -> (5,0) plus others
    expect(lineCalls[0].args[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(lineCalls[0].args[1]).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('accepts arc start that matches previous endpoint within tolerance', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // Start matches exactly
    const ast = parse('sketch [(5, 0), arc (5, 0) (0, -5) (-5, 0), (-5, 0)]');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    // No implicit line should be inserted for the arc (only the auto-close line)
    const allCalls = oc._calls.map((c: any) => c.method);
    // The first edge call should be the arc, not a line (no implicit line before arc)
    const firstEdgeIdx = allCalls.findIndex((m: string) => m === 'makeLineEdge' || m === 'makeArcEdge');
    expect(allCalls[firstEdgeIdx]).toBe('makeArcEdge');
  });
});

describe('evaluator -- arc center/radius as standalone path primitives', () => {
  it('arc with center: as standalone path', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    // start (0,0,0), center at (5,0,0), end at (10,0,0)
    const ast = parse('arc (0, 0) (10, 0) center:(5, 0)');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    expect(arcCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(arcCalls[0].args[2]).toEqual({ x: 10, y: 0, z: 0 });
    // Semicircle: midpoint on the minor arc at radius 5 from center (5,0,0)
    const mid = arcCalls[0].args[1];
    const dx = mid.x - 5, dy = mid.y, dz = mid.z;
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(5, 5);
  });

  it('arc with radius: as standalone path', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('arc (0, 0) (10, 0) radius:10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires).toHaveLength(1);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
  });

  it('arc as standalone path (3 tuple args, 3-point form)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('arc (0, 0, 0) (10, 0, 40) (20, 0, 50)');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);

    const arcCalls = oc._calls.filter((c: any) => c.method === 'makeArcEdge');
    expect(arcCalls).toHaveLength(1);
    expect(arcCalls[0].args[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(arcCalls[0].args[1]).toEqual({ x: 10, y: 0, z: 40 });
    expect(arcCalls[0].args[2]).toEqual({ x: 20, y: 0, z: 50 });
  });

  it('arc with only 2 args and no named arg throws parse error', () => {
    // 2 positional args with no center: or radius: is invalid
    expect(() => parse('arc (10, 0, 40) (20, 0, 50)')).toThrow('Invalid arc arguments');
  });
});
