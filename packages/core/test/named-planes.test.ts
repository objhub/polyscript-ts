/**
 * The named workplanes. `AB` puts local x on world A and local y on world B;
 * `-AB` is the same plane with the same axes and the normal flipped, so
 * `workplane -XZ` extrudes toward -Y where `workplane XZ` extrudes toward +Y
 * and the drawing lands in the same place. The reversed spellings ZX / ZY /
 * YX are errors (the parser accepted them for years while the kernel
 * silently built XY; found 2026-09-06).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { makePlane } from '../src/ocp-kernel/geometry.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function bbox(source: string): { min: number[]; max: number[] } {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source)) as WpState;
  const bb = oc.getBoundingBox(v.shape!);
  return { min: [bb.xmin, bb.ymin, bb.zmin].map(n => +n.toFixed(6)), max: [bb.xmax, bb.ymax, bb.zmax].map(n => +n.toFixed(6)) };
}

// rect 10 4 at:(3, 1) extruded by 2: local x spans -2..8, local y -1..3, normal 0..2
const CASES: Record<string, { min: number[]; max: number[] }> = {
  'XY': { min: [-2, -1, 0], max: [8, 3, 2] },
  '-XY': { min: [-2, -1, -2], max: [8, 3, 0] },
  'XZ': { min: [-2, 0, -1], max: [8, 2, 3] },
  '-XZ': { min: [-2, -2, -1], max: [8, 0, 3] },
  'YZ': { min: [0, -2, -1], max: [2, 8, 3] },
  '-YZ': { min: [-2, -2, -1], max: [0, 8, 3] },
};

describe('named workplanes', () => {
  for (const [name, expected] of Object.entries(CASES)) {
    it(`workplane ${name}: same drawing, extrude along the normal`, () => {
      expect(bbox(`workplane ${name} | rect 10 4 at:(3, 1) | extrude 2`)).toEqual(expected);
    });
  }

  it('the negated name flips the normal and keeps the axes', () => {
    for (const a of ['XY', 'XZ', 'YZ']) {
      const pa = makePlane(oc, a);
      const pb = makePlane(oc, `-${a}`);
      expect([pb.normal.x, pb.normal.y, pb.normal.z]).toEqual([-pa.normal.x, -pa.normal.y, -pa.normal.z].map(n => n + 0));
      expect(pb.xDir).toEqual(pa.xDir);
      expect(pb.yDir).toEqual(pa.yDir);
    }
  });

  it('the string form accepts the signed name too', () => {
    expect(bbox('workplane "-XZ" | rect 10 4 at:(3, 1) | extrude 2')).toEqual(CASES['-XZ']);
  });

  it('the reversed spelling is an error that names the signed form', () => {
    expect(() => parse('workplane ZX | rect 1 1')).toThrow(/unknown plane 'ZX'.*'workplane -XZ'/);
    expect(() => makePlane(oc, 'YX')).toThrow(/unknown plane 'YX'.*'workplane -XY'/);
  });

  it('an unknown name is an error, not XY', () => {
    expect(() => parse('workplane XW | rect 1 1')).toThrow(/unknown plane 'XW'.*Valid names: XY, XZ, YZ, -XY, -XZ, -YZ/);
    expect(() => makePlane(oc, 'XW')).toThrow(/unknown plane 'XW'/);
  });

  it("'-' must touch the name: a spaced '-' is the ordinary minus", () => {
    expect(() => bbox('workplane - XY | rect 1 1 | extrude 1')).toThrow(/Undefined variable: XY/);
    expect(parse('x = 5\nbox 10 10 10 - x')).toBeTruthy();
  });
});
