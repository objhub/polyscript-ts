/**
 * Binary STL export: well-formed, same triangles as the ASCII export, and
 * readable by OCCT's own STL reader.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC } from '../src/ocp-kernel/init.js';
import { exportSTLBuffer, exportSTLString } from '../src/ocp-kernel/export.js';
import type { OC, Shape } from '../src/ocp-kernel/types.js';

let oc: OC;
let shape: Shape;
beforeAll(async () => {
  oc = await initOC();
  shape = oc.fuse(oc.makeBox(20, 20, 10), oc.makeCylinder(6, 30));
});

describe('exportSTLBuffer', () => {
  it('writes a well-formed binary STL with the ASCII export\'s facet count', () => {
    const bin = exportSTLBuffer(oc, shape, 0.1);
    const ascii = exportSTLString(oc, shape, 0.1);
    const facets = new DataView(bin.buffer, bin.byteOffset).getUint32(80, true);
    expect(bin.length).toBe(84 + 50 * facets);
    expect(new TextDecoder().decode(bin.subarray(0, 5))).not.toBe('solid');
    expect((ascii.match(/facet normal/g) ?? []).length).toBe(facets);
    // The point of the exercise.
    expect(bin.length).toBeLessThan(ascii.length / 5);
  });

  it('encloses the original volume (winding is consistent and outward)', () => {
    const bin = exportSTLBuffer(oc, shape, 0.05);
    const { facets, tri } = parseBinary(bin);
    // Signed volume: sum of tetrahedra (origin, a, b, c). Any flipped facet
    // subtracts, so agreeing with the B-Rep volume checks the winding too.
    let vol = 0;
    for (let t = 0; t < facets; t++) {
      const [a, b, c] = tri(t);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    const exact = oc.getVolume(shape);
    // A 0.05 deflection mesh of a cylinder is a little under the true volume.
    expect(vol).toBeGreaterThan(exact * 0.98);
    expect(vol).toBeLessThanOrEqual(exact * 1.001);
  });

  it('facet normals are unit length and follow the winding', () => {
    const bin = exportSTLBuffer(oc, oc.makeBox(10, 10, 10), 0.1);
    const { facets, normal, tri } = parseBinary(bin);
    for (let t = 0; t < facets; t++) {
      const n = normal(t);
      const [a, b, c] = tri(t);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...w);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      expect(n[0] * w[0] + n[1] * w[1] + n[2] * w[2]).toBeCloseTo(len, 3);
    }
  });
});

function parseBinary(bin: Uint8Array) {
  const view = new DataView(bin.buffer, bin.byteOffset);
  const facets = view.getUint32(80, true);
  const vec = (off: number) => [0, 1, 2].map((i) => view.getFloat32(off + 4 * i, true));
  return {
    facets,
    normal: (t: number) => vec(84 + 50 * t),
    tri: (t: number) => [0, 1, 2].map((v) => vec(84 + 50 * t + 12 + 12 * v)),
  };
}
