/**
 * glTF export: a well-formed binary container, and colours that survive.
 *
 * Colour is the reason to pick glTF over STL here -- STL carries none and STEP
 * only through XCAF -- so a GLB that parses but comes out uniformly grey has
 * lost the point of the format. Both are checked.
 *
 * OCCT's XCAF writer emits the binary container only, so `.gltf` is rejected
 * rather than filled with GLB bytes under a name that promises JSON.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initOC } from '../src/ocp-kernel/init.js';
import { exportGLTFBuffer, exportShape } from '../src/ocp-kernel/export.js';
import type { OC, Shape } from '../src/ocp-kernel/types.js';

let oc: OC;
let shape: Shape;
let dir: string;

beforeAll(async () => {
  oc = await initOC();
  shape = oc.fuse(oc.makeBox(20, 20, 10), oc.makeCylinder(6, 30));
  dir = mkdtempSync(join(tmpdir(), 'polyscript-gltf-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Parse the JSON chunk of a GLB, checking the header on the way through. */
function glbJson(bytes: Uint8Array): any {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(new TextDecoder().decode(bytes.subarray(16, 20))).toBe('JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
}

const baseColors = (json: any): number[][] =>
  (json.materials ?? []).map((m: any) => m.pbrMetallicRoughness.baseColorFactor.map((v: number) => +v.toFixed(3)));

describe('exportGLTFBuffer', () => {
  it('writes a glTF 2.0 binary container with geometry in it', () => {
    const json = glbJson(exportGLTFBuffer(oc, shape));
    expect(json.meshes.length).toBeGreaterThan(0);
    expect(json.asset.version).toBe('2.0');
  });

  it('keeps one material per part rather than merging them', () => {
    const parts = [
      { shape: oc.makeBox(10, 10, 10), color: [1, 0, 0] as [number, number, number] },
      { shape: oc.makeCylinder(3, 20), color: [0, 0, 1] as [number, number, number] },
    ];
    const json = glbJson(exportGLTFBuffer(oc, shape, { parts }));
    expect(json.meshes.length).toBe(2);
    expect(baseColors(json)).toEqual([[1, 0, 0, 1], [0, 0, 1, 1]]);
  });

  it('falls back to a single default colour when no parts are given', () => {
    const colors = baseColors(glbJson(exportGLTFBuffer(oc, shape)));
    expect(colors.length).toBe(1);
    expect(colors[0][3]).toBe(1);
  });
});

describe('exportShape routing', () => {
  it('writes a GLB for .glb', async () => {
    const out = join(dir, 'out.glb');
    await exportShape(oc, shape, out);
    glbJson(new Uint8Array(readFileSync(out)));
  });

  it('carries parts through exportShape to the materials', async () => {
    const out = join(dir, 'colored.glb');
    await exportShape(oc, shape, out, {
      parts: [{ shape: oc.makeBox(8, 8, 8), color: [0, 1, 0] }],
    });
    expect(baseColors(glbJson(new Uint8Array(readFileSync(out))))).toEqual([[0, 1, 0, 1]]);
  });

  it('rejects .gltf and names the extension that works', async () => {
    await expect(exportShape(oc, shape, join(dir, 'out.gltf')))
      .rejects.toThrow(/\.glb/);
  });
});
