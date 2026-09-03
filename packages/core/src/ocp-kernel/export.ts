/**
 * OCP Kernel export -- STL, STEP, BREP, glTF, and tessellation.
 * Uses occt-wasm: kernel.exportStl(), kernel.exportStep(), etc.
 * Unlike opencascade.js, occt-wasm returns strings directly (no MEMFS).
 *
 * Environment-independent functions (xxxString / xxxBuffer) work in both
 * Node.js and browser contexts. The file-writing helpers (exportSTL,
 * exportSTEP, exportShape) use dynamic imports of node:fs / node:path so
 * they only pull in Node APIs when actually called.
 */

import type { OC, Shape } from './types.js';

// ---------------------------------------------------------------------------
// Mesh data returned by tessellate()
// ---------------------------------------------------------------------------

export interface TessellationMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edgePoints?: Float32Array;
  /** Line geometry for open wires (rendered as LineSegments). */
  lines?: {
    positions: Float32Array;
    /** Index pairs forming line segments: [i0,i1, i2,i3, ...]. */
    indices: Uint32Array;
  };
}

export interface ExportOptions {
  linearDeflection?: number;
  angularDeflection?: number;
  color?: [number, number, number];
  colorMap?: Map<Shape, [number, number, number, number]>;
}

// ---------------------------------------------------------------------------
// Environment-independent helpers
// ---------------------------------------------------------------------------

/** Return the STL content as an ASCII string. */
export function exportSTLString(
  oc: OC,
  shape: Shape,
  linearDeflection: number = 0.1,
): string {
  return oc.exportStl(shape, linearDeflection, true);
}

/** Return the STL content as a Uint8Array (UTF-8 encoded). */
export function exportSTLBuffer(
  oc: OC,
  shape: Shape,
  linearDeflection: number = 0.1,
): Uint8Array {
  const str = exportSTLString(oc, shape, linearDeflection);
  return new TextEncoder().encode(str);
}

/** Return the STEP content as a string. */
export function exportSTEPString(oc: OC, shape: Shape): string {
  return oc.exportStep(shape);
}

// ---------------------------------------------------------------------------
// Node.js file-writing helpers (async -- dynamic import of node:fs/node:path)
// ---------------------------------------------------------------------------

/** Create the parent directory of `filePath` when it is missing.
 *
 * Guarded rather than a bare `mkdirSync(dir, { recursive: true })`: Bun on
 * Windows throws EEXIST from that call when the directory already exists, while
 * Node and Bun on POSIX return silently. `poly build m.poly -o out.stl` has
 * dirname "." and died in the release smoke test with
 * `Evaluation error: EEXIST: file already exists, mkdir '.'`.
 *
 * Dynamic imports, like the callers: a static `node:fs` import here would be
 * resolved by the bundler and break the browser build (see browser-bundling
 * test in packages/core/test).
 */
async function ensureParentDir(filePath: string): Promise<void> {
  const { existsSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const dir = dirname(filePath);
  if (!dir || dir === '.' || existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
}

export async function exportSTL(
  oc: OC,
  shape: Shape,
  filePath: string,
  linearDeflection?: number,
): Promise<void> {
  const data = exportSTLString(oc, shape, linearDeflection);
  const { writeFileSync } = await import('node:fs');
  await ensureParentDir(filePath);
  writeFileSync(filePath, data, 'utf-8');
}

export async function exportSTEP(
  oc: OC,
  shape: Shape,
  filePath: string,
): Promise<void> {
  const data = exportSTEPString(oc, shape);
  const { writeFileSync } = await import('node:fs');
  await ensureParentDir(filePath);
  writeFileSync(filePath, data, 'utf-8');
}

export async function exportShape(
  oc: OC,
  shape: Shape,
  filePath: string,
  linearDeflection?: number,
): Promise<void> {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.stl')) {
    await exportSTL(oc, shape, filePath, linearDeflection);
  } else if (ext.endsWith('.step') || ext.endsWith('.stp')) {
    await exportSTEP(oc, shape, filePath);
  } else {
    throw new Error(`Unsupported export format: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// BREP serialization / deserialization
// ---------------------------------------------------------------------------

/** Serialize a Shape to BREP string. */
export function exportBREPString(oc: OC, shape: Shape): string {
  return oc.toBREP(shape);
}

/** Deserialize a BREP string back to a Shape. */
export function importBREP(oc: OC, data: string): Shape {
  return oc.fromBREP(data);
}

// ---------------------------------------------------------------------------
// glTF (GLB) export via XCAF document
// ---------------------------------------------------------------------------

/** Export a Shape as glTF (GLB) binary. */
export function exportGLTFBuffer(
  oc: OC,
  shape: Shape,
  options?: ExportOptions,
): Uint8Array {
  const doc = oc.createXCAFDocument();
  try {
    const colorMap = options?.colorMap;
    if (colorMap && colorMap.size > 0) {
      // Multi-part colored export: add each sub-shape with its color
      for (const [subShape, [r, g, b, _a]] of colorMap) {
        doc.addShape(subShape, { color: [r, g, b] });
      }
      // Add the combined shape without color for parts not in colorMap
      // (the XCAF document handles the hierarchy)
    } else {
      // Single-color export
      doc.addShape(shape, {
        color: options?.color ?? [0.6, 0.6, 0.65],
      });
    }
    return doc.exportGLTF({
      linearDeflection: options?.linearDeflection ?? 0.1,
      angularDeflection: options?.angularDeflection ?? 0.5,
    });
  } finally {
    doc.close();
  }
}

// ---------------------------------------------------------------------------
// Tessellation — produces Three.js-compatible BufferGeometry data
// ---------------------------------------------------------------------------

/** Tessellate a Shape into positions, normals, and indices arrays. */
export function tessellate(
  oc: OC,
  shape: Shape,
  options?: Pick<ExportOptions, 'linearDeflection' | 'angularDeflection'>,
): TessellationMesh {
  const deflection = options?.linearDeflection ?? 0.1;
  const mesh = oc.tessellate(shape, {
    linearDeflection: deflection,
    angularDeflection: options?.angularDeflection ?? 0.5,
  });
  const edges = oc.wireframe(shape, deflection);
  // Convert polyline points to line-segment pairs for THREE.LineSegments
  const pts = edges.points;
  const groups = edges.edgeGroups;
  let segCount = 0;
  for (let i = 0; i < groups.length; i += 3) {
    const vertCount = groups[i + 1] / 3;
    if (vertCount >= 2) segCount += (vertCount - 1) * 2;
  }
  const segPts = new Float32Array(segCount * 3);
  let out = 0;
  for (let i = 0; i < groups.length; i += 3) {
    const start = groups[i];
    const vertCount = groups[i + 1] / 3;
    for (let v = 0; v < vertCount - 1; v++) {
      const a = start + v * 3;
      const b = start + (v + 1) * 3;
      segPts[out++] = pts[a]; segPts[out++] = pts[a + 1]; segPts[out++] = pts[a + 2];
      segPts[out++] = pts[b]; segPts[out++] = pts[b + 1]; segPts[out++] = pts[b + 2];
    }
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    edgePoints: segPts,
  };
}
