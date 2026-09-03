/**
 * PolyScript Web Worker entry point.
 *
 * Runs PolyScriptEngine inside a Web Worker to avoid blocking the UI thread.
 * Communicates with the main thread via postMessage.
 *
 * Usage: new Worker(new URL('@polyscript/browser/worker-entry', import.meta.url), { type: 'module' })
 */

import { PolyScriptEngine } from './index.js';
import type { BuildOptions, BuildError } from './index.js';

let engine: PolyScriptEngine | null = null;

export interface WorkerRequest {
  id: number;
  type: 'init' | 'build' | 'export';
  /** init */
  wasmUrl?: string;
  /** build */
  code?: string;
  buildOptions?: { overrides?: Record<string, unknown>; imports?: Record<string, string> };
  /** export */
  format?: 'stl' | 'step' | 'gltf' | 'brep';
  exportOptions?: { colorMap?: [string, [number, number, number, number]][]; color?: [number, number, number] };
}

export interface WorkerResponse {
  id: number;
  type: 'init' | 'build' | 'export';
  ok: boolean;
  /** build result */
  mesh?: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; edgePoints?: Float32Array };
  color?: [number, number, number];
  volume?: number;
  errors?: BuildError[];
  params?: any[];
  parameterSets?: Record<string, Record<string, unknown>>;
  profile?: { entries: { name: string; values: Record<string, any> }[] };
  /** export result */
  data?: ArrayBuffer | string;
  filename?: string;
  mime?: string;
  /** error */
  error?: string;
}

// Current build shape (retained in worker for subsequent export calls)
let lastShape: any = null;
let lastColorMap: Map<any, [number, number, number, number]> | null = null;
let lastColor: [number, number, number] | undefined;

async function handleInit(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    engine = await PolyScriptEngine.init(req.wasmUrl ? { wasm: req.wasmUrl } : undefined);
    return { id: req.id, type: 'init', ok: true };
  } catch (e: any) {
    return { id: req.id, type: 'init', ok: false, error: e.message ?? String(e) };
  }
}

function handleBuild(req: WorkerRequest): WorkerResponse {
  if (!engine) {
    return { id: req.id, type: 'build', ok: false, error: 'Engine not initialized' };
  }
  try {
    const opts: BuildOptions = {};
    if (req.buildOptions?.overrides) opts.overrides = req.buildOptions.overrides;
    if (req.buildOptions?.imports) {
      const imports = req.buildOptions.imports;
      opts.importResolver = (path: string) => imports[path] ?? null;
    }

    const result = engine.build(req.code ?? '', opts);

    if (!result.success) {
      lastShape = null;
      lastColorMap = null;
      lastColor = undefined;
      return {
        id: req.id,
        type: 'build',
        ok: false,
        errors: result.errors,
        params: result.params,
        parameterSets: result.parameterSets,
        profile: result.profile,
      };
    }

    lastShape = result.shape;
    lastColorMap = result.colorMap;
    lastColor = result.color;

    // Tessellate 3D shape if available, merge line data for open wires
    const mesh = result.shape
      ? engine.tessellate(result.shape)
      : { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };
    if (result.lineMesh) {
      mesh.lines = result.lineMesh;
    }
    let volume: number | undefined;
    if (result.shape) {
      try { volume = engine.kernel.getVolume(result.shape); } catch { /* non-solid */ }
    }
    return {
      id: req.id,
      type: 'build',
      ok: true,
      mesh,
      color: result.color,
      volume,
      errors: result.errors,
      params: result.params,
      parameterSets: result.parameterSets,
      profile: result.profile,
    };
  } catch (e: any) {
    lastShape = null;
    lastColorMap = null;
    lastColor = undefined;
    return { id: req.id, type: 'build', ok: false, error: e.message ?? String(e) };
  }
}

function handleExport(req: WorkerRequest): WorkerResponse {
  if (!engine || !lastShape) {
    return { id: req.id, type: 'export', ok: false, error: 'No shape to export' };
  }
  try {
    let data: Uint8Array | string;
    let filename: string;
    let mime: string;

    switch (req.format) {
      case 'stl':
        data = engine.exportSTL(lastShape);
        filename = 'model.stl';
        mime = 'application/octet-stream';
        break;
      case 'step':
        data = engine.exportSTEP(lastShape);
        filename = 'model.step';
        mime = 'application/STEP';
        break;
      case 'gltf': {
        const opts: any = {};
        if (lastColorMap && lastColorMap.size > 0) opts.colorMap = lastColorMap;
        else if (lastColor) opts.color = lastColor;
        data = engine.exportGLTF(lastShape, opts);
        filename = 'model.glb';
        mime = 'model/gltf-binary';
        break;
      }
      case 'brep':
        data = engine.exportBREP(lastShape);
        filename = 'model.brep';
        mime = 'application/octet-stream';
        break;
      default:
        return { id: req.id, type: 'export', ok: false, error: `Unknown format: ${req.format}` };
    }

    const buffer = typeof data === 'string' ? data : data.buffer;
    return { id: req.id, type: 'export', ok: true, data: buffer as any, filename, mime };
  } catch (e: any) {
    return { id: req.id, type: 'export', ok: false, error: e.message ?? String(e) };
  }
}

// Catch errors inside the worker and log them from worker context
self.onerror = (msg, src, lineno, colno, error) => {
  console.error('[PolyWorker:inner] onerror:', msg, src, lineno, colno, error);
};

// Catch unhandled promise rejections inside the worker
self.addEventListener('unhandledrejection', (e) => {
  console.error('[PolyWorker:inner] unhandled rejection:', e.reason);
});

// Worker message handler
const ctx = globalThis as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (msg: any, transfer?: Transferable[]) => void };
ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  let resp: WorkerResponse;

  switch (req.type) {
    case 'init':
      resp = await handleInit(req);
      break;
    case 'build':
      resp = handleBuild(req);
      break;
    case 'export':
      resp = handleExport(req);
      break;
    default:
      resp = { id: req.id, type: req.type, ok: false, error: `Unknown request type: ${req.type}` };
  }

  // Transfer typed arrays for zero-copy
  const transferables: Transferable[] = [];
  if (resp.mesh) {
    transferables.push(
      resp.mesh.positions.buffer,
      resp.mesh.normals.buffer,
      resp.mesh.indices.buffer,
    );
    if (resp.mesh.edgePoints) {
      transferables.push(resp.mesh.edgePoints.buffer);
    }
  }
  if (resp.data instanceof ArrayBuffer) {
    transferables.push(resp.data);
  }

  ctx.postMessage(resp, transferables);
};
