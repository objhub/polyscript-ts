/**
 * Tests for 3D primitives: box, cylinder, sphere, cone, torus.
 * Covers parser, validator, and evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { evaluateExpressions, Evaluator } from '../src/evaluator.js';
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
    makeWire(edges: any[]) { calls.push({ method: 'makeWire', args: [edges] }); return nextHandle(); },
    makeFace(wire: any) { calls.push({ method: 'makeFace', args: [wire] }); return nextHandle(); },
    makeCircleEdge(center: any, normal: any, r: number) { calls.push({ method: 'makeCircleEdge', args: [center, normal, r] }); return nextHandle(); },
    makeEllipseEdge(center: any, normal: any, major: number, minor: number) { calls.push({ method: 'makeEllipseEdge', args: [center, normal, major, minor] }); return nextHandle(); },
    extrude(shape: any, dx: number, dy: number, dz: number) { calls.push({ method: 'extrude', args: [shape, dx, dy, dz] }); return nextHandle(); },
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
    makeCone(r1: number, r2: number, h: number) { calls.push({ method: 'makeCone', args: [r1, r2, h] }); return nextHandle(); },
    makeTorus(r1: number, r2: number) { calls.push({ method: 'makeTorus', args: [r1, r2] }); return nextHandle(); },
    makeCompound(shapes: any[]) { calls.push({ method: 'makeCompound', args: [shapes] }); return nextHandle(); },
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('3D primitives', () => {
  describe('parser', () => {
    it('parses box with 3 args', () => {
      const stmt = parseFirst('box 80 60 10');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0]).toMatchObject({ type: 'NumberLit', value: 80 });
      }
    });

    it('parses cylinder with 2 args', () => {
      const stmt = parseFirst('cylinder 5 10');
      expect(stmt.type).toBe('CylinderExpr');
      if (stmt.type === 'CylinderExpr') {
        expect(stmt.args).toHaveLength(2);
      }
    });

    it('parses sphere with 1 arg', () => {
      const stmt = parseFirst('sphere 10');
      expect(stmt.type).toBe('SphereExpr');
      if (stmt.type === 'SphereExpr') {
        expect(stmt.args).toHaveLength(1);
      }
    });

    it('parses 3D primitive (sphere) as pipe op -> Implicit3DPrimitive', () => {
      const { source, ops } = parsePipeline('rect 100 100 | verts | sphere 5');
      expect(source.type).toBe('RectExpr');
      expect(ops[0].type).toBe('VertsSelect');
      expect(ops[1].type).toBe('Implicit3DPrimitive');
      const prim = (ops[1] as any).primitive;
      expect(prim.type).toBe('SphereExpr');
      expect(prim.args).toHaveLength(1);
    });

    it('parses box as pipe op -> Implicit3DPrimitive', () => {
      const { ops } = parsePipeline('circle 50 | verts | box 5 5 5');
      expect(ops[1].type).toBe('Implicit3DPrimitive');
      expect((ops[1] as any).primitive.type).toBe('BoxExpr');
    });

    it('parses cylinder as pipe op -> Implicit3DPrimitive', () => {
      const { ops } = parsePipeline('rect 100 100 | verts | cylinder 3 10');
      expect(ops[1].type).toBe('Implicit3DPrimitive');
      expect((ops[1] as any).primitive.type).toBe('CylinderExpr');
    });

    it('parses cone as pipe op -> Implicit3DPrimitive', () => {
      const { ops } = parsePipeline('rect 50 50 | verts | cone 10 5 2');
      expect(ops[1].type).toBe('Implicit3DPrimitive');
      expect((ops[1] as any).primitive.type).toBe('ConeExpr');
    });

    it('parses torus as pipe op -> Implicit3DPrimitive', () => {
      const { ops } = parsePipeline('rect 50 50 | verts | torus 10 2');
      expect(ops[1].type).toBe('Implicit3DPrimitive');
      expect((ops[1] as any).primitive.type).toBe('TorusExpr');
    });
  });

  // ---------------------------------------------------------------------------
  // Evaluator
  // ---------------------------------------------------------------------------

  describe('evaluator', () => {
    it('throws when trying to create box without OC', () => {
      expect(() => evalExpr('box 10 10 10')).toThrow();
    });

    it('throws when trying to create sphere without OC', () => {
      expect(() => evalExpr('sphere 5')).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // dir: / pnt: named args for cone and cylinder
  // ---------------------------------------------------------------------------

  describe('cone dir:/pnt:', () => {
    it('cone dir:(1,0,0) rotates to X axis', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cone 10 0 20 dir:(1,0,0)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const coneCalls = oc._calls.filter((c: any) => c.method === 'makeCone');
      expect(coneCalls).toHaveLength(1);
      // alignZToDir uses oc.rotate() (gp_Trsf) for correct curved-surface bounding boxes
      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('cone dir:(1,0,1) rotates to diagonal direction', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cone 10 0 20 dir:(1,0,1)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('cone dir:(0,0,-1) rotates 180 degrees', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cone 10 0 20 dir:(0,0,-1)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      // -Z uses oc.rotate(X-axis, π) for a 180° flip
      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls.length).toBeGreaterThanOrEqual(1);
      const lastRotate = rotateCalls[rotateCalls.length - 1];
      const axis = lastRotate.args[1];
      expect(axis.direction.x).toBeCloseTo(1);  // rotation around X axis
      expect(axis.direction.y).toBeCloseTo(0);
      expect(axis.direction.z).toBeCloseTo(0);
      expect(lastRotate.args[2]).toBeCloseTo(Math.PI); // 180°
    });

    it('cone dir:(0,0,1) does not rotate (already Z-aligned)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cone 10 0 20 dir:(0,0,1)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      // Only translate for centering, no rotate for dir
      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls).toHaveLength(0);
    });

    it('cone pnt:(10,0,0) translates to point', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cone 10 0 20 pnt:(10,0,0)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      // At least one translate for centering, and one for pnt
      expect(translateCalls.length).toBeGreaterThanOrEqual(1);
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBe(10);
      expect(lastTranslate.args[2]).toBe(0);
      expect(lastTranslate.args[3]).toBe(0);
    });

    it('cone dir:(1,0,0) pnt:(5,5,0) rotates then translates', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cone 10 0 20 dir:(1,0,0) pnt:(5,5,0)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);

      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls.length).toBeGreaterThanOrEqual(1);

      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls.length).toBeGreaterThanOrEqual(2);

      // Last translate should be the pnt translation
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBe(5);
      expect(lastTranslate.args[2]).toBe(5);
      expect(lastTranslate.args[3]).toBe(0);

      // Verify order: rotate happens before the pnt translate
      const lastRotateIdx = oc._calls.lastIndexOf(
        oc._calls.filter((c: any) => c.method === 'rotate').pop()
      );
      const lastTranslateIdx = oc._calls.lastIndexOf(
        oc._calls.filter((c: any) => c.method === 'translate').pop()
      );
      expect(lastRotateIdx).toBeLessThan(lastTranslateIdx);
    });
  });

  describe('cylinder dir:/pnt:', () => {
    it('cylinder dir:(1,0,0) rotates to X axis', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cylinder 5 10 dir:(1,0,0)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const cylCalls = oc._calls.filter((c: any) => c.method === 'makeCylinder');
      expect(cylCalls).toHaveLength(1);
      // alignZToDir uses oc.rotate() (gp_Trsf) for correct curved-surface bounding boxes
      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('cylinder pnt:(10,20,30) translates to point', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cylinder 5 10 pnt:(10,20,30)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBe(10);
      expect(lastTranslate.args[2]).toBe(20);
      expect(lastTranslate.args[3]).toBe(30);
    });

    it('cylinder dir:(0,1,0) pnt:(0,0,5) rotates and translates', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cylinder 5 10 dir:(0,1,0) pnt:(0,0,5)');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const rotateCalls = oc._calls.filter((c: any) => c.method === 'rotate');
      expect(rotateCalls.length).toBeGreaterThanOrEqual(1);
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBe(0);
      expect(lastTranslate.args[2]).toBe(0);
      expect(lastTranslate.args[3]).toBe(5);
    });
  });
});
