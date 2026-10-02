/**
 * `thread`: an external thread built as a B-Rep (one ruled face per flank per
 * turn), not as a cylinder minus a swept groove. Checked on the kernel: a
 * valid single solid, the volume between the root and crest cylinders, the
 * chamfer forms (a size, `true` = down to the root, both ends), and the
 * argument checks.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC } from '../src/ocp-kernel/init.js';
import { createWorkplane, wpThread } from '../src/ocp-kernel.js';
import type { OC } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => { oc = await initOC(); });

const r = 8, pitch = 2, h = 20;
const land = pitch / 8, depth = (pitch - land) / 2 * Math.sqrt(3);
const none = { bottom: 0, top: 0 };
const make = (chamfer = none, center?: [boolean, boolean, boolean]) =>
  wpThread(createWorkplane(oc), r, pitch, h, { depth, land, chamfer }, center).shape!;

describe('thread', () => {
  it('is a valid solid between the root and crest cylinders', () => {
    const shape = make();
    expect(oc.isSolid(shape)).toBe(true);
    expect(oc.isValid(shape)).toBe(true);
    const v = oc.getVolume(shape);
    expect(v).toBeLessThan(Math.PI * r * r * h);
    expect(v).toBeGreaterThan(Math.PI * (r - depth) ** 2 * h);
    // the groove removes about hw*depth per unit of helix length
    const groove = (pitch - land) / 2 * depth * 2 * Math.PI * (r - depth / 3) * (h / pitch);
    expect(v).toBeCloseTo(Math.PI * r * r * h - groove, -2);
    const bb = oc.getBoundingBox(shape);
    expect(bb.zmin).toBeCloseTo(-h / 2, 3);
    expect(bb.zmax).toBeCloseTo(h / 2, 3);
    expect(bb.xmax).toBeCloseTo(r, 3);
  });

  it('a top chamfer removes material from the top only', () => {
    const plain = make();
    const tipped = make({ bottom: 0, top: 1.7 }, [true, true, false]);
    expect(oc.isValid(tipped)).toBe(true);
    expect(oc.getVolume(tipped)).toBeLessThan(oc.getVolume(plain));
    const bb = oc.getBoundingBox(tipped);
    expect(bb.zmin).toBeCloseTo(0, 3);
    expect(bb.zmax).toBeCloseTo(h, 3);
    // the top face is a circle of radius r - 1.7, the bottom one still r
    const slab = (z0: number) => oc.getBoundingBox(oc.common(tipped, oc.translate(oc.makeCylinder(r + 1, 0.01), 0, 0, z0)));
    expect(slab(h - 0.01).xmax).toBeCloseTo(r - 1.7, 1);
    expect(slab(0).xmax).toBeCloseTo(r, 1);
  });

  it('chamfers on both ends are mirror images', () => {
    const both = make({ bottom: 1.5, top: 1.5 }, [true, true, false]);
    expect(oc.isValid(both)).toBe(true);
    const half = (z0: number) => oc.getVolume(oc.common(both, oc.translate(oc.makeCylinder(r + 1, h / 2), 0, 0, z0)));
    expect(half(0)).toBeCloseTo(half(h / 2), 0);
    const bb = oc.getBoundingBox(both);
    expect(bb.zmin).toBeCloseTo(0, 3);
    expect(bb.zmax).toBeCloseTo(h, 3);
  });

  it('rejects a groove deeper than the radius and a chamfer reaching the axis', () => {
    expect(() => wpThread(createWorkplane(oc), r, pitch, h, { depth: 9, land, chamfer: none })).toThrow(/depth/);
    expect(() => make({ bottom: 0, top: 8 })).toThrow(/chamfer/);
  });
});
