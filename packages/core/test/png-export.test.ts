/**
 * PNG export: the options this side passes have to reach occt-wasm under the
 * names it reads. An option occt-wasm does not know is ignored without a word,
 * so a rename upstream (`scale` became `supersample` in 5.5.0) would turn
 * `--png-scale` into a no-op that still exits 0. Checked by its effect on the
 * bytes rather than by the type.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC } from '../src/ocp-kernel/init.js';
import { exportPNGBuffer } from '../src/ocp-kernel/export.js';
import type { OC, Shape } from '../src/ocp-kernel/types.js';

let oc: OC;
let shape: Shape;

beforeAll(async () => {
  oc = await initOC();
  shape = oc.fuse(oc.makeBox(20, 20, 10), oc.makeCylinder(6, 30));
});

/** Width and height from the IHDR chunk. */
function size(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  return [view.getUint32(16), view.getUint32(20)];
}

describe('exportPNGBuffer', () => {
  it('supersample changes the pixels, not the image size', async () => {
    const one = await exportPNGBuffer(oc, shape, { supersample: 1 });
    const three = await exportPNGBuffer(oc, shape, { supersample: 3 });
    expect(size(three)).toEqual(size(one));
    expect(Buffer.from(three).equals(Buffer.from(one))).toBe(false);
  });

  it('the default is supersample 2', async () => {
    const dflt = await exportPNGBuffer(oc, shape);
    const two = await exportPNGBuffer(oc, shape, { supersample: 2 });
    expect(Buffer.from(dflt).equals(Buffer.from(two))).toBe(true);
  });
});
