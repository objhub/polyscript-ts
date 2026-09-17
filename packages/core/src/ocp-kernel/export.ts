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

import { renderMultiviewSVG, renderShapeSVG } from 'occt-wasm';
import type { ViewName } from 'occt-wasm';
import type { OC, Shape } from './types.js';
import type { ColorPart } from './color-parts.js';

// ---------------------------------------------------------------------------
// Mesh data returned by tessellate()
// ---------------------------------------------------------------------------

export interface TessellationMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** CAD edge polylines as line-segment pairs (XYZ interleaved). Absent when
   *  tessellated with `edges: false`. */
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
  /** Single color for the whole shape (RGB 0..1). */
  color?: [number, number, number];
  /** Per-part colors from colorParts(); takes precedence over `color`. */
  parts?: ColorPart[];
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

/**
 * Return the STL content as binary STL (80-byte header, uint32 facet count,
 * 50 bytes per facet): about 1/6 the size of ASCII for the same mesh, and
 * what slicers expect.
 *
 * Built from our own tessellation rather than `oc.exportStl(.., false)`: that
 * one returns the bytes through an Embind std::string, which JS decodes as
 * UTF-8 and so every byte >= 0x80 comes back as U+FFFD. Same mesher and
 * deflections as StlAPI_Writer, so the triangles match the ASCII export.
 */
export function exportSTLBuffer(
  oc: OC,
  shape: Shape,
  linearDeflection: number = 0.1,
): Uint8Array {
  const { positions, indices } = tessellate(oc, shape, { linearDeflection, edges: false });
  const facets = Math.floor(indices.length / 3);
  const bytes = new Uint8Array(84 + 50 * facets);
  const view = new DataView(bytes.buffer);
  // The header must not start with "solid", which readers take to mean ASCII.
  bytes.set(new TextEncoder().encode('PolyScript binary STL').subarray(0, 80));
  view.setUint32(80, facets, true);

  let off = 84;
  for (let t = 0; t < facets; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    // Facet normal from the winding; the per-vertex normals from the mesher
    // are smoothed and not what STL wants.
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }
    view.setFloat32(off, nx, true);
    view.setFloat32(off + 4, ny, true);
    view.setFloat32(off + 8, nz, true);
    off += 12;
    for (const i of [a, b, c]) {
      view.setFloat32(off, positions[i], true);
      view.setFloat32(off + 4, positions[i + 1], true);
      view.setFloat32(off + 8, positions[i + 2], true);
      off += 12;
    }
    view.setUint16(off, 0, true); // attribute byte count
    off += 2;
  }
  return bytes;
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

/** Write an STL file; binary unless `ascii` is set. */
export async function exportSTL(
  oc: OC,
  shape: Shape,
  filePath: string,
  linearDeflection?: number,
  ascii = false,
): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  await ensureParentDir(filePath);
  if (ascii) {
    writeFileSync(filePath, exportSTLString(oc, shape, linearDeflection), 'utf-8');
  } else {
    writeFileSync(filePath, exportSTLBuffer(oc, shape, linearDeflection));
  }
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

/** The viewpoints an SVG export can be asked for. */
export const SVG_VIEWS: readonly ViewName[] = [
  'front', 'back', 'top', 'bottom', 'left', 'right', 'iso',
] as const;

export interface SvgExportOptions {
  /** Viewpoints to draw. One name renders a single panel; several render a
   *  grid. Default: front / top / right / iso. */
  views?: ViewName[];
  /** Panel width and height in px (default 240 each). */
  width?: number;
  height?: number;
  /** Panels per row in a grid (default 2). */
  columns?: number;
  /** Draw occluded edges dashed (default true). */
  showHidden?: boolean;
  /** Edge sampling deflection in model units. Default ~0.2% of the bounding
   *  box diagonal, so the output does not depend on the model's scale. */
  deflection?: number;
}

/** Render a Shape as an SVG line drawing: OCCT hidden-line removal per view,
 *  visible edges solid and occluded edges dashed.
 *
 *  This is a picture, not a measurement — the edges are sampled at
 *  `deflection` and projected to pixel coordinates. For numbers, measure the
 *  shape itself. */
export function exportSVGString(
  oc: OC,
  shape: Shape,
  options: SvgExportOptions = {},
): string {
  const { views, ...rest } = options;
  if (views && views.length === 1) {
    return renderShapeSVG(oc, shape, views[0], rest);
  }
  return renderMultiviewSVG(oc, shape, views ? { ...rest, views } : rest);
}

