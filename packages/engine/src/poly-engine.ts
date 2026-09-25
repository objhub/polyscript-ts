/**
 * ModelEngine for PolyScript: a thin layer over @polyscript/browser's
 * PolyWorker, which already runs the OCCT kernel in a worker.
 *
 * Everything is written from the B-Rep the worker keeps after a build --
 * STEP exists because of it, and STL comes out of OCCT's mesher rather than
 * the tessellation that was good enough to look at. GLB is the kernel's glTF
 * writer, colours included.
 *
 * BREP is not offered: it is OCCT's own on-disk format, useful for handing a
 * shape back to this kernel and to nothing else. STEP is the interchange
 * format people actually want.
 */

import { PolyWorker } from '@polyscript/browser/worker';
import type { MeshData } from '@polyscript/core';
import type { BuildOptions, BuildResult, ExportFormat, ExportedFile, ModelEngine } from './types';

import { POLY_FORMATS as FORMATS } from './formats';

/** The kernel's name for a format where it differs from the menu's. */
const KERNEL_FORMAT: Record<string, 'stl' | 'step' | 'gltf'> = {
	stl: 'stl',
	step: 'step',
	glb: 'gltf'
};

export class PolyEngine implements ModelEngine {
	readonly type = 'poly' as const;
	private worker: PolyWorker | null = null;
	private built = false;
	/** The last build's input, so a worker thrown away after a failed export
	 *  can be rebuilt without the editor knowing. */
	private lastSource: string | null = null;
	private lastOverrides: Record<string, unknown> = {};

	private getWorker(): PolyWorker {
		if (this.worker) return this.worker;
		const w = new Worker(new URL('@polyscript/browser/worker-entry', import.meta.url), { type: 'module' });
		this.worker = new PolyWorker(w);
		return this.worker;
	}

	async build(source: string, options: BuildOptions = {}): Promise<BuildResult> {
		const overrides = options.overrides ?? {};
		this.lastSource = source;
		this.lastOverrides = overrides;
		const result = await this.getWorker().build(
			source,
			Object.keys(overrides).length > 0 ? { overrides } : {}
		);
		const common = {
			params: result.params,
			profile: result.profile,
			errors: result.errors.map((e) => ({
				// The hint is a separate field upstream; objhub's BuildError is one
				// line, so it joins here rather than being dropped.
				message: e.hint ? `${e.message} -- ${e.hint}` : e.message,
				phase: e.phase,
			}))
		};
		if (!result.ok || !result.mesh) {
			this.built = false;
			return { ok: false, ...common };
		}
		this.built = true;
		const mesh: MeshData = { ...result.mesh, color: result.color };
		const timing = result.timing;
		const cache = result.kernelCache;
		return {
			ok: true,
			mesh,
			info: result.info ?? null,
			stats: {
				ms: timing ? timing.evaluate + timing.tessellate : 0,
				cacheHits: cache?.hits,
				cacheTotal: cache ? cache.hits + cache.misses : undefined
			},
			...common
		};
	}

	formats(): ExportFormat[] {
		return FORMATS;
	}

	canExport(id: string): boolean {
		return this.built && id in KERNEL_FORMAT;
	}

	/**
	 * Write one file, replacing the worker if the write fails.
	 *
	 * A failed STEP write leaves OCCT's writer session broken, and every later
	 * exportStep in that worker fails too -- one bad shape would cost a
	 * long-lived editor its STEP button for the rest of the session
	 * (devel/TODO.md, occt-wasm). So a failure is treated as "this worker is
	 * spent": terminate it, rebuild the model in a fresh one, and try once
	 * more. A genuinely unexportable shape then fails twice and is reported,
	 * having cost one rebuild; a poisoned worker recovers invisibly.
	 */
	async exportFile(id: string): Promise<ExportedFile> {
		const kernelFormat = KERNEL_FORMAT[id];
		if (!kernelFormat) throw new Error(`poly: no ${id} export`);
		try {
			return await this.write(id, kernelFormat);
		} catch (first) {
			this.dispose();
			if (!this.lastSource) throw first;
			const rebuilt = await this.build(this.lastSource, { overrides: this.lastOverrides });
			if (!rebuilt.ok) throw first;
			try {
				return await this.write(id, kernelFormat);
			} catch (second) {
				// Twice on two different workers: the shape is the problem, not
				// the session. Leave no poisoned worker behind either way.
				this.dispose();
				throw second;
			}
		}
	}

	private async write(id: string, kernelFormat: 'stl' | 'step' | 'gltf'): Promise<ExportedFile> {
		const res = await this.getWorker().exportFile(kernelFormat);
		if (!res.ok || !res.data) throw new Error(res.error ?? 'Export failed');
		const format = FORMATS.find((f) => f.id === id)!;
		return { blob: new Blob([res.data], { type: res.mime }), extension: format.extension };
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		this.built = false;
	}
}
