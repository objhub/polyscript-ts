/**
 * OpenSCAD in a Web Worker.
 *
 * openscad.wasm's `callMain` is synchronous and takes anywhere from 50ms to
 * many seconds; on the main thread that froze the editor for the whole render.
 * The poly side has always run in a worker (PolyWorker), and this gives scad
 * the same shape: one request in, one response out, correlated by id.
 *
 * Each build instantiates a fresh module. Emscripten's main() can run once per
 * instance, and a fresh MEMFS is also what makes builds independent of each
 * other. The compiled module and the font bytes are cached across builds.
 */

import { parseOFF } from './off-parser';
import { meshSummary } from './mesh-info';

export interface ScadBuildRequest {
	id: number;
	type: 'build';
	code: string;
	/**
	 * Where to load OpenSCAD from, and which font to install.
	 *
	 * Supplied by the host rather than bundled: openscad.wasm is GPL, this
	 * package is Apache-2.0, and 9.6 MB is not something to hand to a caller
	 * who only ever builds PolyScript. The worker caches whatever it is given.
	 */
	openscadUrl: string;
	fontUrl?: string;
}

export type ScadRequest = ScadBuildRequest;

export interface ScadBuildResponse {
	id: number;
	type: 'build';
	ok: boolean;
	/** Transferred, not copied: the arrays move to the main thread. */
	mesh?: {
		positions: Float32Array;
		normals: Float32Array;
		indices: Uint32Array;
		colors?: Float32Array;
	};
	info?: ReturnType<typeof meshSummary>;
	error?: string;
	/** OpenSCAD's own console output, for the message when it fails. */
	log?: string;
}

type OpenSCADFactory = (opts: Record<string, unknown>) => Promise<any>;

let factory: OpenSCADFactory | null = null;
let fontBytes: Uint8Array | null = null;

async function loadFactory(url: string): Promise<OpenSCADFactory> {
	if (factory) return factory;
	const mod = await import(/* @vite-ignore */ url);
	factory = mod.default as OpenSCADFactory;
	return factory;
}

async function loadFont(url: string): Promise<Uint8Array> {
	if (fontBytes) return fontBytes;
	const res = await fetch(url, { credentials: 'omit' });
	if (!res.ok) throw new Error(`font: HTTP ${res.status}`);
	fontBytes = new Uint8Array(await res.arrayBuffer());
	return fontBytes;
}

async function build(req: ScadBuildRequest): Promise<Omit<ScadBuildResponse, 'id' | 'type'>> {
	const code = req.code;
	const [OpenSCAD, font] = await Promise.all([
		loadFactory(req.openscadUrl),
		req.fontUrl ? loadFont(req.fontUrl) : Promise.resolve(null)
	]);
	const log: string[] = [];
	const instance = await OpenSCAD({
		noInitialRun: true,
		print: (s: string) => log.push(s),
		printErr: (s: string) => log.push(s)
	});

	// Only when the host supplied one: text() then renders in whatever the
	// wasm build ships with, rather than failing.
	if (font) {
		try { instance.FS.mkdir('/fonts'); } catch { /* exists */ }
		instance.FS.writeFile(
			'/fonts/fonts.conf',
			'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>/fonts</dir></fontconfig>'
		);
		instance.FS.writeFile('/fonts/NotoSansJP-Regular.ttf', font);
		instance.ENV['FONTCONFIG_FILE'] = '/fonts/fonts.conf';
		instance.ENV['FONTCONFIG_PATH'] = '/fonts';
	}
	instance.FS.chdir('/');
	instance.FS.writeFile('/main.scad', code);

	// OFF rather than STL: it keeps per-face colours from color(), which is what
	// makes a scad model look like a poly one in the viewer, the GLB and the
	// thumbnail (both the plain and the lazy-union path write them; measured on
	// this wasm build). lazy-union leaves disjoint top-level objects unfused,
	// which is 5-7x faster on multi-part models and changes nothing visible.
	let exitCode: number;
	try {
		exitCode = instance.callMain(['/main.scad', '-o', '/output.off', '--backend=manifold', '--enable=lazy-union']);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e), log: log.join('\n') };
	}
	if (exitCode !== 0) {
		// The useful line is usually the last ERROR/WARNING OpenSCAD printed.
		const tail = log.filter((l) => /ERROR|WARNING/.test(l)).pop() ?? log[log.length - 1] ?? `exit ${exitCode}`;
		return { ok: false, error: tail, log: log.join('\n') };
	}

	const off: Uint8Array = instance.FS.readFile('/output.off');
	const mesh = parseOFF(off);
	const info = meshSummary(mesh);
	return {
		ok: true,
		mesh: { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, colors: mesh.colors },
		info,
		log: log.join('\n')
	};
}

self.onmessage = async (e: MessageEvent<ScadRequest>) => {
	const req = e.data;
	if (req.type !== 'build') return;
	const result = await build(req);
	const response: ScadBuildResponse = { id: req.id, type: 'build', ...result };
	const transfer: ArrayBuffer[] = [];
	if (response.mesh) {
		for (const a of [response.mesh.positions, response.mesh.normals, response.mesh.indices, response.mesh.colors]) {
			if (a && a.buffer.byteLength > 0 && !transfer.includes(a.buffer as ArrayBuffer)) transfer.push(a.buffer as ArrayBuffer);
		}
	}
	(self as unknown as Worker).postMessage(response, transfer);
};