export async function exportSVG(
  oc: OC,
  shape: Shape,
  filePath: string,
  options: SvgExportOptions = {},
): Promise<void> {
  const data = exportSVGString(oc, shape, options);
  const { writeFileSync } = await import('node:fs');
  await ensureParentDir(filePath);
  writeFileSync(filePath, data, 'utf-8');
}

export interface ExportShapeOptions {
  linearDeflection?: number;
  /** Write ASCII STL instead of binary. */
  asciiStl?: boolean;
  /** Angular deflection for glTF tessellation. Ignored by STL and STEP. */
  angularDeflection?: number;
  /** Single colour for the whole shape (RGB 0..1). glTF only. */
  color?: [number, number, number];
  /** Per-part colours from colorParts(). glTF only; wins over `color`.
   *  STL and STEP carry no colour, so passing these is harmless there. */
  parts?: ColorPart[];
  /** Viewpoints and panel options for SVG. Ignored by every other format. */
  svg?: SvgExportOptions;
}

export async function exportShape(
  oc: OC,
  shape: Shape,
  filePath: string,
  options: ExportShapeOptions = {},
): Promise<void> {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.stl')) {
    await exportSTL(oc, shape, filePath, options.linearDeflection, options.asciiStl);
  } else if (ext.endsWith('.step') || ext.endsWith('.stp')) {
    await exportSTEP(oc, shape, filePath);
  } else if (ext.endsWith('.glb')) {
    await exportGLTF(oc, shape, filePath, {
      linearDeflection: options.linearDeflection,
      angularDeflection: options.angularDeflection,
      color: options.color,
      parts: options.parts,
    });
  } else if (ext.endsWith('.svg')) {
    await exportSVG(oc, shape, filePath, options.svg ?? {});
  } else if (ext.endsWith('.gltf')) {
    // OCCT's XCAF writer emits the binary container only. Writing those bytes
    // to a .gltf file would mislabel them, so say so instead of guessing.
    throw new Error(`glTF is written as the binary container; use .glb: ${filePath}`);
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

/** Export a Shape as glTF (GLB) binary.
 *
 * With `options.parts` each part becomes its own colored node and `shape` is
 * not added (the parts together are the shape). Otherwise the whole shape
 * gets `options.color`. */
export function exportGLTFBuffer(
  oc: OC,
  shape: Shape,
  options?: ExportOptions,
): Uint8Array {
  const doc = oc.createXCAFDocument();
  try {
    const fallback: [number, number, number] = options?.color ?? [0.6, 0.6, 0.65];
    const parts = options?.parts;
    if (parts && parts.length > 0) {
      for (const part of parts) {
        doc.addShape(part.shape, { color: part.color ?? fallback });
      }
    } else {
      doc.addShape(shape, { color: fallback });
    }
    return doc.exportGLTF({
      linearDeflection: options?.linearDeflection ?? 0.1,
      angularDeflection: options?.angularDeflection ?? 0.5,
    });
  } finally {
    doc.close();
  }
}

/** Write a glTF binary (.glb) file.
 *
 * OCCT's XCAF writer produces the binary container only, so there is no .gltf
 * counterpart. Unlike STL and STEP this carries colour, which is the reason to
 * reach for it: pass `parts` from colorParts() to keep per-part colours.
 */
export async function exportGLTF(
  oc: OC,
  shape: Shape,
  filePath: string,
  options?: ExportOptions,
): Promise<void> {
  const data = exportGLTFBuffer(oc, shape, options);
  const { writeFileSync } = await import('node:fs');
  await ensureParentDir(filePath);
  writeFileSync(filePath, data);
}

// ---------------------------------------------------------------------------
// Tessellation — produces Three.js-compatible BufferGeometry data
// ---------------------------------------------------------------------------

export interface TessellateOptions extends Pick<ExportOptions, 'linearDeflection' | 'angularDeflection'> {
  /** Also compute `edgePoints` (default true). Off when the caller draws
   *  edges from another shape, e.g. per-part meshes under one fused outline. */
  edges?: boolean;
}

/** Tessellate a Shape into positions, normals, and indices arrays. */
export function tessellate(
  oc: OC,
  shape: Shape,
  options?: TessellateOptions,
): TessellationMesh {
  const deflection = options?.linearDeflection ?? 0.1;
  const mesh = oc.tessellate(shape, {
    linearDeflection: deflection,
    angularDeflection: options?.angularDeflection ?? 0.5,
  });
  if (options?.edges === false) {
    return { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices };
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    edgePoints: edgeSegments(oc, shape, deflection),
  };
}

/** CAD edges of `shape` sampled at `deflection`, as line-segment pairs for
 *  THREE.LineSegments. */
export function edgeSegments(oc: OC, shape: Shape, deflection: number = 0.1): Float32Array {
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
  return segPts;
}
