/**
 * Binary STL from MeshData.
 *
 * The mesh on screen is the source, not the B-Rep: OpenSCAD objects never had
 * one, and taking both formats from the same triangles is what makes the file
 * match what the person is looking at.
 */

import type { MeshData } from '@polyscript/core';

/** Triangle soup with positions and indices. Multi-colour models carry these
 *  per part and leave the top-level arrays empty. */
type TriangleSource = Pick<MeshData, 'positions' | 'indices'>;

function sourcesOf(data: MeshData): TriangleSource[] {
	return data.parts && data.parts.length > 0 ? data.parts : [data];
}

// Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>: only
// the narrow form is a BlobPart, and the caller wraps this in a Blob.
export function meshDataToSTL(data: MeshData): Uint8Array<ArrayBuffer> {
	const sources = sourcesOf(data);

	let triangles = 0;
	for (const s of sources) {
		triangles += Math.floor(s.indices.length / 3);
	}

	// 80-byte header + uint32 count + 50 bytes per facet.
	const buffer = new ArrayBuffer(84 + triangles * 50);
	const view = new DataView(buffer);
	// The header is left zeroed. Anything starting with "solid" makes some
	// readers parse the file as ASCII STL and choke on the binary that follows.
	view.setUint32(80, triangles, true);

	let offset = 84;
	for (const { positions, indices } of sources) {
		for (let i = 0; i + 2 < indices.length; i += 3) {
			const a = indices[i] * 3;
			const b = indices[i + 1] * 3;
			const c = indices[i + 2] * 3;

			// The facet normal is computed from the triangle rather than taken
			// from the vertex normals: STL stores one normal per facet, and the
			// vertex normals are smoothed across facets, which is a different
			// thing and would misstate the geometry.
			const ux = positions[b] - positions[a];
			const uy = positions[b + 1] - positions[a + 1];
			const uz = positions[b + 2] - positions[a + 2];
			const vx = positions[c] - positions[a];
			const vy = positions[c + 1] - positions[a + 1];
			const vz = positions[c + 2] - positions[a + 2];
			let nx = uy * vz - uz * vy;
			let ny = uz * vx - ux * vz;
			let nz = ux * vy - uy * vx;
			const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (len > 0) {
				nx /= len;
				ny /= len;
				nz /= len;
			} else {
				// Degenerate triangle. A zero normal is legal and tells readers
				// to work it out themselves.
				nx = ny = nz = 0;
			}

			view.setFloat32(offset, nx, true);
			view.setFloat32(offset + 4, ny, true);
			view.setFloat32(offset + 8, nz, true);
			offset += 12;

			for (const v of [a, b, c]) {
				view.setFloat32(offset, positions[v], true);
				view.setFloat32(offset + 4, positions[v + 1], true);
				view.setFloat32(offset + 8, positions[v + 2], true);
				offset += 12;
			}

			// Attribute byte count. Zero: the colour extensions that use it are
			// not interoperable, and the GLB export carries colour properly.
			view.setUint16(offset, 0, true);
			offset += 2;
		}
	}

	return new Uint8Array(buffer);
}
