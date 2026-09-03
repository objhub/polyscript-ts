/**
 * Tests for the PolyScriptEngine high-level class.
 *
 * Uses a mock OC kernel so they run without the real occt-wasm binary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock OC kernel
// ---------------------------------------------------------------------------

function createMockOC() {
  return {
    exportStl: vi.fn((_shape: unknown, _ld: number, _ascii: boolean) => 'solid mock\nendsolid mock'),
    exportStep: vi.fn((_shape: unknown) => 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;'),
    toBREP: vi.fn((_shape: unknown) => 'CASCADE_BREP_DATA'),
    fromBREP: vi.fn((_data: string) => 'restored-shape-handle'),
    createXCAFDocument: vi.fn(() => ({
      addShape: vi.fn(),
      exportGLTF: vi.fn(() => new Uint8Array([0x67, 0x6c, 0x54, 0x46])),
      close: vi.fn(),
    })),
    tessellate: vi.fn((_shape: unknown, _opts: unknown) => ({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    })),
    wireframe: vi.fn((_shape: unknown, _deflection?: number) => ({
      points: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0]),
      edgeGroups: new Int32Array([0, 2, 1, 6, 2, 2]),
      pointCount: 12,
      edgeCount: 2,
    })),
  };
}

// We need to mock initOC so the engine can be created without real WASM.
vi.mock('@polyscript/core/ocp-kernel', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    initOC: vi.fn(async () => createMockOC()),
    setOC: vi.fn(),
  };
});

describe('PolyScriptEngine', () => {
  let PolyScriptEngine: typeof import('../src/index.js').PolyScriptEngine;

  beforeEach(async () => {
    const mod = await import('../src/index.js');
    PolyScriptEngine = mod.PolyScriptEngine;
  });

  describe('build() - parse error', () => {
    it('returns errors for invalid syntax', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.build('box(((');
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].phase).toBe('parse');
      expect(result.shape).toBeNull();
    });
  });

  describe('build() - returns shape', () => {
    it('returns a shape handle on success', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.build('box(10, 20, 30)');
      expect(result.shape).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('check()', () => {
    it('returns no errors for valid syntax', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.check('box(10, 20, 30)');
      expect(result.errors).toHaveLength(0);
    });

    it('returns parse errors for invalid syntax', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.check('box(((');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].phase).toBe('parse');
    });
  });

  describe('extractParams()', () => {
    it('extracts @param annotations', async () => {
      const engine = await PolyScriptEngine.init();
      const source = `@param min:1 max:100
$width = 10
box($width, 20, 30)
`;
      const paramSet = engine.extractParams(source);
      expect(paramSet.params.length).toBeGreaterThanOrEqual(1);
      expect(paramSet.params[0].name).toBe('width');
    });
  });

  describe('kernel', () => {
    it('provides access to the underlying OC kernel', async () => {
      const engine = await PolyScriptEngine.init();
      expect(engine.kernel).toBeDefined();
      expect(typeof engine.kernel.exportStl).toBe('function');
    });
  });

  describe('exportSTL()', () => {
    it('delegates to exportSTLBuffer', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.exportSTL('mock-shape' as any);
      expect(result).toBeInstanceOf(Uint8Array);
      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe('solid mock\nendsolid mock');
    });
  });

  describe('exportSTEP()', () => {
    it('delegates to exportSTEPString', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.exportSTEP('mock-shape' as any);
      expect(result).toContain('ISO-10303-21');
    });
  });

  describe('exportBREP()', () => {
    it('delegates to exportBREPString', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.exportBREP('mock-shape' as any);
      expect(result).toBe('CASCADE_BREP_DATA');
    });
  });

  describe('importBREP()', () => {
    it('delegates to importBREP from ocp-kernel', async () => {
      const engine = await PolyScriptEngine.init();
      const shape = engine.importBREP('CASCADE_BREP_DATA');
      expect(shape).toBe('restored-shape-handle');
    });
  });

  describe('exportGLTF()', () => {
    it('returns a Uint8Array with glTF magic bytes', async () => {
      const engine = await PolyScriptEngine.init();
      const result = engine.exportGLTF('mock-shape' as any);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result[0]).toBe(0x67);
      expect(result[1]).toBe(0x6c);
    });
  });

  describe('tessellate()', () => {
    it('returns positions, normals, and indices', async () => {
      const engine = await PolyScriptEngine.init();
      const mesh = engine.tessellate('mock-shape' as any);
      expect(mesh.positions).toBeInstanceOf(Float32Array);
      expect(mesh.normals).toBeInstanceOf(Float32Array);
      expect(mesh.indices).toBeInstanceOf(Uint32Array);
      expect(mesh.positions.length).toBe(9);
      expect(mesh.normals.length).toBe(9);
      expect(mesh.indices.length).toBe(3);
    });
  });
});
