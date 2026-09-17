/**
 * Cross sections are read as measurements, so what matters is that the numbers
 * are the model's and not a tessellation's.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC } from '../src/ocp-kernel/init.js';
import { sectionShape, sectionSVG, parseSectionSpecs } from '../src/ocp-kernel/section.js';
import type { OC } from '../src/ocp-kernel/types.js';

let oc: OC;

beforeAll(async () => {
  oc = await initOC();
}, 60_000);

describe('sectionShape', () => {
  it('measures a circular section analytically, not from a polygon', () => {
    const cyl = oc.makeCylinder(20, 40);
    const r = sectionShape(oc, cyl, { axis: 'Z', value: 20 });

    expect(r.loops).toHaveLength(1);
    const loop = r.loops[0]!;
    expect(loop.closed).toBe(true);
    // An inscribed polygon always reads short; these come off the curve.
    expect(loop.areaExact).toBe(true);
    expect(loop.area).toBeCloseTo(Math.PI * 400, 4);
    expect(loop.length).toBeCloseTo(2 * Math.PI * 20, 9);
  });

  it('reports one loop per contour, biggest first', () => {
    const tube = oc.cut(oc.makeCylinder(20, 40), oc.makeCylinder(8, 40));
    const r = sectionShape(oc, tube, { axis: 'Z', value: 20 });

    expect(r.loops).toHaveLength(2);
    expect(r.loops[0]!.area).toBeCloseTo(Math.PI * 400, 4);
    expect(r.loops[1]!.area).toBeCloseTo(Math.PI * 64, 4);
  });

  it('a box section is its four corners, not every sampled point', () => {
    const box = oc.makeBox(100, 60, 40);
    const r = sectionShape(oc, box, { axis: 'Y', value: 30 });

    expect(r.loops).toHaveLength(1);
    expect(r.loops[0]!.points).toHaveLength(4);
    expect(r.loops[0]!.area).toBeCloseTo(100 * 40, 6);
    // u and v are the plane's own axes: XZ for a Y-normal plane.
    expect([r.uAxis, r.vAxis]).toEqual(['X', 'Z']);
  });

  it('defaults to the centre of the bounding box', () => {
    const box = oc.makeBox(10, 10, 10); // z in [0,10]
    expect(sectionShape(oc, box, { axis: 'Z' }).value).toBeCloseTo(5, 9);
  });

  it('a plane that misses the shape reports no loops', () => {
    const box = oc.makeBox(10, 10, 10);
    expect(sectionShape(oc, box, { axis: 'Z', value: 50 }).loops).toHaveLength(0);
  });

  it('writes SVG whose path data is millimetres', () => {
    const box = oc.makeBox(100, 60, 40);
    const svg = sectionSVG([sectionShape(oc, box, { axis: 'Y', value: 30 })]);
    // The 100x40 rectangle appears at its modelled size; only the group
    // transform scales it.
    expect(svg).toContain('scale(2 -2)');
    expect(svg).toMatch(/d="M 100 0 L 100 40 L 0 40 L 0 0 Z"|d="M 0 0 L 0 40 L 100 40 L 100 0 Z"/);
  });
});

describe('parseSectionSpecs', () => {
  it('names a plane by the axes it contains', () => {
    expect(parseSectionSpecs('xz,yz')).toEqual([{ axis: 'Y' }, { axis: 'X' }]);
  });

  it('takes an explicit position', () => {
    expect(parseSectionSpecs('Z=10, Y=-4.5')).toEqual([
      { axis: 'Z', value: 10 }, { axis: 'Y', value: -4.5 },
    ]);
  });

  it('refuses a plane it does not know', () => {
    expect(() => parseSectionSpecs('diagonal')).toThrow(/unknown section plane/);
  });
});
