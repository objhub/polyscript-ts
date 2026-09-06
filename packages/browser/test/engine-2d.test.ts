/**
 * The engine against the real kernel, for what the mocked engine test cannot
 * see: how an evaluation result's 2D content becomes something to draw.
 *
 * After core split 2D into `faces` (regions) and `wires` (curves)
 * (devel/2d-face-wire202609.md), the engine kept reading only `shape` and
 * `wires`, so `rect 80 60` came back as "No shape produced" while every
 * mocked test stayed green. These cases pin the rule down:
 *   faces -> drawn as surfaces (holes included)
 *   wires -> drawn as lines, closed or not; a closed wire is not a face
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PolyScriptEngine } from '../src/index.js';

let engine: PolyScriptEngine;
beforeAll(async () => {
  engine = await PolyScriptEngine.init();
}, 120_000);

const triangles = (shape: unknown) => engine.tessellate(shape as never).indices.length / 3;

describe('2D results reach the viewer', () => {
  it('a region (rect, filleted) is a face with triangles and no lines', () => {
    const r = engine.build('rect 80 60\n | fillet 7\n');
    expect(r.success).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.shape).toBeTruthy();
    expect(triangles(r.shape)).toBeGreaterThan(0);
    expect(r.lineMesh).toBeUndefined();
  });

  it('a sketch literal is a face', () => {
    const r = engine.build('sketch [(0,0), (10,0), (10,10), (0,10)]\n');
    expect(r.success).toBe(true);
    expect(triangles(r.shape)).toBe(2);
  });

  it('a closed wire is drawn as lines, not promoted to a face', () => {
    const r = engine.build('wire [(0,0), (10,0), (10,10), (0,10), (0,0)]\n');
    expect(r.success).toBe(true);
    expect(r.shape).toBeNull();
    expect(r.lineMesh).toBeTruthy();
    expect(r.lineMesh!.indices.length).toBeGreaterThan(0);
  });

  it('an open wire is drawn as lines', () => {
    const r = engine.build('wire [(0,0), (10,0), (10,10)]\n');
    expect(r.success).toBe(true);
    expect(r.shape).toBeNull();
    expect(r.lineMesh).toBeTruthy();
  });

  it('a sketch left on a face of a solid is drawn together with the solid', () => {
    const r = engine.build('box 40 40 10\n | faces ">Z" | rect 10 5 | rotate 30\n');
    expect(r.success).toBe(true);
    expect(r.shape).toBeTruthy();
    // the box's 12 triangles plus the rectangle's 2
    expect(triangles(r.shape)).toBe(14);
  });

  it('a solid alone is unchanged by the 2D handling', () => {
    const r = engine.build('box 10 10 10\n');
    expect(r.success).toBe(true);
    expect(triangles(r.shape)).toBe(12);
    expect(r.lineMesh).toBeUndefined();
  });

  it('nothing drawn is still an error, not a blank success', () => {
    const r = engine.build('x = 1\n');
    expect(r.success).toBe(false);
    expect(r.errors.map(e => e.message)).toContain('No shape produced');
  });
});
