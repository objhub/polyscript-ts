/**
 * Tests for extrude, revolve, sweep, loft, cut, hole operations.
 * Covers parser, validator, evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator } from '../src/evaluator.js';
import type { Expression, PipeOp, Statement } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';

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
    loft(wires: any[], isSolid: boolean, ruled: boolean) {
      calls.push({ method: 'loft', args: [wires, isSolid, ruled] });
      return nextHandle();
    },
  } as any;
  return mock;
}

// ===========================================================================
// Parser
// ===========================================================================

describe('extrude-loft', () => {
  describe('parser', () => {
    it('parses extrude with draft', () => {
      const { ops } = parsePipeline('circle 10 | extrude 10 draft:5');
      expect(ops[0].type).toBe('Extrude');
      if (ops[0].type === 'Extrude') {
        expect(ops[0].args[0]).toMatchObject({ type: 'NumberLit', value: 10 });
        expect(ops[0].namedArgs[0].key).toBe('draft');
      }
    });

    it('parses revolve Y', () => {
      const { ops } = parsePipeline('circle 10 | revolve Y');
      expect(ops[0].type).toBe('Revolve');
      if (ops[0].type === 'Revolve') {
        expect(ops[0].args[0]).toMatchObject({ type: 'StringLit', value: 'Y' });
        expect(ops[0].args).toHaveLength(1);
      }
    });

    it('parses revolve X 180', () => {
      const { ops } = parsePipeline('circle 10 | revolve X 180');
      expect(ops[0].type).toBe('Revolve');
      if (ops[0].type === 'Revolve') {
        expect(ops[0].args[0]).toMatchObject({ type: 'StringLit', value: 'X' });
        expect(ops[0].args[1]).toMatchObject({ type: 'NumberLit', value: 180 });
      }
    });

    it('parses revolve Z 90', () => {
      const { ops } = parsePipeline('circle 10 | revolve Z 90');
      expect(ops[0].type).toBe('Revolve');
      if (ops[0].type === 'Revolve') {
        expect(ops[0].args[0]).toMatchObject({ type: 'StringLit', value: 'Z' });
        expect(ops[0].args[1]).toMatchObject({ type: 'NumberLit', value: 90 });
      }
    });

    it('rejects revolve without axis', () => {
      expect(() => parse('circle 10 | revolve')).toThrow(/revolve requires an axis/);
    });

    it('rejects revolve 360 (number first)', () => {
      expect(() => parse('circle 10 | revolve 360')).toThrow(/revolve expects an axis first/);
    });

    it('rejects revolve axis:"X" (named-arg form)', () => {
      expect(() => parse('circle 10 | revolve axis:"X"')).toThrow(/no longer accepts named arguments/);
    });

    it('parses cut with depth', () => {
      const { ops } = parsePipeline('rect 20 10 | cut 3');
      if (ops[0].type === 'Cut') {
        expect(ops[0].args).toHaveLength(1);
      }
    });

    it('parses cut without depth (through-cut)', () => {
      const { ops } = parsePipeline('circle 5 | cut');
      expect(ops[0].type).toBe('Cut');
      if (ops[0].type === 'Cut') {
        expect(ops[0].args).toHaveLength(0);
      }
    });

    it('parses hole', () => {
      const { ops } = parsePipeline('box 10 10 10 | hole 5');
      expect(ops[0].type).toBe('Hole');
    });

    it('parses sweep', () => {
      const { ops } = parsePipeline('circle 5 | sweep (helix pitch:5 height:30 radius:10)');
      expect(ops[0].type).toBe('Sweep');
    });
  });

  // ===========================================================================
  // Validator
  // ===========================================================================

  describe('validator', () => {
    it('revolve with axis has no validator errors', () => {
      const errors = getErrors('circle 10 | revolve Y');
      const revolveErrors = errors.filter(e => e.nodeType === 'Revolve');
      expect(revolveErrors).toHaveLength(0);
    });

    it('revolve with axis and degrees has no validator errors', () => {
      const errors = getErrors('circle 10 | revolve Y 180');
      const revolveErrors = errors.filter(e => e.nodeType === 'Revolve');
      expect(revolveErrors).toHaveLength(0);
    });

    it('reports missing extrude height', () => {
      const errors = getErrors('circle 10 | extrude');
      const extrudeErrors = errors.filter(e => e.nodeType === 'Extrude');
      expect(extrudeErrors.length).toBeGreaterThan(0);
    });

    it('allows cut without depth (through-cut)', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | circle 5 | cut');
      const cutErrors = errors.filter(e => e.nodeType === 'Cut');
      expect(cutErrors).toHaveLength(0);
    });

    it('reports missing diff shape', () => {
      const errors = getErrors('box 10 10 10 | diff');
      const diffErrors = errors.filter(e => e.nodeType === 'Diff');
      expect(diffErrors.length).toBeGreaterThan(0);
    });

    it('reports missing hole radius', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)] | hole');
      const holeErrors = errors.filter(e => e.nodeType === 'Hole');
      expect(holeErrors.length).toBeGreaterThan(0);
      expect(holeErrors[0].message).toContain('hole requires a radius');
    });

    it('rejects extrude on 3D context', () => {
      const errors = getErrors('box 10 10 10 | extrude 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 3D');
    });

    it('rejects hole on 3D context (needs face or point selection)', () => {
      const errors = getErrors('box 10 10 10 | hole 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 3D');
    });

    it('accepts 3D -> faces -> hole (face center hole)', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts 3D -> faces -> hole with depth', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5 3');
      expect(errors).toHaveLength(0);
    });

    it('FaceSelection -> hole transitions to 3D', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5 | diff (sphere 3)');
      expect(errors).toHaveLength(0);
    });

    it('accepts 3D -> faces -> points -> hole', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)] | hole 3');
      expect(errors).toHaveLength(0);
    });

    it('accepts 2D -> extrude -> 3D -> diff', () => {
      const errors = getErrors('circle 10 | extrude 20 | diff (sphere 5)');
      expect(errors).toHaveLength(0);
    });

    it('revolve transitions to 3D', () => {
      const errors = getErrors('circle 10 | revolve Y | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('rejects extrude on EdgeSelection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | extrude 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in EdgeSelection');
    });

    // FaceSelection hole validator tests
    it('accepts hole in FaceSelection context', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts hole with depth in FaceSelection context', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5 3');
      expect(errors).toHaveLength(0);
    });

    it('hole transitions FaceSelection to 3D', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5 | diff (sphere 3)');
      expect(errors).toHaveLength(0);
    });

    it('rejects extrude after face-hole (already 3D)', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | hole 5 | extrude 10');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 3D');
    });

    it('still accepts hole in PointSelection context', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0)] | hole 3');
      expect(errors).toHaveLength(0);
    });

    it('still rejects hole in 3D context', () => {
      const errors = getErrors('box 10 10 10 | hole 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 3D');
    });

    it('accepts hole in 2D context (required for faces | moveto | hole pattern)', () => {
      // hole is allowed in 2D context so `faces <Y | moveto 0 10 | hole 5`
      // passes validation. A bare `circle 10 | hole 5` is semantically vacuous
      // (no shape to drill) but the validator no longer rejects it — runtime
      // silently produces no shape.
      const errors = getErrors('circle 10 | hole 5');
      expect(errors.length).toBe(0);
    });

    it('still rejects hole in EdgeSelection context', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | hole 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in EdgeSelection');
    });

    // Loft validator tests
    it('accepts loft in 2D context', () => {
      const errors = getErrors('circle 10 | loft 20');
      expect(errors).toHaveLength(0);
    });

    it('loft transitions to 3D', () => {
      const errors = getErrors('circle 10 | loft 20 | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('rejects loft in 3D context', () => {
      const errors = getErrors('box 10 10 10 | loft 20');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 3D');
    });

    it('reports missing loft height', () => {
      const errors = getErrors('circle 10 | loft');
      const loftErrors = errors.filter(e => e.nodeType === 'Loft');
      expect(loftErrors.length).toBeGreaterThan(0);
    });

    // Workplane context
    it('rejects extrude in workplane context', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | extrude 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in Workplane');
    });
  });

  // ===========================================================================
  // Evaluator
  // ===========================================================================

  describe('evaluator', () => {
    // Extrude draft
    it('extrude without draft uses standard extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 40 30 | extrude 10');
      evaluator.evaluate(ast);

      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
      const draftCall = oc._calls.find((c: any) => c.method === 'draftPrism');
      expect(draftCall).toBeUndefined();
    });

    it('extrude with draft: uses draftPrism', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 40 30 | extrude 10 draft:5');
      evaluator.evaluate(ast);

      const draftCall = oc._calls.find((c: any) => c.method === 'draftPrism');
      expect(draftCall).toBeDefined();
      expect(draftCall!.args[4]).toBe(5);
    });

    it('extrude with draft:0 uses standard extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 40 30 | extrude 10 draft:0');
      evaluator.evaluate(ast);

      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
      const draftCall = oc._calls.find((c: any) => c.method === 'draftPrism');
      expect(draftCall).toBeUndefined();
    });

    // Revolve axis
    it('revolve Y uses Y axis with 360 degrees', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 5 | revolve Y');
      evaluator.evaluate(ast);

      const revolveCall = oc._calls.find((c: any) => c.method === 'revolve');
      expect(revolveCall).toBeDefined();
      expect(revolveCall!.args[1].direction).toEqual({ x: 0, y: 1, z: 0 });
      expect(revolveCall!.args[2]).toBeCloseTo(2 * Math.PI);
    });

    it('revolve X uses X axis', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 5 | revolve X');
      evaluator.evaluate(ast);

      const revolveCall = oc._calls.find((c: any) => c.method === 'revolve');
      expect(revolveCall).toBeDefined();
      expect(revolveCall!.args[1].direction).toEqual({ x: 1, y: 0, z: 0 });
    });

    it('revolve Z uses Z axis', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 5 | revolve Z 180');
      evaluator.evaluate(ast);

      const revolveCall = oc._calls.find((c: any) => c.method === 'revolve');
      expect(revolveCall).toBeDefined();
      expect(revolveCall!.args[1].direction).toEqual({ x: 0, y: 0, z: 1 });
      expect(revolveCall!.args[2]).toBeCloseTo(Math.PI);
    });

    it('revolve Y 180 uses Y axis with 180 degrees', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 5 | revolve Y 180');
      evaluator.evaluate(ast);

      const revolveCall = oc._calls.find((c: any) => c.method === 'revolve');
      expect(revolveCall).toBeDefined();
      expect(revolveCall!.args[1].direction).toEqual({ x: 0, y: 1, z: 0 });
      expect(revolveCall!.args[2]).toBeCloseTo(Math.PI);
    });

    it('revolve X 90 uses X axis with 90 degrees', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 5 | revolve X 90');
      evaluator.evaluate(ast);

      const revolveCall = oc._calls.find((c: any) => c.method === 'revolve');
      expect(revolveCall).toBeDefined();
      expect(revolveCall!.args[1].direction).toEqual({ x: 1, y: 0, z: 0 });
      expect(revolveCall!.args[2]).toBeCloseTo(Math.PI / 2);
    });

    // Sweep with paths
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

    // Move then rect draws offset rectangle
    it('move then rect draws offset rectangle', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 20 20 | move 10 0 | rect 5 5 | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
    });
  });
});

// ===========================================================================
// Loft comprehensive tests
// ===========================================================================

describe('loft', () => {
  describe('parser', () => {
    it('parses 2-section loft: circle | loft [rect] height', () => {
      const { source, ops } = parsePipeline('circle 5 | loft [rect 8 8] 10');
      expect(source.type).toBe('CircleExpr');
      expect(ops[0].type).toBe('Loft');
      if (ops[0].type === 'Loft') {
        expect(ops[0].args).toHaveLength(2);
        // args[0] is the sections list
        expect(ops[0].args[0].type).toBe('ListLit');
        // args[1] is the height
        expect(ops[0].args[1]).toMatchObject({ type: 'NumberLit', value: 10 });
      }
    });

    it('parses 3-section loft with explicit offsets', () => {
      const { ops } = parsePipeline('circle 5 | loft [rect 8 8, circle 3] [5, 15]');
      expect(ops[0].type).toBe('Loft');
      if (ops[0].type === 'Loft') {
        expect(ops[0].args).toHaveLength(2);
        // args[0] is sections list with 2 entries
        if (ops[0].args[0].type === 'ListLit') {
          expect(ops[0].args[0].elements).toHaveLength(2);
        }
        // args[1] is the offsets list
        expect(ops[0].args[1].type).toBe('ListLit');
      }
    });

    it('parses ruled loft', () => {
      const { ops } = parsePipeline('circle 5 | loft [circle 5] 10 ruled:true');
      expect(ops[0].type).toBe('Loft');
      if (ops[0].type === 'Loft') {
        expect(ops[0].namedArgs).toHaveLength(1);
        expect(ops[0].namedArgs[0].key).toBe('ruled');
      }
    });

    it('parses loft with same shape (shrinking)', () => {
      const { ops } = parsePipeline('circle 10 | loft [circle 3] 20');
      expect(ops[0].type).toBe('Loft');
      if (ops[0].type === 'Loft') {
        expect(ops[0].args).toHaveLength(2);
      }
    });
  });

  describe('validator', () => {
    it('accepts 2-section loft (circle -> rect)', () => {
      const errors = getErrors('circle 5 | loft [rect 8 8] 10');
      expect(errors).toHaveLength(0);
    });

    it('accepts 3-section loft with offsets', () => {
      const errors = getErrors('circle 5 | loft [rect 8 8, circle 3] [5, 15]');
      expect(errors).toHaveLength(0);
    });

    it('accepts ruled loft', () => {
      const errors = getErrors('circle 5 | loft [circle 5] 10 ruled:true');
      expect(errors).toHaveLength(0);
    });

    it('accepts shrinking loft', () => {
      const errors = getErrors('circle 10 | loft [circle 3] 20');
      expect(errors).toHaveLength(0);
    });

    it('loft transitions to 3D (fillet after loft is valid)', () => {
      const errors = getErrors('circle 10 | loft [rect 5 5] 10 | fillet 2');
      expect(errors).toHaveLength(0);
    });
  });

  describe('evaluator', () => {
    it('2-section loft (circle -> rect) calls oc.loft with 2 wires', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 5 | loft [rect 8 8] 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const loftCall = oc._calls.find((c: any) => c.method === 'loft');
      expect(loftCall).toBeDefined();
      // 2 wires: source circle at offset 0, rect section translated to offset 10
      expect(loftCall!.args[0]).toHaveLength(2);
      // smooth=true (not ruled)
      expect(loftCall!.args[1]).toBe(true);
    });

    it('3-section loft calls oc.loft with 3 wires', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 5 | loft [rect 8 8, circle 3] [5, 15]');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const loftCall = oc._calls.find((c: any) => c.method === 'loft');
      expect(loftCall).toBeDefined();
      // 3 wires: source + 2 sections
      expect(loftCall!.args[0]).toHaveLength(3);
      expect(loftCall!.args[1]).toBe(true); // smooth
    });

    it('3-section loft translates sections at correct offsets', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 5 | loft [rect 8 8, circle 3] [5, 15]');
      evaluator.evaluate(ast);

      // Sections are translated along the plane normal (Z for XY plane)
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // The loft code translates each section wire:
      // Section 1 at offset 5: translate(wire, 0, 0, 5)
      // Section 2 at offset 15: translate(wire, 0, 0, 15)
      // Find translate calls with dz=5 and dz=15
      const loftTranslates = translateCalls.filter((c: any) =>
        (Math.abs(c.args[3] - 5) < 0.01) || (Math.abs(c.args[3] - 15) < 0.01)
      );
      expect(loftTranslates.length).toBe(2);
    });

    it('ruled loft passes ruled=true to oc.loft, still asking for a solid', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 5 | loft [circle 5] 10 ruled:true');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const loftCall = oc._calls.find((c: any) => c.method === 'loft');
      expect(loftCall).toBeDefined();
      // args are (wires, isSolid, ruled). Until occt-wasm 2.0.0 exposed
      // `ruled`, this passed !ruled in the isSolid slot, so ruled:true
      // silently asked for a shell instead of a solid.
      expect(loftCall!.args[1]).toBe(true);
      expect(loftCall!.args[2]).toBe(true);
    });

    it('spline (default, non-ruled) loft passes ruled=false', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 5 | loft [rect 8 8] 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const loftCall = oc._calls.find((c: any) => c.method === 'loft');
      expect(loftCall).toBeDefined();
      expect(loftCall!.args[1]).toBe(true);
      expect(loftCall!.args[2]).toBe(false);
    });

    it('heights parameter distributes sections at explicit offsets', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // heights [3, 7, 12] means 3 additional sections at those offsets
      const ast = parse('circle 10 | loft [circle 8, circle 5, circle 2] [3, 7, 12]');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const loftCall = oc._calls.find((c: any) => c.method === 'loft');
      expect(loftCall).toBeDefined();
      // 4 wires: source + 3 sections
      expect(loftCall!.args[0]).toHaveLength(4);
    });

    it('uniform height distributes sections evenly', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // 2 additional sections at height 20 -> offsets 10, 20
      const ast = parse('circle 10 | loft [circle 7, circle 3] 20');
      evaluator.evaluate(ast);

      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // Section 1 at 20*1/2 = 10, Section 2 at 20*2/2 = 20
      const loftTranslates = translateCalls.filter((c: any) =>
        (Math.abs(c.args[3] - 10) < 0.01) || (Math.abs(c.args[3] - 20) < 0.01)
      );
      expect(loftTranslates.length).toBe(2);
    });

    it('shrinking loft (circle 10 -> circle 3) produces valid shape', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | loft [circle 3] 20');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as any;
      expect(wp.shape).toBeTruthy();
      const loftCall = oc._calls.find((c: any) => c.method === 'loft');
      expect(loftCall).toBeDefined();
      expect(loftCall!.args[0]).toHaveLength(2);
      // Both should be circle wires
      const circleCalls = oc._calls.filter((c: any) => c.method === 'makeCircleEdge');
      expect(circleCalls.length).toBe(2);
      const radii = circleCalls.map((c: any) => c.args[2]).sort((a: number, b: number) => a - b);
      expect(radii).toEqual([3, 10]);
    });

    it('loft produces a solid shape (not null)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | loft [rect 5 5] 10');
      const result = evaluator.evaluate(ast) as any;

      expect(result.shape).toBeTruthy();
      // After loft, wires should be cleared
      expect(result.wires).toHaveLength(0);
    });

    it('loft clears wires after completion', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 5 | loft [circle 3] 10');
      const result = evaluator.evaluate(ast) as any;

      expect(result.wires).toHaveLength(0);
    });
  });
});
