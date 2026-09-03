/**
 * Tests for modifier operations: fillet, chamfer, shell, offset.
 * Covers parser, validator, evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator } from '../src/evaluator.js';
import { selectItems } from '../src/ocp-kernel/selector.js';
import type { Expression, PipeOp, Pipeline, FacesSelect, Shell, EdgesSelect, Fillet, Cut, Statement } from '../src/ast.js';
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

// ---------------------------------------------------------------------------
// Mock OC kernels
// ---------------------------------------------------------------------------

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

// Detailed mock with box topology for integration tests
function createMockOCWithTopology() {
  let handleCounter = 100;
  const nextHandle = (label?: string) => {
    const id = ++handleCounter;
    return { __id: id, __label: label ?? `handle_${id}` } as any;
  };

  const calls: { method: string; args: any[] }[] = [];

  const boxFaces = {
    top:    nextHandle('face_top'),
    bottom: nextHandle('face_bottom'),
    right:  nextHandle('face_right'),
    left:   nextHandle('face_left'),
    front:  nextHandle('face_front'),
    back:   nextHandle('face_back'),
  };

  const boxEdges = {
    vz1: nextHandle('edge_vz1'),
    vz2: nextHandle('edge_vz2'),
    vz3: nextHandle('edge_vz3'),
    vz4: nextHandle('edge_vz4'),
    tx1: nextHandle('edge_tx1'),
    tx2: nextHandle('edge_tx2'),
    ty1: nextHandle('edge_ty1'),
    ty2: nextHandle('edge_ty2'),
    bx1: nextHandle('edge_bx1'),
    bx2: nextHandle('edge_bx2'),
    by1: nextHandle('edge_by1'),
    by2: nextHandle('edge_by2'),
  };

  const faceGeoMap = new Map<any, { center: any; normal: any }>();
  faceGeoMap.set(boxFaces.top,    { center: { x: 0, y: 0, z: 20 },   normal: { x: 0, y: 0, z: 1 } });
  faceGeoMap.set(boxFaces.bottom, { center: { x: 0, y: 0, z: -20 },  normal: { x: 0, y: 0, z: -1 } });
  faceGeoMap.set(boxFaces.right,  { center: { x: 50, y: 0, z: 0 },   normal: { x: 1, y: 0, z: 0 } });
  faceGeoMap.set(boxFaces.left,   { center: { x: -50, y: 0, z: 0 },  normal: { x: -1, y: 0, z: 0 } });
  faceGeoMap.set(boxFaces.front,  { center: { x: 0, y: 30, z: 0 },   normal: { x: 0, y: 1, z: 0 } });
  faceGeoMap.set(boxFaces.back,   { center: { x: 0, y: -30, z: 0 },  normal: { x: 0, y: -1, z: 0 } });

  const edgeGeoMap = new Map<any, { center: any; p1: any; p2: any }>();
  edgeGeoMap.set(boxEdges.vz1, { center: { x: 50, y: 30, z: 0 },   p1: { x: 50, y: 30, z: -20 },  p2: { x: 50, y: 30, z: 20 } });
  edgeGeoMap.set(boxEdges.vz2, { center: { x: -50, y: 30, z: 0 },  p1: { x: -50, y: 30, z: -20 }, p2: { x: -50, y: 30, z: 20 } });
  edgeGeoMap.set(boxEdges.vz3, { center: { x: 50, y: -30, z: 0 },  p1: { x: 50, y: -30, z: -20 }, p2: { x: 50, y: -30, z: 20 } });
  edgeGeoMap.set(boxEdges.vz4, { center: { x: -50, y: -30, z: 0 }, p1: { x: -50, y: -30, z: -20 },p2: { x: -50, y: -30, z: 20 } });
  edgeGeoMap.set(boxEdges.tx1, { center: { x: 0, y: 30, z: 20 },   p1: { x: -50, y: 30, z: 20 },  p2: { x: 50, y: 30, z: 20 } });
  edgeGeoMap.set(boxEdges.tx2, { center: { x: 0, y: -30, z: 20 },  p1: { x: -50, y: -30, z: 20 }, p2: { x: 50, y: -30, z: 20 } });
  edgeGeoMap.set(boxEdges.ty1, { center: { x: 50, y: 0, z: 20 },   p1: { x: 50, y: -30, z: 20 },  p2: { x: 50, y: 30, z: 20 } });
  edgeGeoMap.set(boxEdges.ty2, { center: { x: -50, y: 0, z: 20 },  p1: { x: -50, y: -30, z: 20 }, p2: { x: -50, y: 30, z: 20 } });
  edgeGeoMap.set(boxEdges.bx1, { center: { x: 0, y: 30, z: -20 },  p1: { x: -50, y: 30, z: -20 }, p2: { x: 50, y: 30, z: -20 } });
  edgeGeoMap.set(boxEdges.bx2, { center: { x: 0, y: -30, z: -20 }, p1: { x: -50, y: -30, z: -20 },p2: { x: 50, y: -30, z: -20 } });
  edgeGeoMap.set(boxEdges.by1, { center: { x: 50, y: 0, z: -20 },  p1: { x: 50, y: -30, z: -20 }, p2: { x: 50, y: 30, z: -20 } });
  edgeGeoMap.set(boxEdges.by2, { center: { x: -50, y: 0, z: -20 }, p1: { x: -50, y: -30, z: -20 },p2: { x: -50, y: 30, z: -20 } });

  let currentFaces = Object.values(boxFaces);
  const currentEdges = Object.values(boxEdges);

  const shelledFaces = [boxFaces.bottom, boxFaces.right, boxFaces.left, boxFaces.front, boxFaces.back];

  const mock = {
    _calls: calls,
    _boxFaces: boxFaces,
    _boxEdges: boxEdges,

    makeBox(dx: number, dy: number, dz: number) {
      calls.push({ method: 'makeBox', args: [dx, dy, dz] });
      return nextHandle('box');
    },
    translate(shape: any, dx: number, dy: number, dz: number) {
      calls.push({ method: 'translate', args: [shape, dx, dy, dz] });
      return nextHandle('box_centered');
    },
    shell(shape: any, facesToRemove: any[], thickness: number) {
      calls.push({ method: 'shell', args: [shape, facesToRemove, thickness] });
      currentFaces = shelledFaces;
      return nextHandle('shelled');
    },
    fillet(shape: any, edges: any[], r: number) {
      calls.push({ method: 'fillet', args: [shape, edges, r] });
      currentFaces = shelledFaces;
      return nextHandle('filleted');
    },
    chamfer(shape: any, edges: any[], d: number) {
      calls.push({ method: 'chamfer', args: [shape, edges, d] });
      return nextHandle('chamfered');
    },

    getSubShapes(_shape: any, type: string) {
      if (type === 'face') return [...currentFaces];
      if (type === 'edge') return [...currentEdges];
      return [];
    },

    getCenterOfMass(handle: any) {
      const fg = faceGeoMap.get(handle);
      return fg ? fg.center : { x: 0, y: 0, z: 0 };
    },
    uvBounds(_face: any) {
      return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
    },
    surfaceNormal(handle: any, _u: number, _v: number) {
      const fg = faceGeoMap.get(handle);
      return fg ? fg.normal : { x: 0, y: 0, z: 1 };
    },
    getLinearCenterOfMass(handle: any) {
      const eg = edgeGeoMap.get(handle);
      return eg ? eg.center : { x: 0, y: 0, z: 0 };
    },
    curveParameters(_edge: any) {
      return { first: 0, last: 1 };
    },
    curvePointAtParam(handle: any, param: number) {
      const eg = edgeGeoMap.get(handle);
      if (!eg) return { x: 0, y: 0, z: 0 };
      return param === 0 ? eg.p1 : eg.p2;
    },

    makeCircleEdge(center: any, normal: any, r: number) {
      calls.push({ method: 'makeCircleEdge', args: [center, normal, r] });
      return nextHandle('circle_edge');
    },
    makeLineEdge(start: any, end: any) {
      calls.push({ method: 'makeLineEdge', args: [start, end] });
      return nextHandle('line_edge');
    },
    makeWire(edges: any[]) {
      calls.push({ method: 'makeWire', args: [edges] });
      return nextHandle('wire');
    },
    makeFace(wire: any) {
      calls.push({ method: 'makeFace', args: [wire] });
      return nextHandle('face');
    },
    extrude(shape: any, dx: number, dy: number, dz: number) {
      calls.push({ method: 'extrude', args: [shape, dx, dy, dz] });
      return nextHandle('extruded');
    },
    fuse(a: any, b: any) {
      calls.push({ method: 'fuse', args: [a, b] });
      return nextHandle('fused');
    },
    cut(a: any, b: any) {
      calls.push({ method: 'cut', args: [a, b] });
      return nextHandle('cut_result');
    },
    getBoundingBox(handle: any) {
      const fg = faceGeoMap.get(handle);
      if (fg) {
        const c = fg.center;
        const n = fg.normal;
        const hx = Math.abs(n.x) > 0.5 ? 0 : 50;
        const hy = Math.abs(n.y) > 0.5 ? 0 : 30;
        const hz = Math.abs(n.z) > 0.5 ? 0 : 20;
        return { xmin: c.x - hx, ymin: c.y - hy, zmin: c.z - hz, xmax: c.x + hx, ymax: c.y + hy, zmax: c.z + hz };
      }
      return { xmin: -50, ymin: -30, zmin: -20, xmax: 50, ymax: 30, zmax: 20 };
    },
    getBoundingBoxFast(handle: any) {
      return (this as any).getBoundingBox(handle);
    },
    makeCylinder(r: number, h: number) { calls.push({ method: 'makeCylinder', args: [r, h] }); return nextHandle('cylinder'); },
    makeSphere(_r: number) { return nextHandle('sphere'); },
    rotate(_shape: any, _axis: any, _angle: number) { return nextHandle('rotated'); },
  } as any;

  return mock;
}

// ===========================================================================
// Parser
// ===========================================================================

describe('modifiers', () => {
  describe('parser', () => {
    // From parser.test.ts — pipeline basics
    it('parses simple pipeline with fillet', () => {
      const { source, ops } = parsePipeline('box 80 60 10 | fillet 2');
      expect(source.type).toBe('BoxExpr');
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('Fillet');
    });

    it('parses multi-op pipeline with fillet and shell', () => {
      const { source, ops } = parsePipeline('box 80 60 10 | fillet 2 | shell 1');
      expect(source.type).toBe('BoxExpr');
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('Fillet');
      expect(ops[1].type).toBe('Shell');
    });

    it('parses multiline pipeline', () => {
      const { source, ops } = parsePipeline(`box 80 60 10
 | fillet 2
 | shell 1`);
      expect(source.type).toBe('BoxExpr');
      expect(ops).toHaveLength(2);
    });

    it('parses faces select piped to shell', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | shell 2');
      expect(ops[0].type).toBe('FacesSelect');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
      expect(ops[1].type).toBe('Shell');
      if (ops[1].type === 'Shell') {
        expect(ops[1].args[0]).toMatchObject({ type: 'NumberLit', value: 2 });
      }
    });

    // From shell-fillet-cut.test.ts — full pipeline parse
    it('parses into a Pipeline with correct number of ops', () => {
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      expect(ast.statements.length).toBe(1);
      const pipeline = ast.statements[0] as Pipeline;
      expect(pipeline.type).toBe('Pipeline');
      expect(pipeline.ops.length).toBe(7);
    });

    it('parses faces top piped to shell 2', () => {
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      const pipeline = ast.statements[0] as Pipeline;
      const facesOp = pipeline.ops[0] as FacesSelect;
      expect(facesOp.type).toBe('FacesSelect');
      expect(facesOp.args.length).toBe(1);
      expect(facesOp.args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      const shellOp = pipeline.ops[1] as Shell;
      expect(shellOp.type).toBe('Shell');
      expect(shellOp.args.length).toBe(1);
      expect(shellOp.args[0]).toMatchObject({ type: 'NumberLit', value: 2 });
      expect(shellOp.namedArgs.length).toBe(0);
    });

    it('parses edges =Z selector', () => {
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      const pipeline = ast.statements[0] as Pipeline;
      const edgesOp = pipeline.ops[2] as EdgesSelect;
      expect(edgesOp.type).toBe('EdgesSelect');
      expect(edgesOp.args.length).toBe(1);
      expect(edgesOp.args[0]).toMatchObject({ type: 'SelectorLit', value: '=Z' });
    });

    it('parses fillet 3', () => {
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      const pipeline = ast.statements[0] as Pipeline;
      const filletOp = pipeline.ops[3] as Fillet;
      expect(filletOp.type).toBe('Fillet');
      expect(filletOp.args[0]).toMatchObject({ type: 'NumberLit', value: 3 });
    });

    it('parses cut', () => {
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      const pipeline = ast.statements[0] as Pipeline;
      const cutOp = pipeline.ops[6] as Cut;
      expect(cutOp.type).toBe('Cut');
      expect(cutOp.args.length).toBe(0);
    });

    // Offset parser tests from parser-extra.test.ts
    it('parses offset with positive distance', () => {
      const { ops } = parsePipeline('rect 80 60 | offset 5');
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('Offset');
      if (ops[0].type === 'Offset') {
        expect(ops[0].args[0]).toMatchObject({ type: 'NumberLit', value: 5 });
      }
    });

    it('parses offset with negative distance', () => {
      const { ops } = parsePipeline('box 80 60 10 | faces >Z | offset -10');
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Offset');
      if (ops[1].type === 'Offset') {
        expect(ops[1].args[0]).toMatchObject({ type: 'UnaryNeg' });
      }
    });

    it('parses offset followed by cut', () => {
      const { ops } = parsePipeline('box 80 60 10 | faces >Z | offset -10 | cut 3');
      expect(ops).toHaveLength(3);
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Offset');
      expect(ops[2].type).toBe('Cut');
    });

    // Greedy arg edge cases relevant to modifiers
    it('parses faces select piped to shell as two ops (greedy arg)', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | shell 2');
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Shell');
      if (ops[1].type === 'Shell') {
        expect(ops[1].args).toHaveLength(1);
        expect(ops[1].namedArgs).toHaveLength(0);
      }
    });
  });

  // ===========================================================================
  // Validator
  // ===========================================================================

  describe('validator', () => {
    // Required args
    it('reports missing fillet radius', () => {
      const errors = getErrors('box 10 10 10 | fillet');
      const filletErrors = errors.filter(e => e.nodeType === 'Fillet');
      expect(filletErrors.length).toBeGreaterThan(0);
    });

    it('reports missing chamfer radius', () => {
      const errors = getErrors('box 10 10 10 | chamfer');
      const chamferErrors = errors.filter(e => e.nodeType === 'Chamfer');
      expect(chamferErrors.length).toBeGreaterThan(0);
      expect(chamferErrors[0].message).toContain('chamfer requires a radius');
    });

    it('accepts chamfer with radius', () => {
      const errors = getErrors('box 10 10 10 | chamfer 2');
      const chamferErrors = errors.filter(e => e.nodeType === 'Chamfer');
      expect(chamferErrors).toHaveLength(0);
    });

    it('reports missing shell thickness', () => {
      const errors = getErrors('box 10 10 10 | shell');
      const shellErrors = errors.filter(e => e.nodeType === 'Shell');
      expect(shellErrors.length).toBeGreaterThan(0);
      expect(shellErrors[0].message).toContain('shell requires a thickness');
    });

    it('reports missing offset distance', () => {
      const errors = getErrors('rect 80 60 | offset');
      const offsetErrors = errors.filter(e => e.nodeType === 'Offset');
      expect(offsetErrors.length).toBeGreaterThan(0);
      expect(offsetErrors[0].message).toContain('offset requires a distance');
    });

    // Context transitions
    it('accepts valid 3D -> fillet pipeline', () => {
      const errors = getErrors('box 80 60 10 | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts valid 3D -> faces -> shell', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | shell 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts 3D -> edges -> fillet', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('shell transitions to 3D', () => {
      const errors = getErrors('box 10 10 10 | shell 2 | fillet 1');
      expect(errors).toHaveLength(0);
    });

    it('chamfer on 2D stays 2D', () => {
      const errors = getErrors('rect 10 10 | fillet 1 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('chamfer on 3D stays 3D', () => {
      const errors = getErrors('box 10 10 10 | chamfer 1 | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('rejects shell on edge selection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | shell 2');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in EdgeSelection');
    });

    it('rejects shell on VertexSelection', () => {
      const errors = getErrors('box 10 10 10 | verts >Z | shell 2');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in VertexSelection');
    });

    it('accepts chamfer on EdgeSelection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | chamfer 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts fillet in FaceSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts chamfer in FaceSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | chamfer 2');
      expect(errors).toHaveLength(0);
    });

    // Offset context
    it('accepts offset in 2D context', () => {
      const errors = getErrors('rect 80 60 | offset -10');
      expect(errors).toHaveLength(0);
    });

    it('accepts offset in FaceSelection context', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | offset -10');
      expect(errors).toHaveLength(0);
    });

    it('offset transitions to 2D (extrude after offset is valid)', () => {
      const errors = getErrors('rect 80 60 | offset -10 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('offset from faces transitions to 2D (cut after offset is valid)', () => {
      const errors = getErrors('box 80 60 10 | faces >Z | offset -10 | cut 3');
      expect(errors).toHaveLength(0);
    });

    it('rejects offset in 3D context', () => {
      const errors = getErrors('box 80 60 10 | offset -10');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in 3D');
    });
  });

  // ===========================================================================
  // Evaluator — union + chamfer/fillet combination
  // ===========================================================================

  describe('evaluator', () => {
    it('union followed by chamfer calls fuse then chamfer', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | chamfer 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();

      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const chamferCalls = oc._calls.filter((c: any) => c.method === 'chamfer');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(chamferCalls.length).toBe(1);
      expect(chamferCalls[0].args[2]).toBe(1);
    });

    it('union followed by fillet calls fuse then fillet', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | fillet 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const wp = result as WpState;
      expect(wp.shape).toBeTruthy();

      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(filletCalls.length).toBe(1);
      expect(filletCalls[0].args[2]).toBe(2);
    });

    it('union + face selection + chamfer calls fuse, getSubShapes, chamfer', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | faces >Z | chamfer 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const chamferCalls = oc._calls.filter((c: any) => c.method === 'chamfer');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(chamferCalls.length).toBe(1);
    });

    it('union + face selection + fillet works correctly', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | faces >Z | fillet 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(filletCalls.length).toBe(1);
      expect(filletCalls[0].args[2]).toBe(2);
    });

    it('diff followed by fillet calls cut then fillet', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | diff (cylinder 20 3) | fillet 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      expect(cutCalls.length).toBeGreaterThanOrEqual(1);
      expect(filletCalls.length).toBe(1);
    });

    // Offset evaluator tests from eval-new-features.test.ts
    it('offset in 2D context calls offsetWire2D on existing wires', () => {
      const oc = createMockOC();
      (oc as any).outerWire = (face: any) => { oc._calls.push({ method: 'outerWire', args: [face] }); return 999 as any; };
      (oc as any).offsetWire2D = (wire: any, dist: number) => { oc._calls.push({ method: 'offsetWire2D', args: [wire, dist] }); return 998 as any; };

      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 80 60 | offset -10 | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const offsetCall = oc._calls.find((c: any) => c.method === 'offsetWire2D');
      expect(offsetCall).toBeDefined();
      expect(offsetCall!.args[1]).toBe(-10);
    });

    it('offset from face selection calls outerWire then offsetWire2D', () => {
      const oc = createMockOC();
      (oc as any).outerWire = (face: any) => { oc._calls.push({ method: 'outerWire', args: [face] }); return 999 as any; };
      (oc as any).offsetWire2D = (wire: any, dist: number) => { oc._calls.push({ method: 'offsetWire2D', args: [wire, dist] }); return 998 as any; };

      const evaluator = new Evaluator({ oc });
      const ast = parse('box 80 60 10 | faces >Z | offset -10 | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const outerWireCall = oc._calls.find((c: any) => c.method === 'outerWire');
      expect(outerWireCall).toBeDefined();
      const offsetCall = oc._calls.find((c: any) => c.method === 'offsetWire2D');
      expect(offsetCall).toBeDefined();
      expect(offsetCall!.args[1]).toBe(-10);
    });

    it('offset followed by cut works end-to-end', () => {
      const oc = createMockOC();
      (oc as any).outerWire = (face: any) => { oc._calls.push({ method: 'outerWire', args: [face] }); return 999 as any; };
      (oc as any).offsetWire2D = (wire: any, dist: number) => { oc._calls.push({ method: 'offsetWire2D', args: [wire, dist] }); return 998 as any; };

      const evaluator = new Evaluator({ oc });
      const ast = parse('box 80 60 10 | faces >Z | offset -10 | cut 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const methods = oc._calls.map((c: any) => c.method);
      expect(methods).toContain('outerWire');
      expect(methods).toContain('offsetWire2D');
      expect(methods).toContain('cut');
    });
  });

  // ===========================================================================
  // Integration tests (from shell-fillet-cut-integration.test.ts)
  // ===========================================================================

  describe('integration: full pipeline box | shell | fillet | cut', () => {
    it('executes the full pipeline without errors', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    it('shell is called with top face and thickness 2', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      evaluator.evaluate(ast);

      const shellCall = oc._calls.find((c: any) => c.method === 'shell');
      expect(shellCall).toBeDefined();
      // occt-wasm negates the offset itself since 3.0.0, so the wrapper now
      // passes a positive thickness for an inward hollow.
      expect(shellCall!.args[2]).toBe(2);
      const openFaces = shellCall!.args[1];
      expect(openFaces).toHaveLength(1);
      expect(openFaces[0]).toBe(oc._boxFaces.top);
    });

    it('fillet is called with Z-parallel edges only', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      evaluator.evaluate(ast);

      const filletCall = oc._calls.find((c: any) => c.method === 'fillet');
      expect(filletCall).toBeDefined();
      expect(filletCall!.args[2]).toBe(3);
      const filletEdges = filletCall!.args[1];
      const zEdges = [oc._boxEdges.vz1, oc._boxEdges.vz2, oc._boxEdges.vz3, oc._boxEdges.vz4];
      expect(filletEdges).toHaveLength(4);
      for (const e of filletEdges) {
        expect(zEdges).toContain(e);
      }
    });

    it('circle is created on right face workplane and cut is performed', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      evaluator.evaluate(ast);

      const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
      expect(circleCall).toBeDefined();
      expect(circleCall!.args[0]).toEqual({ x: 50, y: 0, z: 0 });
      expect(circleCall!.args[1]).toEqual({ x: 1, y: 0, z: 0 });
      expect(circleCall!.args[2]).toBe(4);

      const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
      expect(cutCalls.length).toBeGreaterThan(0);

      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      const cutExtrudes = extrudeCalls.filter((c: any) => {
        return Math.abs(c.args[1]) > 1 && Math.abs(c.args[2]) < 0.001 && Math.abs(c.args[3]) < 0.001;
      });
      expect(cutExtrudes.length).toBe(2);
    });

    it('pipeline produces a final shape (not null)', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = `box 100 60 40
 | faces top | shell 2
 | edges =Z | fillet 3
 | faces right | circle 4 | cut`;
      const ast = parse(source);
      const result = evaluator.evaluate(ast) as WpState;
      expect(result.shape).not.toBeNull();
    });
  });

  // ===========================================================================
  // FaceSelection hole integration tests
  // ===========================================================================

  describe('integration: FaceSelection hole', () => {
    it('executes face-hole pipeline without errors', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = 'box 100 60 40 | faces >Z | hole 5';
      const ast = parse(source);
      const result = evaluator.evaluate(ast);
      expect(isWpState(result)).toBe(true);
    });

    it('creates a cylinder at the face center and cuts (through-all)', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = 'box 100 60 40 | faces >Z | hole 5';
      const ast = parse(source);
      evaluator.evaluate(ast);

      // Through-all hole uses makeCylinder instead of circle extrusion
      const cylCall = oc._calls.find((c: any) => c.method === 'makeCylinder');
      expect(cylCall).toBeDefined();
      expect(cylCall!.args[0]).toBe(5); // radius

      const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
      expect(cutCalls.length).toBeGreaterThan(0);
    });

    it('clears selectedFaces after hole operation', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = 'box 100 60 40 | faces >Z | hole 5';
      const ast = parse(source);
      const result = evaluator.evaluate(ast) as WpState;
      expect(result.selectedFaces).toHaveLength(0);
    });

    it('produces a final shape (not null)', () => {
      const oc = createMockOCWithTopology();
      const evaluator = new Evaluator({ oc });
      const source = 'box 100 60 40 | faces >Z | hole 5';
      const ast = parse(source);
      const result = evaluator.evaluate(ast) as WpState;
      expect(result.shape).not.toBeNull();
    });
  });

  // ===========================================================================
  // Perpendicular selector integration
  // ===========================================================================

  describe('integration: perpendicular selector', () => {
    it('selectItems handles # operator -- selects faces perpendicular to axis', () => {
      const faces = [
        { id: 'f1' },
        { id: 'f2' },
        { id: 'f3' },
      ];
      const centerFn = () => ({ x: 0, y: 0, z: 0 });
      const dirFn = (item: any) => {
        switch (item.id) {
          case 'f1': return { x: 0, y: 0, z: 1 };
          case 'f2': return { x: 1, y: 0, z: 0 };
          case 'f3': return { x: 0, y: 0, z: -1 };
          default: return null;
        }
      };

      const result = selectItems(null as any, faces, '#Z', centerFn, dirFn);
      expect(result).toHaveLength(2);
      expect(result.map((f: any) => f.id)).toEqual(['f1', 'f3']);
    });

    it('selectItems handles #X -- selects faces perpendicular to X axis', () => {
      const faces = [
        { id: 'f1' },
        { id: 'f2' },
        { id: 'f3' },
      ];
      const centerFn = () => ({ x: 0, y: 0, z: 0 });
      const dirFn = (item: any) => {
        switch (item.id) {
          case 'f1': return { x: 0, y: 0, z: 1 };
          case 'f2': return { x: 1, y: 0, z: 0 };
          case 'f3': return { x: -1, y: 0, z: 0 };
          default: return null;
        }
      };

      const result = selectItems(null as any, faces, '#X', centerFn, dirFn);
      expect(result).toHaveLength(2);
      expect(result.map((f: any) => f.id)).toEqual(['f2', 'f3']);
    });
  });
});
