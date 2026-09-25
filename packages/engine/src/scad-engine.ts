/**
 * ModelEngine for OpenSCAD: a client to scad-worker.ts.
 *
 * Exports come from the mesh of the last build. OpenSCAD's own STL writer
 * produces the same triangles as the OFF the viewer drew (both are Manifold's
 * output), so writing STL from the mesh in hand is equivalent and saves a
 * full re-render. GLB likewise. STEP and BREP are not offered: there is no
 * B-Rep to write them from (devel/csg2brep-eval202609.md).
 */

import type { MeshData } from '@polyscript/core';
import { meshDataToGLB } from './glb-export';
import { meshDataToSTL } from './stl-export';
import type { BuildResult, ExportFormat, ExportedFile, ModelEngine } from './types';
import type { ScadBuildResponse, ScadRequest } from './scad-worker';

import { SCAD_FORMATS as FORMATS } from './formats';

/** What the host has to provide for OpenSCAD to run. See ScadBuildRequest. */
export interface ScadOptions {
	openscadUrl: string;
	fontUrl?: string;
}

export class ScadEngine implements ModelEngine {
	readonly type = 'scad' as const;
	private readonly options: ScadOptions;

	constructor(options: ScadOptions) {
		this.options = options;
	}

	private worker: Worker | null = null;
	private nextId = 1;
	private pending = new Map<number, (r: ScadBuildResponse) => void>();
	private lastMesh: MeshData | null = null;

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const w = new Worker(new URL('./scad-worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (e: MessageEvent<ScadBuildResponse>) => {
			const resolve = this.pending.get(e.data.id);
			if (resolve) {
				this.pending.delete(e.data.id);
				resolve(e.data);
			}
		};
		w.onerror = (e) => {
			// A module worker that failed to load reports an ErrorEvent with every
			// field undefined; say so instead of printing "undefined" four times.
			const detail = e.message || 'worker failed to load (see the Network tab for the worker script request)';
			for (const [, resolve] of this.pending) {
				resolve({ id: -1, type: 'build', ok: false, error: detail });
			}
			this.pending.clear();
		};
		this.worker = w;
		return w;
	}

	async build(source: string): Promise<BuildResult> {
		const started = performance.now();
		const id = this.nextId++;
		const response = await new Promise<ScadBuildResponse>((resolve) => {
			this.pending.set(id, resolve);
			const req: ScadRequest = { id, type: 'build', code: source, ...this.options };
			this.getWorker().postMessage(req);
		});
		if (!response.ok || !response.mesh) {
			this.lastMesh = null;
			return { ok: false, errors: [{ message: response.error ?? 'OpenSCAD failed', phase: 'openscad' }] };
		}
		const mesh: MeshData = {
			positions: response.mesh.positions,
			normals: response.mesh.normals,
			indices: response.mesh.indices,
			colors: response.mesh.colors
		};
		this.lastMesh = mesh;
		// No cache figures: openscad.wasm renders from scratch every time.
		return {
			ok: true,
			mesh,
			info: response.info ?? null,
			stats: { ms: Math.round(performance.now() - started) },
			errors: []
		};
	}

	formats(): ExportFormat[] {
		return FORMATS;
	}

	canExport(id: string): boolean {
		return this.lastMesh !== null && FORMATS.some((f) => f.id === id);
	}

	async exportFile(id: string): Promise<ExportedFile> {
		if (!this.lastMesh) throw new Error('nothing built yet');
		if (id === 'stl') {
			return { blob: new Blob([meshDataToSTL(this.lastMesh)], { type: 'model/stl' }), extension: 'stl' };
		}
		if (id === 'glb') {
			// Copied into a fresh Uint8Array: gltf-transform types its output as
			// Uint8Array<ArrayBufferLike>, which is not a BlobPart.
			const glb = new Uint8Array(await meshDataToGLB(this.lastMesh));
			return { blob: new Blob([glb], { type: 'model/gltf-binary' }), extension: 'glb' };
		}
		throw new Error(`scad: no ${id} export`);
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		this.pending.clear();
		this.lastMesh = null;
	}
}
