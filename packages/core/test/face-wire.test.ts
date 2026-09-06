/**
 * Face / Wire: the two 2D types (devel/2d-face-wire202609.md).
 *
 * Runs the real kernel because every case here is about what OCCT builds
 * from the faces and wires the workplane holds -- holes surviving to extrude,
 * booleans on a selected face, wires being refused where an area is needed.
 * Expected numbers are analytic where a closed form exists.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { validate } from '../src/validator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}

function volume(source: string): number {
  return oc.getVolume(run(source).shape!);
}

function solids(source: string): number {
  return oc.getSubShapes(run(source).shape!, 'solid').length;
}

const PI = Math.PI;

describe('Face / Wire: constructors fix the type', () => {
  it('rect, circle, sketch are faces; wire [...] is a wire even when closed', () => {
    expect(run('rect 10 10').faces).toHaveLength(1);
    expect(run('rect 10 10').wires).toHaveLength(0);
    expect(run('sketch [(0,0), (10,0), (0,10), (0,0)]').faces).toHaveLength(1);
    const w = run('wire [(0,0), (10,0), (0,10), (0,0)]');
    expect(w.faces).toHaveLength(0);
    expect(w.wires).toHaveLength(1);
  });

  it('a 2D boolean result is stored as faces with holes intact', () => {
    const wp = run('circle 10 | diff (circle 3)');
    expect(wp.faces).toHaveLength(1);
    expect(oc.getSubShapes(wp.faces[0], 'wire')).toHaveLength(2);
    expect(volume('circle 10 | diff (circle 3) | extrude 5')).toBeCloseTo((100 - 9) * PI * 5, 3);
  });
});

describe('Face / Wire: area operations refuse wires', () => {
  const msg = /a wire has no area/;
  it('extrude / cut / revolve / loft / booleans on a wire are errors', () => {
    expect(() => run('wire [(0,0), (10,0), (10,10)] | extrude 5')).toThrow(msg);
    expect(() => run('wire [(0,0), (10,0), (10,10), (0,0)] | extrude 5')).toThrow(msg);
    expect(() => run('workplane XZ | move 20 0 | wire [(0,0), (4,0), (4,10), (0,0)] | revolve Z')).toThrow(msg);
    expect(() => run('box 20 20 5 | faces >Z | wire [(0,0), (5,0), (0,5), (0,0)] | cut 2')).toThrow(msg);
    expect(() => run('wire [(0,0), (10,0), (0,10), (0,0)] | union (circle 3)')).toThrow(msg);
  });

  it('the validator rejects them before the kernel runs', () => {
    const errors = validate(parse('wire [(0,0), (10,0), (10,10)] | extrude 5'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('not valid in Wire context');
    expect(validate(parse('wire [(0,0), (10,0), (10,10)] | offset 1 | extrude 5'))).toEqual([]);
    expect(validate(parse('circle 10 | sweep (circle 1)'))).toEqual([]);
  });
});

describe('Face / Wire: offset is the only Wire -> Face conversion', () => {
  it('an open wire becomes a band of width 2d (round caps by default)', () => {
    // L of length 50, half-width 2: band 200, round outer join -(4 - pi),
    // two round caps +pi*4. (A single-edge wire is what occt-wasm's offset
    // cannot handle yet, hence two segments.)
    expect(volume('wire [(0,0), (30,0), (30,20)] | offset 2 | extrude 1')).toBeCloseTo(200 - (4 - PI) + 4 * PI, 2);
  });

  it('a closed wire becomes a ring, not a filled outline', () => {
    // 20x20 square, d = 2: outer 24x24 (round joins), inner 16x16
    const v = volume('wire [(0,0), (20,0), (20,20), (0,20), (0,0)] | offset 2 | extrude 1');
    const outer = 24 * 24 - (16 - 4 * PI); // round-joined outer
    expect(v).toBeCloseTo(outer - 16 * 16, 2);
  });

  it('a face offset stays a face', () => {
    expect(volume('rect 20 20 | offset 2 | extrude 1')).toBeCloseTo(24 * 24 - (16 - 4 * PI), 2);
  });
});

describe('Face / Wire: Face -> Wire where a curve is needed', () => {
  it('a hole-free face lends its boundary as a sweep spine (torus)', () => {
    expect(volume('circle 50 | sweep (circle 10)')).toBeCloseTo(2 * PI * PI * 50 * 100, 0);
  });

  it('a face with holes has no single boundary', () => {
    expect(() => run('circle 50 | diff (circle 40) | sweep (circle 1)')).toThrow(/holes/);
  });
});

describe('Face / Wire: every face in the context is consumed', () => {
  it('revolve takes all faces, not the last one', () => {
    const v = volume('workplane XZ | move 20 0 | rect 4 10 | circle 1 | revolve Z');
    // rect 4x10 at radius 20 (Pappus) plus a tiny disk; fusion, so at least the rect ring
    expect(v).toBeGreaterThan(2 * PI * 20 * 40 - 1);
    expect(solids('workplane XZ | move 20 0 | rect 4 10 | circle 1 | revolve Z')).toBe(1);
  });
});

describe('Face / Wire: text glyph counters are holes', () => {
  it('"O" is a ring: thinner than its filled outline, and a center drill changes nothing', () => {
    const o = volume('text "O" 20 | extrude 2');
    expect(o).toBeLessThan(200);
    expect(volume('text "O" 20 | extrude 2 | diff (cylinder 1 2)')).toBeCloseTo(o, 6);
  });

  it('"8" is valid and "回" is one solid', () => {
    const eight = run('text "8" 20 | extrude 2');
    expect(oc.isValid(eight.shape!)).toBe(true);
    expect(solids('text "回" 20 | extrude 2')).toBe(1);
  });

  it('cutting "A" into a face keeps the counter', () => {
    const filled = volume('box 40 40 5 | faces >Z | sketch [(-6,-7), (6,-7), (0,7), (-6,-7)] | cut 2');
    const withA = volume('box 40 40 5 | faces >Z | text "A" 20 | cut 2');
    // Both remove roughly one letter's worth; the check is that A's cut is a
    // ring-and-legs shape (its counter stays), so it removes less than a
    // filled triangle of about the same footprint would.
    expect(withA).toBeGreaterThan(filled);
    expect(withA).toBeLessThan(8000);
  });
});

describe('Face / Wire: 2D booleans on a selected face', () => {
  it('the tool is drawn on the face plane, so diff + cut removes the ring', () => {
    const v = volume('box 40 40 5 | faces >Z | rect 10 10 | diff (circle 3) | cut 2');
    expect(v).toBeCloseTo(8000 - (100 - 9 * PI) * 2, 3);
  });

  it('place puts a 2D source on the face plane', () => {
    const wp = run('box 10 10 10 | faces >Z | place (circle 3) | extrude 5');
    const bb = oc.getBoundingBox(wp.shape!);
    expect(bb.zmax).toBeCloseTo(10, 3);
    expect(oc.getVolume(wp.shape!)).toBeCloseTo(1000 + 9 * PI * 5, 3);
  });

  it('a 2D tool against a bare solid is an error, not a silent no-op', () => {
    expect(() => run('box 40 40 5 | faces >Z | diff [rect 10 10, circle 3] | cut 2'))
      .toThrow(/cannot combine a solid with a face/);
  });
});
