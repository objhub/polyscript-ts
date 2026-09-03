/**
 * Tests for environment-independent export helpers in ocp-kernel.
 *
 * All tests use a mock OC kernel so they run without the real occt-wasm binary.
 */

import { describe, it, expect, vi } from 'vitest';

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
  };
}

// ---------------------------------------------------------------------------
// Export helpers (remain in @polyscript/core)
// ---------------------------------------------------------------------------

describe('exportSTLString', () => {
  it('returns the STL string from oc.exportStl', async () => {
    const { exportSTLString } = await import('../src/ocp-kernel/export.js');
    const oc = createMockOC();
    const result = exportSTLString(oc as any, 'shape-handle' as any);
    expect(result).toBe('solid mock\nendsolid mock');
    expect(oc.exportStl).toHaveBeenCalledWith('shape-handle', 0.1, true);
  });

  it('passes custom linearDeflection', async () => {
    const { exportSTLString } = await import('../src/ocp-kernel/export.js');
    const oc = createMockOC();
    exportSTLString(oc as any, 'sh' as any, 0.5);
    expect(oc.exportStl).toHaveBeenCalledWith('sh', 0.5, true);
  });
});

describe('exportSTLBuffer', () => {
  it('returns a Uint8Array encoded from the STL string', async () => {
    const { exportSTLBuffer } = await import('../src/ocp-kernel/export.js');
    const oc = createMockOC();
    const buf = exportSTLBuffer(oc as any, 'sh' as any);
    expect(buf).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(buf);
    expect(decoded).toBe('solid mock\nendsolid mock');
  });
});

describe('exportSTEPString', () => {
  it('returns the STEP string from oc.exportStep', async () => {
    const { exportSTEPString } = await import('../src/ocp-kernel/export.js');
    const oc = createMockOC();
    const result = exportSTEPString(oc as any, 'sh' as any);
    expect(result).toContain('ISO-10303-21');
    expect(oc.exportStep).toHaveBeenCalledWith('sh');
  });
});
