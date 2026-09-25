/**
 * Convert MeshData to GLB binary using @gltf-transform/core.
 *
 * Supports:
 * - positions + normals + indices (basic mesh)
 * - single color (uniform material)
 * - per-vertex colors (vertex color attribute)
 * - empty normals (auto-computed via computeVertexNormals before calling this)
 */

import { Document, NodeIO } from '@gltf-transform/core';
import type { MeshData } from './stl-parser';

/**
 * What a mesh with no colour of its own is drawn in.
 *
 * Duplicated from ModelViewer's own default rather than imported: it lives in
 * a `.svelte` file as a literal, with nothing exported to reach it. Kept here
 * with this note so the next person who changes one knows to change the other.
 */
const DEFAULT_COLOR: [number, number, number] = [1.0, 0.92, 0.3];

/**
 * glTF accessors take arrays backed by a plain ArrayBuffer, and the type says
 * so; `MeshData` says only `Float32Array`, which since TypeScript 5.7 also
 * admits a SharedArrayBuffer. Every mesh here comes from wasm memory or from a
 * postMessage transfer, so it is always the plain kind -- but nothing in the
 * type records that, and the writer has no way to accept the wider one.
 */
function plain<T extends { buffer: ArrayBufferLike }>(a: T): T extends Float32Array
	? Float32Array<ArrayBuffer>
	: Uint32Array<ArrayBuffer> {
	return a as never;
}

export async function meshDataToGLB(data: MeshData): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();

  // Positions
  const posAccessor = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(plain(data.positions))
    .setBuffer(buffer);

  // Normals (may be empty for OFF-parsed data — caller should computeVertexNormals first)
  let normalAccessor;
  if (data.normals.length > 0) {
    normalAccessor = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(plain(data.normals))
      .setBuffer(buffer);
  }

  // Indices
  const indexAccessor = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(plain(data.indices))
    .setBuffer(buffer);

  // Primitive
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', posAccessor)
    .setIndices(indexAccessor);

  if (normalAccessor) {
    prim.setAttribute('NORMAL', normalAccessor);
  }

  // Material
  const material = doc.createMaterial().setDoubleSided(false);

  if (data.colors) {
    // Per-vertex colors
    const colorAccessor = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(plain(data.colors))
      .setBuffer(buffer);
    prim.setAttribute('COLOR_0', colorAccessor);
    material.setBaseColorFactor([1, 1, 1, 1]); // white base, vertex colors multiply
  } else if (data.color) {
    material.setBaseColorFactor([data.color[0], data.color[1], data.color[2], 1]);
  } else {
    // The same yellow ModelViewer paints an uncoloured mesh with. The GLB
    // records what the author was looking at when they saved; a different
    // default here meant the thumbnail (a screenshot of the viewer) and the
    // GLB shipped the same model in two colours.
    material.setBaseColorFactor([...DEFAULT_COLOR, 1]);
  }

  prim.setMaterial(material);

  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh);
  doc.createScene().addChild(node);

  const io = new NodeIO();
  return io.writeBinary(doc);
}
