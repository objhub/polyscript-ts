/**
 * Info-panel figures for a model that only exists as triangles.
 *
 * The poly engine gets these from the kernel; an OpenSCAD model has no kernel
 * behind it, so they are computed from the mesh: the bounding box from the
 * vertices, the volume by the divergence theorem (sum of signed tetrahedra
 * against the origin -- exact for a closed, consistently oriented mesh, which
 * is what OpenSCAD emits), the area as the sum of triangle areas.
 */

import type { MeshData } from '@polyscript/core';
import type { ModelSummary } from './types';

type Triangles = Pick<MeshData, 'positions' | 'indices'>;

function trianglesOf(mesh: MeshData): Triangles[] {
	return mesh.parts && mesh.parts.length > 0 ? mesh.parts : [mesh];
}

export function meshSummary(mesh: MeshData): ModelSummary | null {
	let volume = 0;
	let area = 0;
	let any = false;
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

	for (const { positions, indices } of trianglesOf(mesh)) {
		for (let i = 0; i + 2 < positions.length; i += 3) {
			any = true;
			for (let k = 0; k < 3; k++) {
				const v = positions[i + k];
				if (v < min[k]) min[k] = v;
				if (v > max[k]) max[k] = v;
			}
		}
		for (let i = 0; i + 2 < indices.length; i += 3) {
			const a = indices[i] * 3;
			const b = indices[i + 1] * 3;
			const c = indices[i + 2] * 3;
			const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
			const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
			const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
			// Signed volume of the tetrahedron (origin, a, b, c).
			volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
			// Half the cross product's length.
			const ux = bx - ax, uy = by - ay, uz = bz - az;
			const vx = cx - ax, vy = cy - ay, vz = cz - az;
			const nx = uy * vz - uz * vy;
			const ny = uz * vx - ux * vz;
			const nz = ux * vy - uy * vx;
			area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
		}
	}
	if (!any) return null;

	return { bbox: { min, max }, volume: Math.abs(volume), area };
}
