/**
 * OCP Kernel types — shared type definitions for all sub-modules.
 * Uses occt-wasm OcctKernel instead of opencascade.js.
 */

import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm';

// Re-export the kernel type for external use
export type OC = OcctKernel;

// Re-export occt-wasm types
export type { ShapeHandle, Vec3 };

/** Opaque shape handles — all are ShapeHandle in occt-wasm */
export type Shape = ShapeHandle;
export type Wire = ShapeHandle;
export type Face = ShapeHandle;
export type Edge = ShapeHandle;
export type Vertex = ShapeHandle;

/** Vec3-based point/direction types (replace gp_Pnt, gp_Dir, gp_Vec) */
export type Pnt = Vec3;
export type Dir = Vec3;
export type Vec = Vec3;

/** Plane definition (replaces gp_Pln) */
export interface Pln {
  origin: Vec3;
  normal: Vec3;
  xDir: Vec3;
  yDir: Vec3;
}

export type Ax1 = { point: Vec3; direction: Vec3 };
export type Ax2 = { point: Vec3; direction: Vec3; xDir: Vec3 };
export type Ax3 = { point: Vec3; direction: Vec3; xDir: Vec3 };

export interface BoundingBox {
  xmin: number; ymin: number; zmin: number;
  xmax: number; ymax: number; zmax: number;
  xlen: number; ylen: number; zlen: number;
}

// ---------------------------------------------------------------------------
// Workplane context (immutable — each op returns a new instance)
// ---------------------------------------------------------------------------

export interface WpState {
  oc: OC;
  plane: Pln;
  shape: Shape | null;
  wires: Wire[];
  /** Optional 2D face (or compound of faces) produced by 2D boolean ops.
   * Carries hole information that bare wires cannot represent (e.g. annulus
   * from `circle 10 | diff (circle 3)`). When present, downstream 2D→3D ops
   * (extrude, revolve) use this in preference to per-wire reconstruction. */
  face2D?: Face;
  selectedFaces: Face[];
  selectedEdges: Edge[];
  selectedVertices: Vertex[];
  tags: Map<string, Shape>;
  points: [number, number][] | null;
  centerX: number;
  centerY: number;
  color?: [number, number, number];  // RGB 0..1
  alpha?: number;                    // 0..1, default 1.0
  colorMap?: Map<Shape, [number, number, number, number]>;  // per-part RGBA 0..1
}

export function cloneState(s: WpState, overrides: Partial<WpState> = {}): WpState {
  return {
    oc: s.oc,
    plane: s.plane,
    shape: s.shape,
    wires: [...s.wires],
    face2D: s.face2D,
    selectedFaces: [...s.selectedFaces],
    selectedEdges: [...s.selectedEdges],
    selectedVertices: [...s.selectedVertices],
    tags: new Map(s.tags),
    points: s.points ? [...s.points] : null,
    centerX: s.centerX,
    centerY: s.centerY,
    color: s.color,
    alpha: s.alpha,
    colorMap: s.colorMap ? new Map(s.colorMap) : undefined,
    ...overrides,
  };
}

/** Merge two colorMaps into a new Map. */
export function mergeColorMaps(
  a?: Map<Shape, [number, number, number, number]>,
  b?: Map<Shape, [number, number, number, number]>,
): Map<Shape, [number, number, number, number]> | undefined {
  if (!a && !b) return undefined;
  const result = new Map<Shape, [number, number, number, number]>();
  if (a) for (const [k, v] of a) result.set(k, v);
  if (b) for (const [k, v] of b) result.set(k, v);
  return result;
}
