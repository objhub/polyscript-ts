/**
 * Tests for transform operations: translate, rotate, scale, mirror, move, moveto, origin:.
 * Covers parser, validator, and evaluator aspects.
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
    getBoundingBox(_shape: any) { return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 }; },
    getBoundingBoxFast(_shape: any) { return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 }; },
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

describe('transform operations', () => {
  // ---------------------------------------------------------------------------
  // Parser
  // ---------------------------------------------------------------------------

  describe('parser', () => {
    it('parses translate', () => {
      const { ops } = parsePipeline('box 10 10 10 | translate 0 0 5');
      expect(ops[0].type).toBe('Translate');
      if (ops[0].type === 'Translate') {
        expect(ops[0].args).toHaveLength(3);
      }
    });

    // scale
    it('parses uniform scale (1 arg)', () => {
      const { ops } = parsePipeline('box 10 10 10 | scale 2');
      expect(ops[0].type).toBe('Scale');
      if (ops[0].type === 'Scale') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].args[0]).toMatchObject({ type: 'NumberLit', value: 2 });
        expect(ops[0].namedArgs).toHaveLength(0);
      }
    });

    it('parses non-uniform scale (3 args)', () => {
      const { ops } = parsePipeline('box 10 10 10 | scale 2 1 0.5');
      expect(ops[0].type).toBe('Scale');
      if (ops[0].type === 'Scale') {
        expect(ops[0].args).toHaveLength(3);
      }
    });

    it('parses scale with origin:"local"', () => {
      const { ops } = parsePipeline('box 10 10 10 | scale 2 1 0.5 origin:"local"');
      if (ops[0].type === 'Scale') {
        expect(ops[0].namedArgs).toHaveLength(1);
        expect(ops[0].namedArgs[0].key).toBe('origin');
      }
    });

    it('parses scale with origin tuple', () => {
      const { ops } = parsePipeline('box 10 10 10 | scale 3 origin:(10, 20, 0)');
      if (ops[0].type === 'Scale') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].namedArgs[0].key).toBe('origin');
        const originVal = ops[0].namedArgs[0].value;
        expect(originVal.type).toBe('TupleLit');
        if (originVal.type === 'TupleLit') {
          expect(originVal.elements).toHaveLength(3);
        }
      }
    });

    it('parses scale followed by another pipe op', () => {
      const { ops } = parsePipeline('box 10 10 10 | scale 2 | translate 5 0 0');
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('Scale');
      expect(ops[1].type).toBe('Translate');
    });

    // rotate/translate origin kwarg
    it('parses rotate without origin', () => {
      const { ops } = parsePipeline('box 10 10 10 | rotate 0 0 45');
      if (ops[0].type === 'Rotate') {
        expect(ops[0].args).toHaveLength(3);
        expect(ops[0].namedArgs).toHaveLength(0);
      }
    });

    it('parses rotate with origin:"local"', () => {
      const { ops } = parsePipeline('box 10 10 10 | rotate 0 0 45 origin:"local"');
      if (ops[0].type === 'Rotate') {
        expect(ops[0].namedArgs).toHaveLength(1);
        expect(ops[0].namedArgs[0].key).toBe('origin');
      }
    });

    it('parses rotate with origin:"world"', () => {
      const { ops } = parsePipeline('box 10 10 10 | rotate 0 0 45 origin:"world"');
      if (ops[0].type === 'Rotate') {
        expect(ops[0].namedArgs[0].value).toMatchObject({ type: 'StringLit', value: 'world' });
      }
    });

    it('parses rotate with origin:(10, 20, 0)', () => {
      const { ops } = parsePipeline('box 10 10 10 | rotate 0 0 45 origin:(10, 20, 0)');
      if (ops[0].type === 'Rotate') {
        const originVal = ops[0].namedArgs[0].value;
        expect(originVal.type).toBe('TupleLit');
        if (originVal.type === 'TupleLit') {
          expect(originVal.elements).toHaveLength(3);
        }
      }
    });

    it('parses translate without origin', () => {
      const { ops } = parsePipeline('box 10 10 10 | translate 0 0 5');
      if (ops[0].type === 'Translate') {
        expect(ops[0].args).toHaveLength(3);
        expect(ops[0].namedArgs).toHaveLength(0);
      }
    });

    it('parses translate with origin:"local"', () => {
      const { ops } = parsePipeline('box 10 10 10 | translate 0 0 5 origin:"local"');
      if (ops[0].type === 'Translate') {
        expect(ops[0].namedArgs).toHaveLength(1);
        expect(ops[0].namedArgs[0].key).toBe('origin');
      }
    });

    it('parses translate with origin:(5, 5, 0)', () => {
      const { ops } = parsePipeline('box 10 10 10 | translate 0 0 5 origin:(5, 5, 0)');
      if (ops[0].type === 'Translate') {
        const originVal = ops[0].namedArgs[0].value;
        expect(originVal.type).toBe('TupleLit');
        if (originVal.type === 'TupleLit') {
          expect(originVal.elements).toHaveLength(3);
        }
      }
    });

    it('parses rotate origin followed by pipe', () => {
      const { ops } = parsePipeline('box 10 10 10 | rotate 0 0 45 origin:"local" | translate 0 0 5');
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('Rotate');
      expect(ops[1].type).toBe('Translate');
    });

    it('parses floor pipe op', () => {
      const { ops } = parsePipeline('box 10 10 10 | floor');
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('Floor');
    });

    it('parses floor in a multi-op pipeline', () => {
      const { ops } = parsePipeline('sphere 10 | floor | translate 5 0 0');
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('Floor');
      expect(ops[1].type).toBe('Translate');
    });
  });

  // ---------------------------------------------------------------------------
  // Validator
  // ---------------------------------------------------------------------------

  describe('validator', () => {
    it('translate transitions to 3D', () => {
      const errors = getErrors('box 10 10 10 | translate 0 0 5 | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('rotate transitions to 3D', () => {
      const errors = getErrors('box 10 10 10 | rotate 0 0 45 | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts scale in 3D context', () => {
      const errors = getErrors('box 10 10 10 | scale 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts non-uniform scale in 3D context', () => {
      const errors = getErrors('box 10 10 10 | scale 2 1 0.5');
      expect(errors).toHaveLength(0);
    });

    it('accepts mirror in 3D context', () => {
      const errors = getErrors('box 10 10 10 | mirror "X"');
      expect(errors).toHaveLength(0);
    });

    it('scale transitions to 3D (fillet after scale)', () => {
      const errors = getErrors('box 10 10 10 | scale 2 | fillet 1');
      expect(errors).toHaveLength(0);
    });

    it('mirror transitions to 3D (fillet after mirror)', () => {
      const errors = getErrors('box 10 10 10 | mirror "X" | fillet 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts floor in 3D context', () => {
      const errors = getErrors('box 10 10 10 | floor');
      expect(errors).toHaveLength(0);
    });

    it('floor transitions to 3D (fillet after floor)', () => {
      const errors = getErrors('box 10 10 10 | floor | fillet 1');
      expect(errors).toHaveLength(0);
    });

    it('rejects floor in 2D context', () => {
      const errors = getErrors('circle 10 | floor');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 2D');
    });

    it('rejects scale in 2D context', () => {
      const errors = getErrors('circle 10 | scale 2');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 2D');
    });

    it('rejects mirror in 2D context', () => {
      const errors = getErrors('circle 10 | mirror "X"');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 2D');
    });

    it('reports missing scale factor', () => {
      const errors = getErrors('box 10 10 10 | scale');
      const scaleErrors = errors.filter(e => e.nodeType === 'Scale');
      expect(scaleErrors.length).toBeGreaterThan(0);
    });

    it('reports missing mirror axis', () => {
      const errors = getErrors('box 10 10 10 | mirror');
      const mirrorErrors = errors.filter(e => e.nodeType === 'Mirror');
      expect(mirrorErrors.length).toBeGreaterThan(0);
    });

    it('accepts move in 2D context', () => {
      const errors = getErrors('rect 10 10 | move 5 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts moveto in 2D context', () => {
      const errors = getErrors('rect 10 10 | moveto 5 5');
      expect(errors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Evaluator
  // ---------------------------------------------------------------------------

  describe('evaluator', () => {
    // scale
    it('uniform scale (1 arg) calls oc.scale()', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const scaleCall = oc._calls.find((c: any) => c.method === 'scale');
      expect(scaleCall).toBeDefined();
      expect(scaleCall!.args[1]).toEqual({ x: 0, y: 0, z: 0 });
      expect(scaleCall!.args[2]).toBe(2);
    });

    it('non-uniform scale (3 args) calls oc.generalTransform()', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 2 1 0.5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const gtCall = oc._calls.find((c: any) => c.method === 'generalTransform');
      expect(gtCall).toBeDefined();
      const matrix = gtCall!.args[1];
      expect(matrix[0]).toBe(2);
      expect(matrix[5]).toBe(1);
      expect(matrix[10]).toBe(0.5);
    });

    it('uniform scale with equal sx/sy/sz uses oc.scale()', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 3 3 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const scaleCall = oc._calls.find((c: any) => c.method === 'scale');
      expect(scaleCall).toBeDefined();
      expect(scaleCall!.args[2]).toBe(3);
      const gtCall = oc._calls.find((c: any) => c.method === 'generalTransform');
      expect(gtCall).toBeUndefined();
    });

    it('scale with origin:"local" uses bounding box center', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 2 origin:"local"');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const scaleCall = oc._calls.find((c: any) => c.method === 'scale');
      expect(scaleCall).toBeDefined();
      expect(scaleCall!.args[1]).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('scale with origin tuple uses specified center', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 2 origin:(10, 20, 30)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const scaleCall = oc._calls.find((c: any) => c.method === 'scale');
      expect(scaleCall).toBeDefined();
      expect(scaleCall!.args[1]).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('scale with 2 args throws error', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 2 3');
      expect(() => evaluator.evaluate(ast)).toThrow(/scale requires 1 or 3 arguments, got 2/);
    });

    it('scale in pipeline followed by translate', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | scale 2 | translate 5 0 0');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      expect(oc._calls.find((c: any) => c.method === 'scale')).toBeDefined();
      expect(oc._calls.find((c: any) => c.method === 'translate')).toBeDefined();
    });

    // move / moveto
    it('move shifts centerX/centerY relatively', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 10 | move 20 0 | circle 5 | extrude 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
      expect(circleCall).toBeDefined();
      expect(circleCall!.args[0].x).toBeCloseTo(20);
      expect(circleCall!.args[0].y).toBeCloseTo(0);
    });

    it('move with both dx and dy', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 10 | move 5 10 | circle 3 | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
      expect(circleCall!.args[0].x).toBeCloseTo(5);
      expect(circleCall!.args[0].y).toBeCloseTo(10);
    });

    it('moveto sets centerX/centerY absolutely', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 10 | moveto 30 20 | circle 5 | extrude 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
      expect(circleCall!.args[0].x).toBeCloseTo(30);
      expect(circleCall!.args[0].y).toBeCloseTo(20);
    });

    it('move then rect draws offset rectangle', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 20 20 | move 10 0 | rect 5 5 | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
    });

    // floor
    it('floor translates shape so zmin becomes 0', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // Mock getBoundingBox returns zmin=-5, so floor should translate(0,0,5)
      const ast = parse('box 10 10 10 | floor');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // Last translate call should be the floor translation: (shape, 0, 0, 5)
      const floorCall = translateCalls[translateCalls.length - 1];
      expect(floorCall).toBeDefined();
      expect(floorCall!.args[1]).toBeCloseTo(0);  // dx
      expect(floorCall!.args[2]).toBeCloseTo(0);  // dy
      expect(floorCall!.args[3]).toBeCloseTo(5);  // dz = -(-5)
    });

    it('floor on shape with zmin=0 is a no-op translation', () => {
      const oc = createMockOC();
      // Override getBoundingBox to return zmin=0 (already floored)
      oc.getBoundingBox = (_shape: any) => ({ xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 10, zmax: 10 });
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | floor');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // Last translate call should be the floor translation: (shape, 0, 0, 0)
      const floorCall = translateCalls[translateCalls.length - 1];
      expect(floorCall).toBeDefined();
      expect(floorCall!.args[3]).toBeCloseTo(0);  // dz = -(0) = 0
    });

    it('floor in pipeline followed by translate', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | floor | translate 5 0 0');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // At least 2 translate calls: floor + explicit translate
      // (box centering may add more)
      expect(translateCalls.length).toBeGreaterThanOrEqual(2);
      // Last translate call should be the explicit translate(5, 0, 0)
      const lastCall = translateCalls[translateCalls.length - 1];
      expect(lastCall!.args[1]).toBeCloseTo(5);  // dx
      expect(lastCall!.args[2]).toBeCloseTo(0);  // dy
      expect(lastCall!.args[3]).toBeCloseTo(0);  // dz
    });

    // translate in vertex/point context
    it('translate shifts plane origin when state has points (VertexSelection)', () => {
      const oc = createMockOC();
      let vertexId = 0;
      const vertexPositions = [
        { x: 40, y: 30, z: 0 },
        { x: -40, y: 30, z: 0 },
        { x: -40, y: -30, z: 0 },
        { x: 40, y: -30, z: 0 },
      ];
      (oc as any).getSubShapes = (_shape: any, type: string) => {
        if (type === 'vertex') {
          vertexId = 0;
          return [201, 202, 203, 204];
        }
        if (type === 'edge') return [301, 302, 303];
        if (type === 'face') return [401];
        return [];
      };
      (oc as any).vertexPosition = (_v: any) => {
        return vertexPositions[vertexId++] ?? { x: 0, y: 0, z: 0 };
      };

      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 80 60 | verts | translate 10 20 30');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.points).not.toBeNull();
      expect(wp.plane.origin.x).toBeCloseTo(10);
      expect(wp.plane.origin.y).toBeCloseTo(20);
      expect(wp.plane.origin.z).toBeCloseTo(30);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls).toHaveLength(0);
    });

    // workplane with plane name
    it('workplane "XZ" changes the working plane', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | workplane "XZ" | rect 5 5 | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
      expect(extrudeCall!.args[1]).toBeCloseTo(0);
      expect(extrudeCall!.args[2]).toBeCloseTo(3);
      expect(extrudeCall!.args[3]).toBeCloseTo(0);
    });

    it('workplane "YZ" changes the working plane', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | workplane "YZ" | rect 5 5 | extrude 4');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall!.args[1]).toBeCloseTo(4);
      expect(extrudeCall!.args[2]).toBeCloseTo(0);
      expect(extrudeCall!.args[3]).toBeCloseTo(0);
    });

    it('workplane without args resets on current plane', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | workplane | rect 5 5 | extrude 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall!.args[1]).toBeCloseTo(0);
      expect(extrudeCall!.args[2]).toBeCloseTo(0);
      expect(extrudeCall!.args[3]).toBeCloseTo(2);
    });
  });
});
