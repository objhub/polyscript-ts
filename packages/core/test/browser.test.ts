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
    // Since occt-wasm 5.3.0 the kernel writes binary STL itself and returns
    // bytes; `ascii: true` still returns the text form.
    exportStl: vi.fn((_shape: unknown, _ld: number, ascii?: boolean) =>
      ascii ? 'solid mock\nendsolid mock' : new Uint8Array(84 + 50),
    ),
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
  it('asks the kernel for binary STL rather than assembling it', async () => {
    // Hand-built until occt-wasm 5.3.0, when the binary path stopped mangling
    // bytes through a UTF-8 std::string (andymai/occt-wasm#308). Verified
    // against the old implementation on a box, sphere and torus: same facet
    // count, same byte length, same volume when read back.
    const { exportSTLBuffer } = await import('../src/ocp-kernel/export.js');
    const oc = createMockOC();
    const buf = exportSTLBuffer(oc as any, 'sh' as any, 0.5);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(oc.exportStl).toHaveBeenCalledWith('sh', 0.5, false);
    expect(oc.tessellate).not.toHaveBeenCalled();
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
