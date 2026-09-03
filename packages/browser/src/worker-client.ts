/**
 * PolyScript Worker client — main-thread API for communicating with the
 * PolyScriptEngine running inside a Web Worker.
 *
 * Usage:
 *   import { PolyWorker } from '@polyscript/browser/worker';
 *   const worker = new PolyWorker('/polyscript-worker.js', '/occt-wasm.wasm');
 *   await worker.init();
 *   const result = await worker.build(code);
 */

import type { BuildError } from './index.js';
import type { WorkerRequest, WorkerResponse } from './worker-entry.js';

export interface WorkerBuildResult {
  ok: boolean;
  mesh?: {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    edgePoints?: Float32Array;
    lines?: { positions: Float32Array; indices: Uint32Array };
  };
  color?: [number, number, number];
  volume?: number;
  errors: BuildError[];
  params: any[];
  parameterSets: Record<string, Record<string, unknown>>;
  profile?: { entries: { name: string; values: Record<string, any> }[] };
}

export interface WorkerExportResult {
  ok: boolean;
  data?: ArrayBuffer | string;
  filename?: string;
  mime?: string;
  error?: string;
}

export class PolyWorker {
  private worker: Worker;
  private wasmUrl: string | undefined;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>();
  private initPromise: Promise<void> | null = null;
  private _ready = false;
  private pendingBuildIds = new Set<number>();

  /**
   * @param workerUrl  URL or Worker instance for the worker script
   * @param wasmUrl    URL of the occt-wasm.wasm file (passed to the worker for init)
   */
  constructor(workerUrl: string | URL | Worker, wasmUrl?: string) {
    if (workerUrl instanceof Worker) {
      this.worker = workerUrl;
    } else {
      this.worker = new Worker(workerUrl, { type: 'module' });
    }
    this.wasmUrl = wasmUrl;

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resp = e.data;
      const entry = this.pending.get(resp.id);
      if (entry) {
        this.pending.delete(resp.id);
        entry.resolve(resp);
      }
    };
    this.worker.onerror = (e) => {
      console.error('[PolyWorker] error:', e.message, e.filename, e.lineno, e.colno, e.error);
      for (const [, entry] of this.pending) {
        entry.reject(new Error(e.message || `Worker error at ${e.filename}:${e.lineno}:${e.colno}`));
      }
      this.pending.clear();
    };
  }

  get ready(): boolean {
    return this._ready;
  }

  /** Initialize the engine in the worker. Call once before build/export. */
  async init(): Promise<void> {
    if (this._ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const resp = await this.send({ type: 'init', wasmUrl: this.wasmUrl });
    if (!resp.ok) throw new Error(resp.error ?? 'Worker init failed');
    this._ready = true;
  }

  /** Build code and return tessellated mesh.
   *  Cancels any previously pending build request. */
  async build(
    code: string,
    options?: { overrides?: Record<string, unknown>; imports?: Record<string, string> },
  ): Promise<WorkerBuildResult> {
    await this.init();
    // Cancel previous pending build requests (stale results)
    for (const id of this.pendingBuildIds) {
      const entry = this.pending.get(id);
      if (entry) {
        this.pending.delete(id);
        entry.reject(new Error('Build superseded'));
      }
    }
    this.pendingBuildIds.clear();
    const buildId = this.nextId;
    this.pendingBuildIds.add(buildId);
    const resp = await this.send({ type: 'build', code, buildOptions: options });
    this.pendingBuildIds.delete(buildId);
    return {
      ok: resp.ok,
      mesh: resp.mesh,
      color: resp.color,
      volume: resp.volume,
      errors: resp.errors ?? [],
      params: resp.params ?? [],
      parameterSets: resp.parameterSets ?? {},
      profile: resp.profile,
    };
  }

  /** Export last successful build result. */
  async exportFile(
    format: 'stl' | 'step' | 'gltf' | 'brep',
  ): Promise<WorkerExportResult> {
    await this.init();
    const resp = await this.send({ type: 'export', format });
    return {
      ok: resp.ok,
      data: resp.data,
      filename: resp.filename,
      mime: resp.mime,
      error: resp.error,
    };
  }

  /** Terminate the worker. */
  terminate(): void {
    this.worker.terminate();
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
    this._ready = false;
  }

  private send(partial: Omit<WorkerRequest, 'id'>): Promise<WorkerResponse> {
    const id = this.nextId++;
    const req = { ...partial, id } as WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(req);
    });
  }
}
