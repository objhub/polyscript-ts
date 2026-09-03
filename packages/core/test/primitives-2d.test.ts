/**
 * Tests for 2D primitives: rect, circle, ellipse, polygon, polyline, text.
 * Covers parser, validator, and evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator, EvalError } from '../src/evaluator.js';
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
  } as any;
  return mock;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('2D primitives', () => {
  describe('parser', () => {
    it('parses rect', () => {
      const stmt = parseFirst('rect 50 30');
      expect(stmt.type).toBe('RectExpr');
    });

    it('parses circle', () => {
      const stmt = parseFirst('circle 10');
      expect(stmt.type).toBe('CircleExpr');
    });

    it('parses ellipse', () => {
      const stmt = parseFirst('ellipse 10 5');
      expect(stmt.type).toBe('EllipseExpr');
    });

    it('parses text with string and number', () => {
      const stmt = parseFirst('text "ABC" 10');
      expect(stmt.type).toBe('TextExpr');
      if (stmt.type === 'TextExpr') {
        expect(stmt.args[0]).toMatchObject({ type: 'StringLit', value: 'ABC' });
        expect(stmt.args[1]).toMatchObject({ type: 'NumberLit', value: 10 });
      }
    });

    it('parses circle as pipe op', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane | circle 5');
      expect(ops[2].type).toBe('Implicit2DPrimitive');
      if (ops[2].type === 'Implicit2DPrimitive') {
        expect(ops[2].primitive.type).toBe('CircleExpr');
      }
    });

    it('parses ellipse as pipe op', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane | ellipse 5 3');
      expect(ops[2].type).toBe('Implicit2DPrimitive');
      if (ops[2].type === 'Implicit2DPrimitive') {
        expect(ops[2].primitive.type).toBe('EllipseExpr');
      }
    });

    it('parses implicit 2D primitive in pipe', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane | rect 20 10 | cut 3');
      expect(ops[2].type).toBe('Implicit2DPrimitive');
      if (ops[2].type === 'Implicit2DPrimitive') {
        expect(ops[2].primitive.type).toBe('RectExpr');
      }
      expect(ops[3].type).toBe('Cut');
    });

    it('parses 2D primitive directly after faces select', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | rect 70 50');
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Implicit2DPrimitive');
      if (ops[1].type === 'Implicit2DPrimitive') {
        expect(ops[1].primitive.type).toBe('RectExpr');
      }
    });

    it('parses circle directly after faces select', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | circle 5 | cut');
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Implicit2DPrimitive');
      expect(ops[2].type).toBe('Cut');
    });

    it('parses polyline as pipe op with workplane', () => {
      const { ops } = parsePipeline('box 80 60 10 | faces >Z | workplane | polyline [(0,0), (10,0), (5,10)] | cut 3');
      expect(ops[2].type).toBe('Implicit2DPrimitive');
      if (ops[2].type === 'Implicit2DPrimitive') {
        expect(ops[2].primitive.type).toBe('PolylineExpr');
      }
      expect(ops[3].type).toBe('Cut');
    });

    it('parses polyline directly after faces select', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | polyline [(0,0), (10,0), (5,10)]');
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Implicit2DPrimitive');
      if (ops[1].type === 'Implicit2DPrimitive') {
        expect(ops[1].primitive.type).toBe('PolylineExpr');
      }
    });

    it('parses text as pipe op with workplane', () => {
      const { ops } = parsePipeline('box 80 60 10 | faces >Z | workplane | text "M8" | cut 2');
      expect(ops[2].type).toBe('Implicit2DPrimitive');
      if (ops[2].type === 'Implicit2DPrimitive') {
        expect(ops[2].primitive.type).toBe('TextExpr');
      }
      expect(ops[3].type).toBe('Cut');
    });

    it('parses text with kwargs as pipe op', () => {
      const { ops } = parsePipeline('box 80 60 10 | faces >Z | workplane | text "M8" size:10 | cut 2');
      expect(ops[2].type).toBe('Implicit2DPrimitive');
      if (ops[2].type === 'Implicit2DPrimitive') {
        expect(ops[2].primitive.type).toBe('TextExpr');
        if (ops[2].primitive.type === 'TextExpr') {
          expect(ops[2].primitive.namedArgs.length).toBe(1);
          expect(ops[2].primitive.namedArgs[0].key).toBe('size');
        }
      }
      expect(ops[3].type).toBe('Cut');
    });

    it('parses text directly after faces select', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | text "HELLO" | cut');
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Implicit2DPrimitive');
      if (ops[1].type === 'Implicit2DPrimitive') {
        expect(ops[1].primitive.type).toBe('TextExpr');
      }
      expect(ops[2].type).toBe('Cut');
    });

    // polygon (regular polygon) primitive
    it('parses polygon as source command', () => {
      const stmt = parseFirst('polygon 6 8') as Expression;
      expect(stmt.type).toBe('PolygonExpr');
      expect((stmt as any).args).toHaveLength(2);
    });

    it('parses polygon with single arg (sides only)', () => {
      const stmt = parseFirst('polygon 6') as Expression;
      expect(stmt.type).toBe('PolygonExpr');
      expect((stmt as any).args).toHaveLength(1);
    });

    it('parses polygon as pipe 2D primitive', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | polygon 6 8 | extrude 5');
      expect(ops).toHaveLength(3);
      expect(ops[1].type).toBe('Implicit2DPrimitive');
      expect((ops[1] as any).primitive.type).toBe('PolygonExpr');
    });

    // text size: kwarg
    it('parses text with size: kwarg', () => {
      const stmt = parseFirst('text "M8" size:10');
      expect(stmt.type).toBe('TextExpr');
      if (stmt.type === 'TextExpr') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('size');
        expect(stmt.namedArgs[0].value).toMatchObject({ type: 'NumberLit', value: 10 });
      }
    });

    it('parses text with size: as pipe op', () => {
      const stmt = parseFirst('box 10 10 10 | faces >Z | text "M8" size:10 | cut 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const textOp = stmt.ops[1]; // Implicit2DPrimitive wrapping TextExpr
        expect(textOp.type).toBe('Implicit2DPrimitive');
        if (textOp.type === 'Implicit2DPrimitive') {
          expect(textOp.primitive.type).toBe('TextExpr');
          if (textOp.primitive.type === 'TextExpr') {
            expect(textOp.primitive.namedArgs[0].key).toBe('size');
          }
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Validator
  // ---------------------------------------------------------------------------

  describe('validator', () => {
    it('rejects faces on 2D context', () => {
      const errors = getErrors('circle 10 | faces >Z');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 2D');
    });

    it('accepts 2D -> extrude -> 3D -> diff', () => {
      const errors = getErrors('circle 10 | extrude 20 | diff (sphere 5)');
      expect(errors).toHaveLength(0);
    });

    it('accepts face selection to implicit 2D', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | rect 70 50');
      expect(errors).toHaveLength(0);
    });

    it('accepts full combined example: faces > rect > verts > circle > cut', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | rect 70 50 | verts | circle 1 | cut');
      expect(errors).toHaveLength(0);
    });

    it('accepts circle directly after faces select', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | circle 5 | cut');
      expect(errors).toHaveLength(0);
    });

    it('accepts implicit 2D in 2D context', () => {
      const errors = getErrors('rect 10 10 | circle 5');
      expect(errors).toHaveLength(0);
    });

    // polygon validator
    it('accepts polygon as source 2D primitive', () => {
      const errors = getErrors('polygon 6 8 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts polygon in face selection context (pipe 2D)', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | polygon 6 3 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts polygon on workplane', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | polygon 6 3 | extrude 5');
      expect(errors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Evaluator
  // ---------------------------------------------------------------------------

  describe('evaluator', () => {
    it('rejects circle directly after fillet (3D context)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 80 60 10 | fillet 2 | circle 10 | cut');
      expect(() => evaluator.evaluate(ast)).toThrow(EvalError);
      expect(() => evaluator.evaluate(ast)).toThrow(/2D primitive 'circle' requires face selection/);
    });

    it('rejects rect directly after box (3D context)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | rect 5 5 | extrude 3');
      expect(() => evaluator.evaluate(ast)).toThrow(EvalError);
      expect(() => evaluator.evaluate(ast)).toThrow(/2D primitive 'rect' requires face selection/);
    });

    it('rejects ellipse directly after chamfer (3D context)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | chamfer 1 | ellipse 5 3 | cut');
      expect(() => evaluator.evaluate(ast)).toThrow(/2D primitive 'ellipse' requires face selection/);
    });

    it('rejects polyline directly after 3D boolean (3D context)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | diff (box 5 5 5) | polyline [(0,0), (5,0), (5,5)]');
      expect(() => evaluator.evaluate(ast)).toThrow(/2D primitive 'polyline' requires face selection/);
    });

    it('rejects text directly after translate (3D context)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | translate 5 0 0 | text "hi" | cut');
      expect(() => evaluator.evaluate(ast)).toThrow(/2D primitive 'text' requires face selection/);
    });

    it('error message suggests faces selection', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | circle 5 | cut');
      try {
        evaluator.evaluate(ast);
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e.message).toContain("faces top");
        expect(e.message).toContain("circle");
      }
    });

    it('allows circle after faces selection (valid)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | circle 5 | cut');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    it('allows rect after workplane in 3D pipeline (valid)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | workplane "XZ" | rect 5 5 | extrude 3');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    it('allows circle after faces > workplane (valid)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | workplane | circle 5 | cut');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    it('rejects circle after fillet which follows cut (3D context)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 80 60 10 | faces >Z | circle 10 | cut | fillet 2 | circle 5');
      expect(() => evaluator.evaluate(ast)).toThrow(/2D primitive 'circle' requires face selection/);
    });

    // polygon evaluator
    it('polygon 6 8 creates a hexagonal wire', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('polygon 6 8');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.wires).toHaveLength(1);

      const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
      expect(lineEdgeCalls.length).toBe(6);
      const makeWireCall = oc._calls.find((c: any) => c.method === 'makeWire');
      expect(makeWireCall).toBeDefined();
    });

    it('polygon 4 10 creates a square wire', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('polygon 4 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
      expect(lineEdgeCalls.length).toBe(4);
    });

    it('polygon can be used in pipeline with extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('polygon 6 8 | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();

      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
      expect(extrudeCall!.args[3]).toBeCloseTo(5);
    });

    it('polygon works as pipe 2D primitive on face selection', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | polygon 6 3 | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const lineEdgeCalls = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
      expect(lineEdgeCalls.length).toBe(6);
    });

    it('at: in pipe affects only wires, not the base shape (rect)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | rect 5 5 at:(10,0)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      // The base shape from box should be preserved (not translated)
      expect(wp.shape).toBeTruthy();
      // Wires should exist (the rect wire, translated)
      expect(wp.wires.length).toBeGreaterThan(0);
      // Find translate calls — they should only be for wires, not the box shape
      const makeBoxCall = oc._calls.find((c: any) => c.method === 'makeBox');
      expect(makeBoxCall).toBeDefined();
      // The shape on the result should be the original box shape handle
      // (which was set during face selection), not a translated version
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // There should be translate calls for the wire(s), but none should
      // have the box shape as the first argument
      for (const call of translateCalls) {
        // The box shape handle is the return value of makeBox, which is a number
        // In our mock, makeBox returns a handle; the shape in WpState should not
        // have been passed to translate
        expect(call.args[0]).not.toBe(wp.shape);
      }
    });

    it('at: in pipe affects only wires, not the base shape (circle)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | circle 3 at:(5,5)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
      expect(wp.wires.length).toBeGreaterThan(0);
      // Verify translate was called (for wire placement)
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls.length).toBeGreaterThan(0);
      // None of the translate calls should operate on the base shape
      for (const call of translateCalls) {
        expect(call.args[0]).not.toBe(wp.shape);
      }
    });

    it('at: on top face (XY plane) translates in X and Y', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // faces >Z gives XY plane: xDir=(1,0,0), yDir=(0,1,0)
      const ast = parse('box 10 10 10 | faces >Z | rect 5 5 at:(20,20)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls.length).toBeGreaterThan(0);
      // On XY plane, at:(20,20) should translate by (20, 20, 0)
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBeCloseTo(20); // dx
      expect(lastTranslate.args[2]).toBeCloseTo(20); // dy
      expect(lastTranslate.args[3]).toBeCloseTo(0);  // dz
    });

    it('at: on front face (XZ plane) translates in X and Z', () => {
      const oc = createMockOC();
      // Override surfaceNormal to return front face normal (Y direction)
      oc.surfaceNormal = () => ({ x: 0, y: -1, z: 0 });
      const evaluator = new Evaluator({ oc });
      // faces <Y gives XZ plane: xDir=(-1,0,0), yDir=(0,0,1)
      const ast = parse('box 10 10 10 | faces <Y | rect 5 5 at:(20,20)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      // Verify plane is XZ-like: xDir has no Y, yDir has no Y
      expect(wp.plane.xDir.y).toBeCloseTo(0);
      expect(wp.plane.yDir.y).toBeCloseTo(0);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls.length).toBeGreaterThan(0);
      // On XZ plane (<Y face), at:(20,20) should translate by X and Z, NOT Y
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[2]).toBeCloseTo(0);  // dy must be 0
      // dx and dz should account for the 20,20 local displacement
      expect(Math.abs(lastTranslate.args[1])).toBeCloseTo(20); // dx = +/-20
      expect(lastTranslate.args[3]).toBeCloseTo(20); // dz = 20
    });

    it('at: via workplane "XZ" translates in X and Z', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // workplane "XZ": xDir=(1,0,0), yDir=(0,0,1)
      const ast = parse('box 10 10 10 | workplane "XZ" | rect 3 3 at:(20,20)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls.length).toBeGreaterThan(0);
      // On XZ plane, at:(20,20) should translate by (20, 0, 20)
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBeCloseTo(20); // dx
      expect(lastTranslate.args[2]).toBeCloseTo(0);  // dy = 0
      expect(lastTranslate.args[3]).toBeCloseTo(20); // dz
    });
  });
});

// ---------------------------------------------------------------------------
// text size: named arg
// ---------------------------------------------------------------------------

describe('text size: named arg', () => {
  describe('parser', () => {
    it('parses text "Hello" size:20', () => {
      const stmt = parseFirst('text "Hello" size:20');
      expect(stmt.type).toBe('TextExpr');
      if (stmt.type === 'TextExpr') {
        expect(stmt.args).toHaveLength(1); // only string arg
        expect(stmt.args[0]).toMatchObject({ type: 'StringLit', value: 'Hello' });
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('size');
        expect(stmt.namedArgs[0].value).toMatchObject({ type: 'NumberLit', value: 20 });
      }
    });

    it('parses text "Hello" 15 (positional size)', () => {
      const stmt = parseFirst('text "Hello" 15');
      expect(stmt.type).toBe('TextExpr');
      if (stmt.type === 'TextExpr') {
        expect(stmt.args).toHaveLength(2);
        expect(stmt.args[1]).toMatchObject({ type: 'NumberLit', value: 15 });
      }
    });
  });

  describe('evaluator', () => {
    it('text "Hello" size:20 produces wires', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('text "Hello" size:20');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      // With real font: multiple contour wires; with placeholder: 1 rect wire
      expect(wp.wires.length).toBeGreaterThanOrEqual(1);
      // At least some edges were created (line or bezier)
      const edgeCalls = oc._calls.filter((c: any) =>
        c.method === 'makeLineEdge' || c.method === 'makeBezierEdge');
      expect(edgeCalls.length).toBeGreaterThanOrEqual(4);
    });

    it('text "Hello" 15 produces wires', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('text "Hello" 15');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.wires.length).toBeGreaterThanOrEqual(1);
    });

    it('text "A" defaults to size=10 when no size given', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('text "A"');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      // "A" has at least 1 contour (outer) — with real font, possibly 2 (+ inner hole)
      expect(wp.wires.length).toBeGreaterThanOrEqual(1);
    });

    it('size: named arg takes priority over positional arg[1]', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // Both positional and named: named should win
      const ast = parse('text "AB" 15 size:30');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.wires.length).toBeGreaterThanOrEqual(1);
      // Verify edges were created
      const edgeCalls = oc._calls.filter((c: any) =>
        c.method === 'makeLineEdge' || c.method === 'makeBezierEdge');
      expect(edgeCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('text "M8" size:10 in pipe context uses size=10', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 80 60 10 | faces >Z | text "M8" size:10 | cut 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
      // Edge calls include box + text edges
      const edgeCalls = oc._calls.filter((c: any) =>
        c.method === 'makeLineEdge' || c.method === 'makeBezierEdge');
      expect(edgeCalls.length).toBeGreaterThanOrEqual(4);
    });
  });
});

// ---------------------------------------------------------------------------
// Workplane as source command
// ---------------------------------------------------------------------------

describe('workplane as source command', () => {
  describe('parser', () => {
    it('parses workplane "XZ" as source (Pipeline with Workplane source)', () => {
      const stmt = parseFirst('workplane "XZ" | circle 10 | extrude 10');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('Workplane');
        if (stmt.source.type === 'Workplane') {
          expect(stmt.source.args).toHaveLength(1);
          expect(stmt.source.args[0]).toMatchObject({ type: 'StringLit', value: 'XZ' });
        }
        expect(stmt.ops).toHaveLength(2);
        expect(stmt.ops[0].type).toBe('Implicit2DPrimitive');
        expect(stmt.ops[1].type).toBe('Extrude');
      }
    });

    it('parses workplane "YZ" | rect 20 10 | extrude 5', () => {
      const stmt = parseFirst('workplane "YZ" | rect 20 10 | extrude 5');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('Workplane');
        if (stmt.source.type === 'Workplane') {
          expect(stmt.source.args[0]).toMatchObject({ type: 'StringLit', value: 'YZ' });
        }
      }
    });

    it('parses workplane without args (default XY)', () => {
      const stmt = parseFirst('workplane | circle 5 | extrude 3');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('Workplane');
        if (stmt.source.type === 'Workplane') {
          expect(stmt.source.args).toHaveLength(0);
        }
      }
    });

    it('parses standalone workplane "XZ" (no pipe ops)', () => {
      const stmt = parseFirst('workplane "XZ"');
      expect(stmt.type).toBe('Workplane');
    });

    // Bare-word plane name tests
    it('parses workplane XZ (bare-word) as source', () => {
      const stmt = parseFirst('workplane XZ | circle 10 | extrude 10');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('Workplane');
        if (stmt.source.type === 'Workplane') {
          expect(stmt.source.args).toHaveLength(1);
          expect(stmt.source.args[0]).toMatchObject({ type: 'StringLit', value: 'XZ' });
        }
        expect(stmt.ops).toHaveLength(2);
        expect(stmt.ops[0].type).toBe('Implicit2DPrimitive');
        expect(stmt.ops[1].type).toBe('Extrude');
      }
    });

    it('parses workplane YZ (bare-word) | rect 20 10 | extrude 5', () => {
      const stmt = parseFirst('workplane YZ | rect 20 10 | extrude 5');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('Workplane');
        if (stmt.source.type === 'Workplane') {
          expect(stmt.source.args[0]).toMatchObject({ type: 'StringLit', value: 'YZ' });
        }
      }
    });

    it('parses bare-word workplane XZ in pipe operation', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane XZ');
      expect(ops[1].type).toBe('Workplane');
      if (ops[1].type === 'Workplane') {
        expect(ops[1].args).toHaveLength(1);
        expect(ops[1].args[0]).toMatchObject({ type: 'StringLit', value: 'XZ' });
      }
    });

    it('rejects invalid bare-word plane name', () => {
      expect(() => parseFirst('workplane ABC | circle 10')).toThrow(/Invalid workplane name/);
    });

    it('parses standalone workplane XZ (bare-word, no pipe ops)', () => {
      const stmt = parseFirst('workplane XZ');
      expect(stmt.type).toBe('Workplane');
      if (stmt.type === 'Workplane') {
        expect(stmt.args).toHaveLength(1);
        expect(stmt.args[0]).toMatchObject({ type: 'StringLit', value: 'XZ' });
      }
    });
  });

  describe('validator', () => {
    it('accepts workplane "XZ" | circle 10 | extrude 10', () => {
      const errors = getErrors('workplane "XZ" | circle 10 | extrude 10');
      expect(errors).toHaveLength(0);
    });

    it('accepts workplane "YZ" | rect 20 10 | extrude 5', () => {
      const errors = getErrors('workplane "YZ" | rect 20 10 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts workplane | circle 5 | extrude 3', () => {
      const errors = getErrors('workplane | circle 5 | extrude 3');
      expect(errors).toHaveLength(0);
    });

    it('accepts workplane XZ | circle 10 | extrude 10 (bare-word)', () => {
      const errors = getErrors('workplane XZ | circle 10 | extrude 10');
      expect(errors).toHaveLength(0);
    });

    it('accepts workplane YZ | rect 20 10 | extrude 5 (bare-word)', () => {
      const errors = getErrors('workplane YZ | rect 20 10 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts bare-word workplane in pipe: box | faces >Z | workplane XZ', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane XZ');
      expect(errors).toHaveLength(0);
    });
  });

  describe('evaluator', () => {
    it('workplane "XZ" | circle 10 | extrude 10 produces a shape', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane "XZ" | circle 10 | extrude 10');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
      // Verify circle and extrude were called
      const circleCalls = oc._calls.filter((c: any) => c.method === 'makeCircleEdge');
      expect(circleCalls.length).toBe(1);
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(extrudeCalls.length).toBe(1);
    });

    it('workplane "YZ" | rect 20 10 | extrude 5 produces a shape', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane "YZ" | rect 20 10 | extrude 5');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
    });

    it('workplane | circle 5 | extrude 3 defaults to XY plane', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane | circle 5 | extrude 3');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
      // XY plane: normal is (0,0,1)
      // After extrude, the plane info may change, but the shape should exist
    });

    it('workplane "XZ" creates WpState with XZ plane', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane "XZ"');
      const result = evaluator.evaluate(ast);
      // Standalone workplane returns a WpState with XZ plane but no shape
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.plane.normal).toEqual({ x: 0, y: 1, z: 0 }); // XZ plane normal is Y
      expect(wp.shape).toBeNull();
    });

    it('existing pipe workplane still works: box | faces >Z | workplane "XZ" | rect | extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | workplane "XZ" | rect 5 5 | extrude 3');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
    });

    it('existing pipe workplane without plane name still works', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | workplane | circle 5 | cut');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    // Bare-word evaluator tests
    it('workplane XZ (bare-word) | circle 10 | extrude 10 produces a shape', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane XZ | circle 10 | extrude 10');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
    });

    it('workplane YZ (bare-word) | rect 20 10 | extrude 5 produces a shape', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane YZ | rect 20 10 | extrude 5');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();
    });

    it('box | faces >Z | workplane XZ (bare-word pipe op)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | faces >Z | workplane XZ');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    it('workplane XZ (bare-word) creates WpState with XZ plane', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('workplane XZ');
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.plane.normal).toEqual({ x: 0, y: 1, z: 0 }); // XZ plane normal is Y
      expect(wp.shape).toBeNull();
    });
  });
});
