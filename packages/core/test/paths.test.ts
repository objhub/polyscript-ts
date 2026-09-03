/**
 * Tests for path primitives: line, arc, bezier, helix, spline.
 * Covers parser, evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { evaluateExpressions, Evaluator, type Value } from '../src/evaluator.js';
import type { Statement } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';

function parseFirst(source: string): Statement {
  const program = parse(source);
  expect(program.statements.length).toBeGreaterThan(0);
  return program.statements[0];
}

function evalExpr(source: string): Value {
  const ast = parse(source);
  return evaluateExpressions(ast);
}

function isWpState(v: any): v is WpState {
  return v !== null && typeof v === 'object' && 'oc' in v && 'plane' in v;
}

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
// Parser
// ---------------------------------------------------------------------------

describe('path primitives', () => {
  describe('parser', () => {
    it('parses helix with named args', () => {
      const stmt = parseFirst('helix pitch:5 height:30 radius:10');
      expect(stmt.type).toBe('HelixPathExpr');
      if (stmt.type === 'HelixPathExpr') {
        expect(stmt.namedArgs).toHaveLength(3);
        expect(stmt.namedArgs[0].key).toBe('pitch');
      }
    });

    it('parses helix with positional args', () => {
      const stmt = parseFirst('helix 5 30 10');
      expect(stmt.type).toBe('HelixPathExpr');
      if (stmt.type === 'HelixPathExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.namedArgs).toHaveLength(0);
      }
    });

    it('parses spline with list arg', () => {
      const stmt = parseFirst('spline [(0, 0), (5, 10), (10, 0)]');
      expect(stmt.type).toBe('SplinePathExpr');
    });
  });

  // ---------------------------------------------------------------------------
  // Evaluator
  // ---------------------------------------------------------------------------

  describe('evaluator', () => {
    // line
    it('line with tuple args creates wire via OC', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('line (0, 0, 0) (10, 0, 30)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.wires).toHaveLength(1);

      const lineCall = oc._calls.find((c: any) => c.method === 'makeLineEdge');
      expect(lineCall).toBeDefined();
      expect(lineCall!.args[0]).toEqual({ x: 0, y: 0, z: 0 });
      expect(lineCall!.args[1]).toEqual({ x: 10, y: 0, z: 30 });
    });

    it('line with 2D tuple args uses z=0', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('line (0, 0) (10, 20)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const lineCall = oc._calls.find((c: any) => c.method === 'makeLineEdge');
      expect(lineCall).toBeDefined();
      expect(lineCall!.args[0]).toEqual({ x: 0, y: 0, z: 0 });
      expect(lineCall!.args[1]).toEqual({ x: 10, y: 20, z: 0 });
    });

    it('line with scalar args throws (not tuples)', () => {
      expect(() => evalExpr('line 10 20')).toThrow('Expected (x,y) or (x,y,z) tuple');
    });

    // arc (3-arg: start through end)
    it('arc with 3 tuple args creates wire via OC', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('arc (0, 0, 0) (10, 0, 40) (20, 0, 50)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.wires).toHaveLength(1);

      const arcCall = oc._calls.find((c: any) => c.method === 'makeArcEdge');
      expect(arcCall).toBeDefined();
      expect(arcCall!.args[0]).toEqual({ x: 0, y: 0, z: 0 });
      expect(arcCall!.args[1]).toEqual({ x: 10, y: 0, z: 40 });
      expect(arcCall!.args[2]).toEqual({ x: 20, y: 0, z: 50 });
    });

    it('arc with only 2 tuple args throws (parse error)', () => {
      // 2 positional args with no center: or radius: is now a parse error
      expect(() => parse('arc (10, 0, 40) (20, 0, 50)')).toThrow('Invalid arc arguments');
    });

    it('arc with scalar args throws', () => {
      expect(() => evalExpr('arc 10 20 30')).toThrow('Expected (x,y) or (x,y,z) tuple');
    });

    // bezier
    it('bezier with list of tuples creates wire via OC', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('bezier [(0,0,0), (5,10,0), (10,0,0)]');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.wires).toHaveLength(1);

      const bezierCall = oc._calls.find((c: any) => c.method === 'makeBezierEdge');
      expect(bezierCall).toBeDefined();
      expect(bezierCall!.args[0]).toEqual([
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 10, z: 0 },
        { x: 10, y: 0, z: 0 },
      ]);
    });

    it('bezier with scalar args throws', () => {
      expect(() => evalExpr('bezier 10 20')).toThrow('bezier requires a list of control points');
    });

    // spline
    it('spline requires a list of points', () => {
      expect(() => evalExpr('spline 10 20')).toThrow('spline requires a list of points');
    });

    // helix
    it('helix path still works', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('helix 5 30 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const helixCall = oc._calls.find((c: any) => c.method === 'makeHelixWire');
      expect(helixCall).toBeDefined();
    });

    // sweep with paths
    it('line path can be used with sweep', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$path = line (0,0,0) (0,0,30)\ncircle 5 | sweep $path');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const pipeCall = oc._calls.find((c: any) => c.method === 'pipe');
      expect(pipeCall).toBeDefined();
    });

    it('arc path can be used with sweep', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$path = arc (0, 0, 0) (5, 0, 15) (10, 0, 30)\ncircle 2 | sweep $path');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const buildCall = oc._calls.find((c: any) => c.method === 'buildCurves3d');
      expect(buildCall).toBeDefined();
      const pipeCall = oc._calls.find((c: any) => c.method === 'pipe');
      expect(pipeCall).toBeDefined();
    });

    it('bezier path can be used with sweep', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$path = bezier [(0,0,0), (5,10,0), (10,0,0), (10,0,30)]\ncircle 2 | sweep $path');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const pipeCall = oc._calls.find((c: any) => c.method === 'pipe');
      expect(pipeCall).toBeDefined();
    });

    it('spline path is a wire, so it can be a sweep spine', () => {
      // interpolatePoints returns an edge. It used to be stored as the path
      // wire directly, and sweep then failed with `pipe: TopoDS::Wire`
      // (objects/korocube/KL.poly). Every other path primitive wraps its
      // edges in a wire; spline must too.
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$path = spline [(0,-30,0), (5,0,0), (0,30,0)]\ncircle 3 | sweep $path');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const interp = oc._calls.findIndex((c: any) => c.method === 'interpolatePoints');
      const wire = oc._calls.findIndex((c: any, i: number) => i > interp && c.method === 'makeWire');
      expect(interp).toBeGreaterThanOrEqual(0);
      expect(wire).toBeGreaterThan(interp);
      expect(oc._calls.find((c: any) => c.method === 'pipe')).toBeDefined();
    });

    // path validation
    it('line requires tuple points (throws without OC for shape ops)', () => {
      expect(() => evalExpr('line 10 20')).toThrow('Expected (x,y) or (x,y,z) tuple');
    });

    it('arc requires tuple points', () => {
      expect(() => evalExpr('arc 10 20 30')).toThrow('Expected (x,y) or (x,y,z) tuple');
    });

    it('bezier requires a list of control points', () => {
      expect(() => evalExpr('bezier 10 20')).toThrow('bezier requires a list of control points');
    });
  });
});
