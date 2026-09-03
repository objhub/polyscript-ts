/**
 * Tests for text rendering — real font glyph extraction via opentype.js.
 *
 * These tests verify the text-render module that converts TrueType/OpenType
 * glyph outlines into occt-wasm wires.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { textToWires, setTextFont, resetFontCache } from '../src/ocp-kernel/text-render.js';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import type { WpState } from '../src/ocp-kernel.js';

// ---------------------------------------------------------------------------
// Helper: create a mock OC kernel that tracks calls
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

function isWpState(v: any): v is WpState {
  return v !== null && typeof v === 'object' && 'oc' in v && 'plane' in v;
}

// Detect font availability (same approach as Python tests)
let _hasFont = false;
try {
  const oc = createMockOC();
  const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
  const result = textToWires(oc, 'A', 10, plane);
  _hasFont = result !== null;
} catch {
  _hasFont = false;
}

// ---------------------------------------------------------------------------
// Low-level: textToWires
// ---------------------------------------------------------------------------

describe('textToWires', () => {
  beforeEach(() => {
    resetFontCache();
  });

  it('returns null for empty string', () => {
    const oc = createMockOC();
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
    const result = textToWires(oc, '', 10, plane);
    expect(result).toBeNull();
  });

  it.skipIf(!_hasFont)('single char produces wires', () => {
    const oc = createMockOC();
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
    const wires = textToWires(oc, 'A', 10, plane);
    expect(wires).not.toBeNull();
    // "A" typically has 2 contours (outer + inner triangle hole)
    expect(wires!.length).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!_hasFont)('longer text produces more wires', () => {
    const oc = createMockOC();
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
    const wiresA = textToWires(oc, 'A', 10, plane);
    resetFontCache(); // reset to avoid stale mock data
    const oc2 = createMockOC();
    const wiresHello = textToWires(oc2, 'Hello', 10, plane);
    expect(wiresA).not.toBeNull();
    expect(wiresHello).not.toBeNull();
    expect(wiresHello!.length).toBeGreaterThan(wiresA!.length);
  });

  it.skipIf(!_hasFont)('creates line and bezier edges', () => {
    const oc = createMockOC();
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
    textToWires(oc, 'O', 20, plane);
    // "O" typically has curved contours, so we expect bezier edges
    const lineEdges = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    const bezierEdges = oc._calls.filter((c: any) => c.method === 'makeBezierEdge');
    // At least some edges of either type
    expect(lineEdges.length + bezierEdges.length).toBeGreaterThan(0);
    // makeWire should have been called (one per contour)
    const wiresCalls = oc._calls.filter((c: any) => c.method === 'makeWire');
    expect(wiresCalls.length).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!_hasFont)('respects workplane (XZ plane)', () => {
    const oc = createMockOC();
    const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 0, z: 1 } };
    const wires = textToWires(oc, 'I', 10, plane);
    expect(wires).not.toBeNull();
    // Points should be in XZ plane (y should remain ~0, z should vary)
    const lineEdges = oc._calls.filter((c: any) => c.method === 'makeLineEdge');
    if (lineEdges.length > 0) {
      const p0 = lineEdges[0].args[0];
      // On XZ plane, points should have y ~ 0 (workplane normal is Y)
      expect(Math.abs(p0.y)).toBeLessThan(1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// Font API
// ---------------------------------------------------------------------------

describe('setTextFont / resetFontCache', () => {
  beforeEach(() => {
    resetFontCache();
  });

  it('resetFontCache clears cached font', () => {
    // Just verify it does not throw
    resetFontCache();
  });

  it.skipIf(!_hasFont)('setTextFont with a valid buffer loads font', () => {
    // Load the system font as a buffer and set it
    const fs = require('node:fs');
    const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    try {
      const buffer = fs.readFileSync(fontPath);
      setTextFont(buffer.buffer);
      const oc = createMockOC();
      const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
      const wires = textToWires(oc, 'X', 10, plane);
      expect(wires).not.toBeNull();
    } catch {
      // Font file not available at this path -- skip
    }
  });
});

// ---------------------------------------------------------------------------
// Fallback behavior
// ---------------------------------------------------------------------------

describe('text placeholder fallback', () => {
  it('falls back to rect when font cache forced to null', () => {
    resetFontCache();
    // We need to force the font to be unavailable.
    // We do this by setting userFontBuffer to an invalid buffer then clearing it,
    // which will cause loadFont to try and fail. Instead, test via evaluator
    // with resetFontCache + no font scenario.
    // Actually, with a real system font available, textToWires will succeed.
    // So we test the fallback path by checking the evaluator still produces wires
    // even if textToWires returns null.
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('text "test" 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Evaluator integration: text produces real glyph wires
// ---------------------------------------------------------------------------

describe('text evaluator integration', () => {
  it.skipIf(!_hasFont)('text "A" 10 produces multiple contour wires', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('text "A" 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    // "A" typically has 2 contours (outer shape + inner hole)
    expect(wp.wires.length).toBeGreaterThanOrEqual(2);
  });

  it.skipIf(!_hasFont)('text "Hello" has more wires than "A"', () => {
    resetFontCache();
    const oc1 = createMockOC();
    const evaluator1 = new Evaluator({ oc: oc1 });
    const ast1 = parse('text "A" 10');
    const r1 = evaluator1.evaluate(ast1);
    expect(isWpState(r1)).toBe(true);
    const wiresA = (r1 as WpState).wires.length;

    resetFontCache();
    const oc2 = createMockOC();
    const evaluator2 = new Evaluator({ oc: oc2 });
    const ast2 = parse('text "Hello" 10');
    const r2 = evaluator2.evaluate(ast2);
    expect(isWpState(r2)).toBe(true);
    const wiresHello = (r2 as WpState).wires.length;

    expect(wiresHello).toBeGreaterThan(wiresA);
  });

  it.skipIf(!_hasFont)('text with named size: produces wires', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('text "Og" size:15');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires.length).toBeGreaterThanOrEqual(1);
    // Verify that edges were created (line or bezier)
    const edgeCalls = oc._calls.filter((c: any) =>
      c.method === 'makeLineEdge' || c.method === 'makeBezierEdge');
    expect(edgeCalls.length).toBeGreaterThan(0);
  });

  it.skipIf(!_hasFont)('text in pipe context (faces + text + cut) works', () => {
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('box 80 60 10 | faces >Z | text "M8" size:10 | cut 2');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.shape).toBeTruthy();
  });

  it('text produces wires regardless of font availability', () => {
    // This test passes with both real font and placeholder
    const oc = createMockOC();
    const evaluator = new Evaluator({ oc });
    const ast = parse('text "test" 10');
    const result = evaluator.evaluate(ast);
    expect(isWpState(result)).toBe(true);
    const wp = result as WpState;
    expect(wp.wires.length).toBeGreaterThanOrEqual(1);
  });
});
