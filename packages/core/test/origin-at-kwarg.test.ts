/**
 * Tests for origin: kwarg on moveto/move/hole and primitives, and at: on hole.
 * Equivalent to Python's test_origin_at_kwarg.py.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
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
    mirror(shape: any, origin: any, normal: any) { calls.push({ method: 'mirror', args: [shape, origin, normal] }); return nextHandle(); },
    makeCompound(shapes: any[]) { calls.push({ method: 'makeCompound', args: [shapes] }); return nextHandle(); },
    getBoundingBox(_shape: any) { return { xmin: -10, ymin: -10, zmin: 0, xmax: 10, ymax: 10, zmax: 10 }; },
    getBoundingBoxFast(_shape: any) { return { xmin: -10, ymin: -10, zmin: 0, xmax: 10, ymax: 10, zmax: 10 }; },
    getSubShapes(_shape: any, type: string) {
      if (type === 'edge') return [nextHandle(), nextHandle(), nextHandle()];
      if (type === 'face') return [nextHandle()];
      return [];
    },
    getCenterOfMass(_face: any) { return { x: 0, y: 0, z: 10 }; },
    uvBounds(_face: any) { return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }; },
    surfaceNormal(_face: any, _u: number, _v: number) { return { x: 0, y: 0, z: 1 }; },
    makeHelixWire(origin: any, axis: any, pitch: number, height: number, radius: number) {
      calls.push({ method: 'makeHelixWire', args: [origin, axis, pitch, height, radius] });
      return nextHandle();
    },
  } as any;
  return mock;
}

// ===================================================================
// moveto with origin: — Parsing
// ===================================================================

describe('moveto origin: parsing', () => {
  it('parses moveto origin:"world"', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | moveto 0 0 origin:"world"');
    const moveto = ops[1]; // [0]=FacesSelect, [1]=MoveTo
    expect(moveto.type).toBe('MoveTo');
    if (moveto.type === 'MoveTo') {
      expect(moveto.namedArgs).toHaveLength(1);
      expect(moveto.namedArgs[0].key).toBe('origin');
      expect(moveto.namedArgs[0].value).toMatchObject({ type: 'StringLit', value: 'world' });
    }
  });

  it('parses moveto origin:(10, 20, 0)', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | moveto 0 0 origin:(10, 20, 0)');
    const moveto = ops[1];
    expect(moveto.type).toBe('MoveTo');
    if (moveto.type === 'MoveTo') {
      expect(moveto.namedArgs).toHaveLength(1);
      expect(moveto.namedArgs[0].key).toBe('origin');
      expect(moveto.namedArgs[0].value.type).toBe('TupleLit');
    }
  });

  it('parses moveto without origin', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | moveto 5 5');
    const moveto = ops[1];
    expect(moveto.type).toBe('MoveTo');
    if (moveto.type === 'MoveTo') {
      expect(moveto.namedArgs).toHaveLength(0);
    }
  });
});

// ===================================================================
// moveto with origin: — Evaluator
// ===================================================================

describe('moveto origin: evaluator', () => {
  it('moveto default (no origin) sets centerX/centerY', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | moveto 5 5 | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // The circle should be at (5, 5)
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    expect(circleCall!.args[0].x).toBeCloseTo(5);
    expect(circleCall!.args[0].y).toBeCloseTo(5);
  });

  it('moveto origin:"world" shifts workplane origin', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | moveto 10 20 origin:"world" | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // With origin:"world", the workplane origin should be projected to world (10,20,0)
    // Then moveTo(0,0) is applied, so circle is at that projected point
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    // The center should be at the world-projected coordinates
    expect(circleCall!.args[0].x).toBeCloseTo(10);
    expect(circleCall!.args[0].y).toBeCloseTo(20);
  });

  it('moveto origin:(10, 20, 0) shifts workplane origin and applies offset', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | moveto 5 5 origin:(10, 20, 0) | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    // origin is shifted to (10,20,0), then moveTo(5,5) adds WP-local offset
    expect(circleCall!.args[0].x).toBeCloseTo(15);
    expect(circleCall!.args[0].y).toBeCloseTo(25);
  });
});

// ===================================================================
// move with origin: — Parsing
// ===================================================================

describe('move origin: parsing', () => {
  it('parses move origin:"world"', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | move 5 5 origin:"world"');
    const move = ops[1];
    expect(move.type).toBe('Move');
    if (move.type === 'Move') {
      expect(move.namedArgs).toHaveLength(1);
      expect(move.namedArgs[0].key).toBe('origin');
      expect(move.namedArgs[0].value).toMatchObject({ type: 'StringLit', value: 'world' });
    }
  });

  it('parses move without origin', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | move 5 5');
    const move = ops[1];
    expect(move.type).toBe('Move');
    if (move.type === 'Move') {
      expect(move.namedArgs).toHaveLength(0);
    }
  });
});

// ===================================================================
// move with origin: — Evaluator
// ===================================================================

describe('move origin: evaluator', () => {
  it('move default (no origin) shifts center relatively', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | move 5 5 | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall!.args[0].x).toBeCloseTo(5);
    expect(circleCall!.args[0].y).toBeCloseTo(5);
  });

  it('move origin:"world" sets world origin and moves relative', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | move 5 5 origin:"world" | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    // origin:"world" resets origin to (0,0,0), then relative move by (5,5)
    expect(circleCall!.args[0].x).toBeCloseTo(5);
    expect(circleCall!.args[0].y).toBeCloseTo(5);
  });

  it('move origin:(10, 20, 0) shifts origin and moves relative', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | move 5 5 origin:(10, 20, 0) | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    // origin is shifted to (10,20,0), then relative move by (5,5)
    expect(circleCall!.args[0].x).toBeCloseTo(15);
    expect(circleCall!.args[0].y).toBeCloseTo(25);
  });
});

// ===================================================================
// Implicit workplane insertion regression
// ===================================================================

describe('implicit workplane insertion', () => {
  it('faces >Z | moveto inserts implicit workplane', () => {
    const oc = createMockOC();
    // Set up face selection: after box, faces >Z selects the top face
    let faceHandle = 0;
    (oc as any).getSubShapes = (_shape: any, type: string) => {
      if (type === 'face') return [++faceHandle as any];
      if (type === 'edge') return [++faceHandle as any, ++faceHandle as any];
      return [];
    };
    (oc as any).getCenterOfMass = (_face: any) => ({ x: 0, y: 0, z: 10 });
    (oc as any).surfaceNormal = (_face: any, _u: number, _v: number) => ({ x: 0, y: 0, z: 1 });

    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | moveto 0 0 | circle 3 | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // The circle should be placed on the face (workplane was inserted)
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });

  it('faces >Z | move inserts implicit workplane', () => {
    const oc = createMockOC();
    let faceHandle = 0;
    (oc as any).getSubShapes = (_shape: any, type: string) => {
      if (type === 'face') return [++faceHandle as any];
      if (type === 'edge') return [++faceHandle as any, ++faceHandle as any];
      return [];
    };
    (oc as any).getCenterOfMass = (_face: any) => ({ x: 0, y: 0, z: 10 });
    (oc as any).surfaceNormal = (_face: any, _u: number, _v: number) => ({ x: 0, y: 0, z: 1 });

    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | move 5 5 | circle 3 | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });
});

// ===================================================================
// hole with at: — Parsing
// ===================================================================

describe('hole at: parsing', () => {
  it('parses hole at: 5 5 (2D)', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | hole 3 at: 5 5');
    const hole = ops[1];
    expect(hole.type).toBe('Hole');
    if (hole.type === 'Hole') {
      expect(hole.namedArgs.length).toBeGreaterThanOrEqual(1);
      const atArg = hole.namedArgs.find(na => na.key === 'at');
      expect(atArg).toBeDefined();
      expect(atArg!.value.type).toBe('TupleLit');
    }
  });

  it('parses hole at: 5 5 0 (3D)', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | hole 3 at: 5 5 0');
    const hole = ops[1];
    expect(hole.type).toBe('Hole');
    if (hole.type === 'Hole') {
      const atArg = hole.namedArgs.find(na => na.key === 'at');
      expect(atArg).toBeDefined();
      expect(atArg!.value.type).toBe('TupleLit');
      if (atArg!.value.type === 'TupleLit') {
        expect(atArg!.value.elements).toHaveLength(3);
      }
    }
  });

  it('parses hole at: 0 0 origin:"world"', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | hole 3 at: 0 0 origin:"world"');
    const hole = ops[1];
    expect(hole.type).toBe('Hole');
    if (hole.type === 'Hole') {
      const atArg = hole.namedArgs.find(na => na.key === 'at');
      const originArg = hole.namedArgs.find(na => na.key === 'origin');
      expect(atArg).toBeDefined();
      expect(originArg).toBeDefined();
      expect(originArg!.value).toMatchObject({ type: 'StringLit', value: 'world' });
    }
  });

  it('parses hole without at (no at, no origin)', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | hole 3');
    const hole = ops[1];
    expect(hole.type).toBe('Hole');
    if (hole.type === 'Hole') {
      const atArg = hole.namedArgs.find(na => na.key === 'at');
      const originArg = hole.namedArgs.find(na => na.key === 'origin');
      expect(atArg).toBeUndefined();
      expect(originArg).toBeUndefined();
    }
  });
});

// ===================================================================
// hole with at: — Evaluator
// ===================================================================

describe('hole at: evaluator', () => {
  function createFaceSelectOC() {
    const oc = createMockOC();
    let faceHandle = 500;
    (oc as any).getSubShapes = (_shape: any, type: string) => {
      if (type === 'face') return [++faceHandle as any];
      if (type === 'edge') return [++faceHandle as any, ++faceHandle as any, ++faceHandle as any];
      return [];
    };
    (oc as any).getCenterOfMass = (_face: any) => ({ x: 0, y: 0, z: 10 });
    (oc as any).surfaceNormal = (_face: any, _u: number, _v: number) => ({ x: 0, y: 0, z: 1 });
    return oc;
  }

  it('hole face center default (no at) uses wpFaceHole', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // Should use cylinder-based face hole (cut through face center)
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
    const cylCalls = oc._calls.filter((c: any) => c.method === 'makeCylinder');
    expect(cylCalls.length).toBeGreaterThan(0);
  });

  it('hole at: 5 5 positions hole at WP-relative coords', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3 at: 5 5');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // Should cut a hole, at offset (5,5) from face center
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
  });

  it('hole at: 5 5 0 positions hole at world coords', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3 at: 5 5 0');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
  });

  it('hole at: 0 0 origin:"world" positions hole at world origin', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3 at: 0 0 origin:"world"');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
  });

  it('hole at: 5 5 origin:(10, 20, 0) positions hole with origin shift', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3 at: 5 5 origin:(10, 20, 0)');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
  });

  it('hole at: with depth passes depth', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3 at: 5 5 depth:5');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
  });

  it('hole at: in workplane context (not face selection)', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | workplane | hole 3 at: 5 5');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
    expect(cutCalls.length).toBeGreaterThan(0);
  });
});

// ===================================================================
// 2D primitives with origin: (pipe context) — Parsing
// ===================================================================

describe('2D primitive origin: parsing', () => {
  it('parses circle at: 10 20 origin:"world"', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | circle 5 at: 10 20 origin:"world"');
    // circle in pipe -> Implicit2DPrimitive
    const op = ops[1];
    expect(op.type).toBe('Implicit2DPrimitive');
    if (op.type === 'Implicit2DPrimitive') {
      const prim = op.primitive;
      expect(prim.type).toBe('CircleExpr');
      if (prim.type === 'CircleExpr') {
        const atArg = prim.namedArgs.find((na: any) => na.key === 'at');
        const originArg = prim.namedArgs.find((na: any) => na.key === 'origin');
        expect(atArg).toBeDefined();
        expect(originArg).toBeDefined();
        expect(originArg!.value).toMatchObject({ type: 'StringLit', value: 'world' });
      }
    }
  });

  it('parses rect at: 10 20 origin:"world"', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | rect 5 5 at: 10 20 origin:"world"');
    const op = ops[1];
    expect(op.type).toBe('Implicit2DPrimitive');
    if (op.type === 'Implicit2DPrimitive') {
      const prim = op.primitive;
      expect(prim.type).toBe('RectExpr');
      if (prim.type === 'RectExpr') {
        const originArg = prim.namedArgs.find((na: any) => na.key === 'origin');
        expect(originArg).toBeDefined();
      }
    }
  });

  it('parses polygon at: 10 20 origin:"world"', () => {
    const { ops } = parsePipeline('box 20 20 10 | faces >Z | polygon 6 5 at: 10 20 origin:"world"');
    const op = ops[1];
    expect(op.type).toBe('Implicit2DPrimitive');
    if (op.type === 'Implicit2DPrimitive') {
      const prim = op.primitive;
      expect(prim.type).toBe('PolygonExpr');
      if (prim.type === 'PolygonExpr') {
        const originArg = prim.namedArgs.find((na: any) => na.key === 'origin');
        expect(originArg).toBeDefined();
      }
    }
  });
});

// ===================================================================
// 2D primitives with origin: — Evaluator
// ===================================================================

describe('2D primitive origin: evaluator', () => {
  function createFaceSelectOC() {
    const oc = createMockOC();
    let faceHandle = 500;
    (oc as any).getSubShapes = (_shape: any, type: string) => {
      if (type === 'face') return [++faceHandle as any];
      if (type === 'edge') return [++faceHandle as any, ++faceHandle as any, ++faceHandle as any];
      return [];
    };
    (oc as any).getCenterOfMass = (_face: any) => ({ x: 0, y: 0, z: 10 });
    (oc as any).surfaceNormal = (_face: any, _u: number, _v: number) => ({ x: 0, y: 0, z: 1 });
    return oc;
  }

  it('circle at: 10 20 default (WP-relative)', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | circle 5 at: 10 20 | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // The circle should be translated on the workplane
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });

  it('circle at: 10 20 origin:"world" shifts workplane origin', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | circle 5 at: 10 20 origin:"world" | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });

  it('circle at: 10 20 5 (3-component world coords)', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | circle 5 at: 10 20 5 | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });

  it('circle at: 5 5 origin:(10, 20, 0) shifts reference point', () => {
    const oc = createFaceSelectOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | circle 5 at: 5 5 origin:(10, 20, 0) | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });
});

// ===================================================================
// 3D primitives with origin: (source context)
// ===================================================================

describe('3D primitive origin: source context', () => {
  it('box at: 5 5 origin:(10, 20, 0) translates with combined offset', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 10 10 10 at: 5 5 origin:(10, 20, 0)');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // Box should be translated by the combined at + origin offset
    const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
    expect(translateCalls.length).toBeGreaterThan(0);
  });

  it('sphere at: 10 20 origin:"world"', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('sphere 5 at: 10 20 origin:"world"');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
    expect(translateCalls.length).toBeGreaterThan(0);
  });
});

// ===================================================================
// Backward compatibility
// ===================================================================

describe('origin: backward compatibility', () => {
  it('moveto without origin unchanged', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | moveto 5 5 | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    expect(circleCall!.args[0].x).toBeCloseTo(5);
    expect(circleCall!.args[0].y).toBeCloseTo(5);
  });

  it('move without origin unchanged', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('rect 10 10 | move 5 5 | circle 3 | extrude 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
    expect(circleCall!.args[0].x).toBeCloseTo(5);
    expect(circleCall!.args[0].y).toBeCloseTo(5);
  });

  it('hole without at unchanged (face center)', () => {
    const oc = createMockOC();
    let faceHandle = 500;
    (oc as any).getSubShapes = (_shape: any, type: string) => {
      if (type === 'face') return [++faceHandle as any];
      if (type === 'edge') return [++faceHandle as any, ++faceHandle as any, ++faceHandle as any];
      return [];
    };
    (oc as any).getCenterOfMass = (_face: any) => ({ x: 0, y: 0, z: 10 });
    (oc as any).surfaceNormal = (_face: any, _u: number, _v: number) => ({ x: 0, y: 0, z: 1 });

    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | hole 3');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    // Should use face hole (cylinder at face center)
    const cylCalls = oc._calls.filter((c: any) => c.method === 'makeCylinder');
    expect(cylCalls.length).toBeGreaterThan(0);
  });

  it('circle at: 10 20 default WP-relative unchanged', () => {
    const oc = createMockOC();
    let faceHandle = 500;
    (oc as any).getSubShapes = (_shape: any, type: string) => {
      if (type === 'face') return [++faceHandle as any];
      if (type === 'edge') return [++faceHandle as any, ++faceHandle as any, ++faceHandle as any];
      return [];
    };
    (oc as any).getCenterOfMass = (_face: any) => ({ x: 0, y: 0, z: 10 });
    (oc as any).surfaceNormal = (_face: any, _u: number, _v: number) => ({ x: 0, y: 0, z: 1 });

    const evaluator = new Evaluator({ oc });
    const ast = parse('box 20 20 10 | faces >Z | circle 5 at: 10 20 | cut');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const circleCall = oc._calls.find((c: any) => c.method === 'makeCircleEdge');
    expect(circleCall).toBeDefined();
  });

  it('box at: 5 5 unchanged (2D)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 10 10 10 at: 5 5');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
    expect(translateCalls.length).toBeGreaterThan(0);
    // Should translate by (5, 5, 0)
    const lastTranslate = translateCalls[translateCalls.length - 1];
    expect(lastTranslate.args[1]).toBeCloseTo(5);
    expect(lastTranslate.args[2]).toBeCloseTo(5);
    expect(lastTranslate.args[3]).toBeCloseTo(0);
  });

  it('box at: 5 5 5 unchanged (3D)', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 10 10 10 at: 5 5 5');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
    expect(translateCalls.length).toBeGreaterThan(0);
    const lastTranslate = translateCalls[translateCalls.length - 1];
    expect(lastTranslate.args[1]).toBeCloseTo(5);
    expect(lastTranslate.args[2]).toBeCloseTo(5);
    expect(lastTranslate.args[3]).toBeCloseTo(5);
  });
});
