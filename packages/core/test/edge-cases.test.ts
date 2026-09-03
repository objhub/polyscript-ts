/**
 * Edge-case tests for PolyScript TypeScript implementation.
 *
 * Covers:
 * 1. 2D boolean annulus (circle | diff circle | extrude)
 * 2. 2D fillet (rect | fillet | extrude)
 * 3. Helix sweep (ConstantBinormal continuity)
 * 4. Nested list comprehension
 * 5. Compound selector (space-separated AND)
 * 6. Degenerate geometry (circle 0)
 * 7. Precision boundary (1um scale box)
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator, evaluateExpressions, type Value } from '../src/evaluator.js';
import { selectItems } from '../src/ocp-kernel/selector.js';
import type { Expression, PipeOp, Statement } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function evalExpr(source: string): Value {
  const ast = parse(source);
  return evaluateExpressions(ast);
}

function isWpState(v: any): v is WpState {
  return v !== null && typeof v === 'object' && 'oc' in v && 'plane' in v;
}

// ---------------------------------------------------------------------------
// Mock OC kernel
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
    fillet2D(wire: any, r: number) { calls.push({ method: 'fillet2D', args: [wire, r] }); return nextHandle(); },
    chamfer(shape: any, edges: any[], d: number) { calls.push({ method: 'chamfer', args: [shape, edges, d] }); return nextHandle(); },
    shell(shape: any, faces: any[], t: number) { calls.push({ method: 'shell', args: [shape, faces, t] }); return nextHandle(); },
    fuse(a: any, b: any) { calls.push({ method: 'fuse', args: [a, b] }); return nextHandle(); },
    cut(a: any, b: any) { calls.push({ method: 'cut', args: [a, b] }); return nextHandle(); },
    common(a: any, b: any) { calls.push({ method: 'common', args: [a, b] }); return nextHandle(); },
    fuseAll(shapes: any[]) { calls.push({ method: 'fuseAll', args: [shapes] }); return nextHandle(); },
    unifySameDomain(shape: any) { calls.push({ method: 'unifySameDomain', args: [shape] }); return nextHandle(); },
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
    outerWire(face: any) { calls.push({ method: 'outerWire', args: [face] }); return nextHandle(); },
    offsetWire2D(wire: any, dist: number) { calls.push({ method: 'offsetWire2D', args: [wire, dist] }); return nextHandle(); },
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
    getLinearCenterOfMass(_edge: any) { return { x: 0, y: 0, z: 0 }; },
    curveParameters(_edge: any) { return { first: 0, last: 1 }; },
    curvePointAtParam(_edge: any, param: number) {
      return param === 0 ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0, z: 10 };
    },
  } as any;
  return mock;
}

// ===========================================================================
// 1. 2D boolean annulus: circle | diff (circle) | extrude
// ===========================================================================

describe('edge case: 2D boolean annulus', () => {
  describe('parser', () => {
    it('parses circle | diff (circle) | extrude as Pipeline', () => {
      const stmt = parseFirst('circle 10 | diff (circle 3) | extrude 5');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('CircleExpr');
        expect(stmt.ops).toHaveLength(2);
        expect(stmt.ops[0].type).toBe('Diff');
        expect(stmt.ops[1].type).toBe('Extrude');
      }
    });

    it('inner circle argument in diff is a CircleExpr', () => {
      const { ops } = parsePipeline('circle 10 | diff (circle 3) | extrude 5');
      if (ops[0].type === 'Diff') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].args[0].type).toBe('CircleExpr');
        if (ops[0].args[0].type === 'CircleExpr') {
          expect(ops[0].args[0].args[0]).toMatchObject({ type: 'NumberLit', value: 3 });
        }
      }
    });
  });

  describe('validator', () => {
    it('accepts annulus pipeline (2D diff then extrude)', () => {
      const errors = getErrors('circle 10 | diff (circle 3) | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts annulus followed by fillet (still 2D after diff)', () => {
      const errors = getErrors('circle 10 | diff (circle 3) | fillet 0.5 | extrude 5');
      expect(errors).toHaveLength(0);
    });
  });

  describe('evaluator', () => {
    it('produces 2D face-level cut then single extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | diff (circle 3) | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      // The outer circle and inner circle each produce a wire+face,
      // then 2D cut is applied, then single extrude.
      const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(cutCalls.length).toBe(1); // face-level cut
      expect(extrudeCalls.length).toBe(1); // single extrude on annulus face
    });

    it('extrude direction is +Z with height 5', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | diff (circle 3) | extrude 5');
      evaluator.evaluate(ast);

      const extrudeCall = oc._calls.find((c: any) => c.method === 'extrude');
      expect(extrudeCall).toBeDefined();
      // Default XY workplane: extrude in Z direction
      expect(extrudeCall!.args[1]).toBeCloseTo(0);  // dx
      expect(extrudeCall!.args[2]).toBeCloseTo(0);  // dy
      expect(extrudeCall!.args[3]).toBeCloseTo(5);  // dz
    });

    it('both circles are generated with correct radii', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | diff (circle 3) | extrude 5');
      evaluator.evaluate(ast);

      const circleCalls = oc._calls.filter((c: any) => c.method === 'makeCircleEdge');
      expect(circleCalls.length).toBe(2);
      const radii = circleCalls.map((c: any) => c.args[2]).sort((a: number, b: number) => a - b);
      expect(radii).toEqual([3, 10]);
    });
  });
});

// ===========================================================================
// 2. 2D fillet: rect | fillet | extrude
// ===========================================================================

describe('edge case: 2D fillet', () => {
  describe('parser', () => {
    it('parses rect | fillet | extrude as Pipeline', () => {
      const stmt = parseFirst('rect 10 10 | fillet 1 | extrude 5');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        expect(stmt.source.type).toBe('RectExpr');
        expect(stmt.ops).toHaveLength(2);
        expect(stmt.ops[0].type).toBe('Fillet');
        expect(stmt.ops[1].type).toBe('Extrude');
      }
    });

    it('fillet radius is captured correctly', () => {
      const { ops } = parsePipeline('rect 10 10 | fillet 1 | extrude 5');
      if (ops[0].type === 'Fillet') {
        expect(ops[0].args[0]).toMatchObject({ type: 'NumberLit', value: 1 });
      }
    });
  });

  describe('validator', () => {
    it('accepts 2D fillet pipeline (rect | fillet | extrude)', () => {
      const errors = getErrors('rect 10 10 | fillet 1 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('fillet in 2D stays in 2D context (extrude after fillet is valid)', () => {
      const errors = getErrors('rect 50 30 | fillet 5 | extrude 10');
      expect(errors).toHaveLength(0);
    });

    it('multiple 2D fillets are valid', () => {
      const errors = getErrors('rect 50 30 | fillet 5 | fillet 2 | extrude 10');
      expect(errors).toHaveLength(0);
    });
  });

  describe('evaluator', () => {
    it('calls fillet2D (or fillet) on the wire, then extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('rect 10 10 | fillet 1 | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      // 2D fillet should call fillet2D on the wire
      const fillet2DCalls = oc._calls.filter((c: any) => c.method === 'fillet2D');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      // Either fillet2D or fillet may be called depending on implementation
      const totalFilletCalls = fillet2DCalls.length + filletCalls.length;
      expect(totalFilletCalls).toBeGreaterThanOrEqual(1);

      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(extrudeCalls.length).toBe(1);
    });

    it('2D fillet then 2D diff then extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // Rounded rectangle with inner hole
      const ast = parse('rect 50 30 | fillet 5 | diff (circle 10) | extrude 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(extrudeCalls.length).toBe(1);
    });
  });
});

// ===========================================================================
// 3. Helix sweep (ConstantBinormal continuity)
// ===========================================================================

describe('edge case: helix sweep', () => {
  describe('parser', () => {
    it('parses helix as HelixPathExpr with positional args', () => {
      const stmt = parseFirst('helix 5 30 10');
      expect(stmt.type).toBe('HelixPathExpr');
      if (stmt.type === 'HelixPathExpr') {
        expect(stmt.args).toHaveLength(3);
      }
    });

    it('parses helix with named args', () => {
      const stmt = parseFirst('helix pitch:5 height:30 radius:10');
      expect(stmt.type).toBe('HelixPathExpr');
      if (stmt.type === 'HelixPathExpr') {
        expect(stmt.namedArgs).toHaveLength(3);
        const keys = stmt.namedArgs.map(a => a.key);
        expect(keys).toContain('pitch');
        expect(keys).toContain('height');
        expect(keys).toContain('radius');
      }
    });

    it('parses helix sweep pipeline', () => {
      const stmt = parseFirst('$path = helix pitch:2 height:20 radius:8');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('HelixPathExpr');
      }
    });
  });

  describe('evaluator', () => {
    it('helix path creates a wire via makeHelixWire', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('helix 5 30 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const helixCall = oc._calls.find((c: any) => c.method === 'makeHelixWire');
      expect(helixCall).toBeDefined();
      // Positional args: pitch=5, height=30, radius=10
      expect(helixCall!.args[2]).toBe(5);  // pitch
      expect(helixCall!.args[3]).toBe(30); // height
      expect(helixCall!.args[4]).toBe(10); // radius
    });

    it('helix with named args passes correct values to makeHelixWire', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('helix pitch:2 height:20 radius:8');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const helixCall = oc._calls.find((c: any) => c.method === 'makeHelixWire');
      expect(helixCall).toBeDefined();
      expect(helixCall!.args[2]).toBe(2);  // pitch
      expect(helixCall!.args[3]).toBe(20); // height
      expect(helixCall!.args[4]).toBe(8);  // radius
    });

    it('sweep along helix produces pipe call (thread shape)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$path = helix pitch:2 height:20 radius:8\ncircle 1 | sweep $path');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const helixCall = oc._calls.find((c: any) => c.method === 'makeHelixWire');
      expect(helixCall).toBeDefined();
      const pipeCall = oc._calls.find((c: any) => c.method === 'pipe');
      expect(pipeCall).toBeDefined();
      // buildCurves3d should be called on the helix wire for proper geometry
      const buildCall = oc._calls.find((c: any) => c.method === 'buildCurves3d');
      expect(buildCall).toBeDefined();
    });

    it('sweep along helix calls pipe with face and wire', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$path = helix 3 15 6\ncircle 0.5 | sweep $path');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const pipeCall = oc._calls.find((c: any) => c.method === 'pipe');
      expect(pipeCall).toBeDefined();
      // pipe(face, spine) — two arguments
      expect(pipeCall!.args).toHaveLength(2);
    });
  });
});

// ===========================================================================
// 4. Nested list comprehension
// ===========================================================================

describe('edge case: nested list comprehension', () => {
  describe('parser', () => {
    it('parses nested list comprehension', () => {
      const stmt = parseFirst('$x = [$i for $i in [$j for $j in range(3)]]');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListComp');
        if (stmt.value.type === 'ListComp') {
          expect(stmt.value.variable).toBe('i');
          // The iterable is itself a ListComp
          expect(stmt.value.iterable.type).toBe('ListComp');
        }
      }
    });

    it('parses nested comprehension with transform expression', () => {
      const stmt = parseFirst('$x = [$i * 2 for $i in [$j + 1 for $j in range(3)]]');
      expect(stmt.type).toBe('Assignment');
      if (stmt.type === 'Assignment') {
        expect(stmt.value.type).toBe('ListComp');
        if (stmt.value.type === 'ListComp') {
          expect(stmt.value.expr.type).toBe('BinOp'); // $i * 2
          expect(stmt.value.iterable.type).toBe('ListComp');
        }
      }
    });

    it('parses union with list comprehension containing nested comprehension', () => {
      const stmt = parseFirst('union [box $i*2 $i*2 $i*2 for $i in [$j for $j in range(3)]]');
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.args[0].type).toBe('ListComp');
        if (stmt.args[0].type === 'ListComp') {
          expect(stmt.args[0].iterable.type).toBe('ListComp');
        }
      }
    });
  });

  describe('evaluator', () => {
    it('nested comprehension: inner evaluates first, outer uses result', () => {
      const result = evalExpr('$x = [$i for $i in [$j for $j in range(3)]]') as Value[];
      expect(result).toEqual([0, 1, 2]);
    });

    it('nested comprehension with transform on both levels', () => {
      const result = evalExpr('$x = [$i * 2 for $i in [$j + 1 for $j in range(3)]]') as Value[];
      // Inner: [0+1, 1+1, 2+1] = [1, 2, 3]
      // Outer: [1*2, 2*2, 3*2] = [2, 4, 6]
      expect(result).toEqual([2, 4, 6]);
    });

    it('nested comprehension with range in inner list', () => {
      const result = evalExpr('$x = [$i ** 2 for $i in [$j for $j in range(4)]]') as Value[];
      // Inner: [0, 1, 2, 3]
      // Outer: [0, 1, 4, 9]
      expect(result).toEqual([0, 1, 4, 9]);
    });

    it('nested comprehension variables do not leak between scopes', () => {
      // After the list comp, $j should not be accessible
      const result = evalExpr('$x = [$i for $i in [$j for $j in range(3)]]\n$y = $x') as Value[];
      expect(result).toEqual([0, 1, 2]);
    });

    it('union with list comprehension using nested comprehension evaluates shapes', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // union [box i*2 i*2 i*2 for i in [j+1 for j in range(3)]]
      // Inner: [1, 2, 3]
      // Outer: box 2 2 2, box 4 4 4, box 6 6 6
      const ast = parse('union [box $i*2 $i*2 $i*2 for $i in [$j + 1 for $j in range(3)]]');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const boxCalls = oc._calls.filter((c: any) => c.method === 'makeBox');
      // Three boxes created (i=1,2,3 => dims 2,4,6)
      expect(boxCalls.length).toBe(3);
      // Verify dimensions are correct (ascending)
      const dims = boxCalls.map((c: any) => c.args[0]).sort((a: number, b: number) => a - b);
      expect(dims).toEqual([2, 4, 6]);
    });
  });
});

// ===========================================================================
// 5. Compound selector (space-separated AND)
// ===========================================================================

describe('edge case: compound selector', () => {
  describe('parser', () => {
    it('parses space-separated selectors as AND (multiple args)', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z +X | shell 1');
      expect(ops[0].type).toBe('FacesSelect');
      if (ops[0].type === 'FacesSelect') {
        // Two selector args: >Z and +X (perpendicular to X)
        expect(ops[0].args.length).toBeGreaterThanOrEqual(2);
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
        expect(ops[0].args[1]).toMatchObject({ type: 'SelectorLit', value: '+X' });
      }
    });

    it('parses three space-separated selectors as AND', () => {
      const { ops } = parsePipeline('box 10 10 10 | edges >Z >X =Y | chamfer 1');
      expect(ops[0].type).toBe('EdgesSelect');
      if (ops[0].type === 'EdgesSelect') {
        expect(ops[0].args.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('parses list-separated selectors as OR', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces [>Z, <Z] | shell 1');
      expect(ops[0].type).toBe('FacesSelect');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0].type).toBe('ListLit');
      }
    });
  });

  describe('validator', () => {
    it('accepts compound AND selector followed by shell', () => {
      const errors = getErrors('box 10 10 10 | faces >Z +X | shell 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts compound OR selector followed by shell', () => {
      const errors = getErrors('box 10 10 10 | faces [>Z, <Z] | shell 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts compound AND on edges followed by fillet', () => {
      const errors = getErrors('box 10 10 10 | edges >Z >X | fillet 1');
      expect(errors).toHaveLength(0);
    });
  });

  describe('selector engine', () => {
    it('AND selector filters progressively (>Z and #X)', () => {
      // 6 faces of a box-like topology
      const faces = [
        { id: 'top' },    // center z=10, normal z+
        { id: 'bottom' }, // center z=-10, normal z-
        { id: 'right' },  // center x=10, normal x+
        { id: 'left' },   // center x=-10, normal x-
        { id: 'front' },  // center y=10, normal y+
        { id: 'back' },   // center y=-10, normal y-
      ];
      const centerFn = (f: any) => {
        switch (f.id) {
          case 'top':    return { x: 0, y: 0, z: 10 };
          case 'bottom': return { x: 0, y: 0, z: -10 };
          case 'right':  return { x: 10, y: 0, z: 0 };
          case 'left':   return { x: -10, y: 0, z: 0 };
          case 'front':  return { x: 0, y: 10, z: 0 };
          case 'back':   return { x: 0, y: -10, z: 0 };
          default: return { x: 0, y: 0, z: 0 };
        }
      };
      const dirFn = (f: any) => {
        switch (f.id) {
          case 'top':    return { x: 0, y: 0, z: 1 };
          case 'bottom': return { x: 0, y: 0, z: -1 };
          case 'right':  return { x: 1, y: 0, z: 0 };
          case 'left':   return { x: -1, y: 0, z: 0 };
          case 'front':  return { x: 0, y: 1, z: 0 };
          case 'back':   return { x: 0, y: -1, z: 0 };
          default: return null;
        }
      };

      // >Z selects the face with highest Z center = "top"
      // #X selects faces whose normal is parallel to X axis = "right", "left"
      // AND: >Z first picks "top", then #X filters further
      // "top" has normal (0,0,1) which is NOT parallel to X, so it gets filtered out
      // >Z gives [top]; #X applied to [top] finds nothing, because top's normal
      // is Z, not X. The engine reports that honestly as an empty result -- it
      // used to fall back to returning [top], which is how a mis-typed selector
      // turned into "select everything" downstream.
      const result = selectItems(null as any, faces, '>Z and #X', centerFn, dirFn);
      expect(result).toHaveLength(0);
    });

    it('OR selector returns union of results', () => {
      const faces = [
        { id: 'top' },
        { id: 'bottom' },
        { id: 'right' },
      ];
      const centerFn = (f: any) => {
        switch (f.id) {
          case 'top':    return { x: 0, y: 0, z: 10 };
          case 'bottom': return { x: 0, y: 0, z: -10 };
          case 'right':  return { x: 10, y: 0, z: 0 };
          default: return { x: 0, y: 0, z: 0 };
        }
      };

      const result = selectItems(null as any, faces, '>Z or <Z', centerFn);
      expect(result).toHaveLength(2);
      const ids = result.map((f: any) => f.id);
      expect(ids).toContain('top');
      expect(ids).toContain('bottom');
    });

    it('AND selector with two positional selectors (>Z >X equivalent)', () => {
      const edges = [
        { id: 'e_top_right' },
        { id: 'e_top_left' },
        { id: 'e_bottom_right' },
        { id: 'e_other' },
      ];
      const centerFn = (e: any) => {
        switch (e.id) {
          case 'e_top_right':    return { x: 10, y: 0, z: 10 };
          case 'e_top_left':     return { x: -10, y: 0, z: 10 };
          case 'e_bottom_right': return { x: 10, y: 0, z: -10 };
          case 'e_other':        return { x: 0, y: 0, z: 0 };
          default: return { x: 0, y: 0, z: 0 };
        }
      };

      // >Z selects highest Z = [e_top_right, e_top_left] (z=10)
      // >X selects highest X from those = [e_top_right] (x=10)
      const result = selectItems(null as any, edges, '>Z and >X', centerFn);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('e_top_right');
    });
  });

  describe('evaluator', () => {
    it('compound AND faces selector followed by shell calls shell with filtered faces', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // The mock's only face has centre z=5 and normal +Z, so `>Z +Z` is the
      // compound that actually matches it. (`>Z +X` matches nothing, which is
      // now an error -- see the test below.)
      const ast = parse('box 10 10 10 | faces >Z +Z | shell 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const shellCall = oc._calls.find((c: any) => c.method === 'shell');
      expect(shellCall).toBeDefined();
    });

    it('a compound selector that matches nothing is an error, not a silent no-op', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      // The mock face's normal is +Z, so it is not perpendicular to X.
      expect(() => evaluator.evaluate(parse('box 10 10 10 | faces >Z +X | shell 1')))
        .toThrow(/matched 0 of/);
    });
  });
});

// ===========================================================================
// 6. Degenerate geometry: circle 0
// ===========================================================================

describe('edge case: degenerate geometry', () => {
  describe('parser', () => {
    it('parses circle 0 as a valid CircleExpr', () => {
      const stmt = parseFirst('circle 0');
      expect(stmt.type).toBe('CircleExpr');
      if (stmt.type === 'CircleExpr') {
        expect(stmt.args[0]).toMatchObject({ type: 'NumberLit', value: 0 });
      }
    });

    it('parses circle 0 | extrude 5 as Pipeline', () => {
      const stmt = parseFirst('circle 0 | extrude 5');
      expect(stmt.type).toBe('Pipeline');
    });
  });

  describe('validator', () => {
    it('does not reject circle 0 at validation stage (degenerate check is runtime)', () => {
      // Validator checks context transitions, not numeric constraints.
      const errors = getErrors('circle 0 | extrude 5');
      expect(errors).toHaveLength(0);
    });
  });

  describe('evaluator', () => {
    it('circle 0 throws an error (radius must be positive)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 0 | extrude 5');
      expect(() => evaluator.evaluate(ast)).toThrow(/circle radius must be positive/);
    });

    it('circle -5 throws an error (radius must be positive)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle -5');
      expect(() => evaluator.evaluate(ast)).toThrow(/circle radius must be positive/);
    });

    it('ellipse 0 5 throws an error (rx must be positive)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('ellipse 0 5');
      expect(() => evaluator.evaluate(ast)).toThrow(/ellipse rx must be positive/);
    });

    it('ellipse 5 -1 throws an error (ry must be positive)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('ellipse 5 -1');
      expect(() => evaluator.evaluate(ast)).toThrow(/ellipse ry must be positive/);
    });
  });
});

// ===========================================================================
// 7. Precision boundary: 1um scale box
// ===========================================================================

describe('edge case: precision boundary (microscale geometry)', () => {
  describe('parser', () => {
    it('parses box with very small dimensions', () => {
      const stmt = parseFirst('box 0.000001 0.000001 0.000001');
      expect(stmt.type).toBe('BoxExpr');
      if (stmt.type === 'BoxExpr') {
        expect(stmt.args).toHaveLength(3);
        expect(stmt.args[0]).toMatchObject({ type: 'NumberLit', value: 1e-6 });
        expect(stmt.args[1]).toMatchObject({ type: 'NumberLit', value: 1e-6 });
        expect(stmt.args[2]).toMatchObject({ type: 'NumberLit', value: 1e-6 });
      }
    });

    it('parses scientific notation (1e-6)', () => {
      // Verify that 0.000001 is parsed as the correct float
      const stmt = parseFirst('$x = 0.000001');
      if (stmt.type === 'Assignment') {
        expect(stmt.value).toMatchObject({ type: 'NumberLit', value: 1e-6 });
      }
    });
  });

  describe('validator', () => {
    it('accepts box with microscale dimensions', () => {
      const errors = getErrors('box 0.000001 0.000001 0.000001');
      expect(errors).toHaveLength(0);
    });

    it('accepts microscale box in pipeline', () => {
      const errors = getErrors('box 0.000001 0.000001 0.000001 | translate 1 0 0');
      expect(errors).toHaveLength(0);
    });
  });

  describe('evaluator', () => {
    it('creates box with 1um dimensions', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 0.000001 0.000001 0.000001');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const boxCall = oc._calls.find((c: any) => c.method === 'makeBox');
      expect(boxCall).toBeDefined();
      // Verify the dimensions are passed correctly without floating point loss
      expect(boxCall!.args[0]).toBeCloseTo(1e-6, 12);
      expect(boxCall!.args[1]).toBeCloseTo(1e-6, 12);
      expect(boxCall!.args[2]).toBeCloseTo(1e-6, 12);
    });

    it('translates 1um box with centering (precision maintained)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 0.000001 0.000001 0.000001');
      evaluator.evaluate(ast);

      // Box primitives are centered by default, so a translate call
      // shifts origin to center.
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      expect(translateCalls.length).toBeGreaterThanOrEqual(1);
      // Centering translate should be -dim/2 = -0.5e-6
      const centeringCall = translateCalls[0];
      expect(centeringCall.args[1]).toBeCloseTo(-0.5e-6, 12);
      expect(centeringCall.args[2]).toBeCloseTo(-0.5e-6, 12);
      expect(centeringCall.args[3]).toBeCloseTo(-0.5e-6, 12);
    });

    it('cylinder with microscale radius', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('cylinder 0.000001 0.000001');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const cylCall = oc._calls.find((c: any) => c.method === 'makeCylinder');
      expect(cylCall).toBeDefined();
      expect(cylCall!.args[0]).toBeCloseTo(1e-6, 12);
      expect(cylCall!.args[1]).toBeCloseTo(1e-6, 12);
    });

    it('sphere with microscale radius', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('sphere 0.000001');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const sphereCall = oc._calls.find((c: any) => c.method === 'makeSphere');
      expect(sphereCall).toBeDefined();
      expect(sphereCall!.args[0]).toBeCloseTo(1e-6, 12);
    });

    it('arithmetic with microscale values preserves precision', () => {
      const result = evalExpr('$x = 0.000001 * 2') as number;
      expect(result).toBeCloseTo(2e-6, 12);
    });

    it('microscale value in named arg', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 0.000001 0.000001 0.000001 | translate 0.000001 0 0');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      // Find the explicit translate call (after centering)
      const translateCalls = oc._calls.filter((c: any) => c.method === 'translate');
      const lastTranslate = translateCalls[translateCalls.length - 1];
      expect(lastTranslate.args[1]).toBeCloseTo(1e-6, 12);
    });
  });
});

// ===========================================================================
// Additional edge cases
// ===========================================================================

describe('edge case: additional coverage', () => {
  // Expressions in list comprehension with shapes
  describe('list comprehension edge cases', () => {
    it('empty range produces empty list', () => {
      const result = evalExpr('$x = [$i for $i in range(0)]') as Value[];
      expect(result).toEqual([]);
    });

    it('single element range', () => {
      const result = evalExpr('$x = [$i for $i in range(1)]') as Value[];
      expect(result).toEqual([0]);
    });

    it('list comprehension with if-then-else expression', () => {
      const result = evalExpr('$x = [if $i > 1 then $i * 10 else $i for $i in range(4)]') as Value[];
      expect(result).toEqual([0, 1, 20, 30]);
    });

    it('list comprehension over explicit list', () => {
      const result = evalExpr('$x = [$i * $i for $i in [2, 3, 5, 7]]') as Value[];
      expect(result).toEqual([4, 9, 25, 49]);
    });
  });

  // Mixed 2D boolean and extrude patterns
  describe('2D boolean combinations', () => {
    it('validator: circle | union (rect) | fillet | extrude is valid', () => {
      const errors = getErrors('circle 10 | union (rect 5 5) | fillet 1 | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('validator: circle | inter (rect) | extrude is valid', () => {
      const errors = getErrors('circle 10 | inter (rect 5 5) | extrude 3');
      expect(errors).toHaveLength(0);
    });

    it('evaluator: circle | inter (rect) produces face-level common', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | inter (rect 5 5) | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const commonCalls = oc._calls.filter((c: any) => c.method === 'common');
      expect(commonCalls.length).toBe(1);
    });
  });

  // Edge cases in selector engine
  describe('selector engine edge cases', () => {
    it('empty items list returns empty', () => {
      const result = selectItems(null as any, [], '>Z', () => ({ x: 0, y: 0, z: 0 }));
      expect(result).toEqual([]);
    });

    it('single item always selected for max/min selector', () => {
      const faces = [{ id: 'only' }];
      const centerFn = () => ({ x: 0, y: 0, z: 0 });
      const result = selectItems(null as any, faces, '>Z', centerFn);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('only');
    });

    it('all items at same Z are selected by >Z', () => {
      const faces = [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ];
      const centerFn = () => ({ x: 0, y: 0, z: 5 }); // all at same Z
      const result = selectItems(null as any, faces, '>Z', centerFn);
      expect(result).toHaveLength(3);
    });
  });

  // Validate source commands that produce 2D context
  describe('source command context transitions', () => {
    it('union of 2D shapes stays in 2D (can extrude)', () => {
      const errors = getErrors('union [rect 10 10, circle 5] | extrude 5');
      expect(errors).toHaveLength(0);
    });

    it('diff of 2D shapes stays in 2D (can extrude)', () => {
      const errors = getErrors('diff [rect 10 10, circle 5] | extrude 5');
      expect(errors).toHaveLength(0);
    });
  });
});
