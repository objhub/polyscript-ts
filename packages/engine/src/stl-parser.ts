/**
 * Parse a binary STL file into mesh data for Three.js.
 *
 * Binary STL format:
 *   80 bytes header (ignored)
 *   4 bytes uint32 triangle count
 *   For each triangle (50 bytes):
 *     12 bytes normal (3 × float32)
 *     36 bytes vertices (3 × 3 × float32)
 *     2 bytes attribute byte count (ignored)
 */

import type { MeshData } from '@polyscript/core';
export type { MeshData };

export function parseSTL(buffer: ArrayBuffer): MeshData {
  const view = new DataView(buffer);
  const numTriangles = view.getUint32(80, true);

  const positions = new Float32Array(numTriangles * 9);
  const normals = new Float32Array(numTriangles * 9);
  const indices = new Uint32Array(numTriangles * 3);

  let offset = 84;
  for (let i = 0; i < numTriangles; i++) {
    // Normal (shared by all 3 vertices of the triangle)
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    const base = i * 9;
    // 3 vertices
    for (let v = 0; v < 3; v++) {
      const vi = base + v * 3;
      positions[vi] = view.getFloat32(offset, true);
      positions[vi + 1] = view.getFloat32(offset + 4, true);
      positions[vi + 2] = view.getFloat32(offset + 8, true);
      normals[vi] = nx;
      normals[vi + 1] = ny;
      normals[vi + 2] = nz;
      offset += 12;
    }

    // Attribute byte count (skip)
    offset += 2;

    // Sequential indices (unindexed mesh)
    const ii = i * 3;
    indices[ii] = ii;
    indices[ii + 1] = ii + 1;
    indices[ii + 2] = ii + 2;
  }

  return { positions, normals, indices };
}
