/**
 * One interface over the two things objhub can build: a PolyScript model
 * (B-Rep in an OCCT worker) and an OpenSCAD model (mesh from openscad.wasm).
 *
 * What the editor needs from either is the same -- a mesh to draw, figures for
 * the info panel, the list of files it can write, and the bytes of one of
 * those files -- so that is the whole interface. What differs stays behind it:
 * poly answers STEP/BREP because a B-Rep exists, scad does not and never will
 * (see devel/csg2brep-eval202609.md for why that is not worth changing).
 *
 * Rendering, saving (GLB + thumbnail) and the public page were already shared;
 * this closes the last gap, the editor's own call sites.
 */

import type { MeshData } from '@polyscript/core';
import type { Profile } from '@polyscript/core';

/** Figures for the viewer's info panel. Same shape as ModelViewer's
 *  ShapeSummary: kernel-derived for poly, mesh-derived for scad, where
 *  `topology` (B-Rep faces / edges / vertices) has no mesh equivalent and is
 *  left out rather than filled with triangle counts that mean something else. */
export interface ModelSummary {
	bbox?: { min: [number, number, number]; max: [number, number, number] };
	volume?: number;
	area?: number;
	solids?: number;
	is_valid?: boolean;
	topology?: { faces: number; edges: number; vertices: number };
}

export interface BuildError {
	message: string;
	/** Where the engine found it, when it knows: 'parse', 'eval', 'kernel', ... */
	phase?: string;
}

/** What the status line says about the build itself, as opposed to the shape:
 *  how long it took and, when the engine has a cache, how much of the model it
 *  did not have to rebuild. live has always shown this; objhub now does too. */
export interface BuildStats {
	ms: number;
	cacheHits?: number;
	cacheTotal?: number;
}

export interface BuildResult {
	ok: boolean;
	mesh?: MeshData;
	info?: ModelSummary | null;
	stats?: BuildStats;
	errors: BuildError[];
	/** poly only: declared parameters and the profile block. */
	params?: unknown[];
	profile?: Profile;
}

export interface BuildOptions {
	/** poly only: parameter overrides from the params panel. */
	overrides?: Record<string, unknown>;
}

/** A downloadable format. `hintKey` is an i18n key for the menu's second line. */
import type { ExportFormat } from './formats';
export type { ExportFormat };

/**
 * Which language a model is written in, and so which engine builds it.
 *
 * The host may well have its own name for this -- objhub stores it as a
 * column -- but the mapping is one to one and the engine owns the values it
 * can actually dispatch on.
 */
export type EngineType = 'poly' | 'scad';

export interface ExportedFile {
	blob: Blob;
	extension: string;
}

export interface ModelEngine {
	readonly type: EngineType;
	/** Build `source` and return what the editor shows. Never throws for a
	 *  model error; those come back as `ok: false` with `errors`. */
	build(source: string, options?: BuildOptions): Promise<BuildResult>;
	/** Everything this engine can write, in menu order. Availability at a given
	 *  moment is `canExport`. */
	formats(): ExportFormat[];
	/** Whether `exportFile(id)` would succeed right now (a build has happened
	 *  and the engine still holds what it needs). */
	canExport(id: string): boolean;
	/** Write one file from the last successful build. */
	exportFile(id: string): Promise<ExportedFile>;
	/** Release the worker. The engine is unusable afterwards. */
	dispose(): void;
}
