/**
 * OCP Kernel 3D primitives — box, cylinder, sphere.
 * Uses occt-wasm: makeBox, makeCylinder, makeSphere + translate for centering.
 */

import type { WpState } from './types.js';
import { cloneState } from './types.js';
import { alignZToDir } from './geometry.js';

/** Guard: ensure all dimensions are positive and finite. */
function requirePositive(name: string, ...values: number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`${name}: dimensions must be positive (got ${v})`);
    }
  }
}

export type Center3 = [boolean, boolean, boolean];

export function wpBox(s: WpState, w: number, h: number, d: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('box', w, h, d);
  const { oc } = s;
  let shape = oc.makeBox(w, h, d);
  const tx = center[0] ? -w / 2 : 0;
  const ty = center[1] ? -h / 2 : 0;
  const tz = center[2] ? -d / 2 : 0;
  shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpCylinder(
  s: WpState, h: number, r: number,
  center: Center3 = [true, true, true],
  dir?: [number, number, number] | null,
  pnt?: [number, number, number] | null,
): WpState {
  requirePositive('cylinder', h, r);
  const { oc } = s;
  let shape = oc.makeCylinder(r, h);
  // 1. centering (Z-axis-relative, before rotation)
  const tx = center[0] ? 0 : r;
  const ty = center[1] ? 0 : r;
  const tz = center[2] ? -h / 2 : 0;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  // 2. dir rotation
  if (dir) shape = alignZToDir(oc, shape, dir);
  // 3. pnt translation
  if (pnt) shape = oc.translate(shape, pnt[0], pnt[1], pnt[2]);
  return cloneState(s, { shape, wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpSphere(s: WpState, r: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('sphere', r);
  const { oc } = s;
  let shape = oc.makeSphere(r);
  const tx = center[0] ? 0 : r;
  const ty = center[1] ? 0 : r;
  const tz = center[2] ? 0 : r;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpCone(
  s: WpState, height: number, r1: number, r2: number,
  center: Center3 = [true, true, true],
  dir?: [number, number, number] | null,
  pnt?: [number, number, number] | null,
): WpState {
  requirePositive('cone', height);
  if (!Number.isFinite(r1) || r1 < 0 || !Number.isFinite(r2) || r2 < 0 || (r1 === 0 && r2 === 0)) {
    throw new Error(`cone: at least one radius must be positive`);
  }
  const { oc } = s;
  const maxR = Math.max(r1, r2);
  let shape = oc.makeCone(r1, r2, height);
  // 1. centering (Z-axis-relative, before rotation)
  const tx = center[0] ? 0 : maxR;
  const ty = center[1] ? 0 : maxR;
  const tz = center[2] ? -height / 2 : 0;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  // 2. dir rotation
  if (dir) shape = alignZToDir(oc, shape, dir);
  // 3. pnt translation
  if (pnt) shape = oc.translate(shape, pnt[0], pnt[1], pnt[2]);
  return cloneState(s, { shape, wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpTorus(s: WpState, r1: number, r2: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('torus', r1, r2);
  const { oc } = s;
  let shape = oc.makeTorus(r1, r2);
  const tx = center[0] ? 0 : r1 + r2;
  const ty = center[1] ? 0 : r1 + r2;
  const tz = center[2] ? 0 : r2;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, wires: [], selectedFaces: [], selectedEdges: [] });
}

export function wpWedge(s: WpState, dx: number, dy: number, dz: number, ltx: number, center: Center3 = [true, true, true]): WpState {
  requirePositive('wedge', dx, dy, dz);
  const { oc } = s;
  // Build wedge via loft: bottom rect (dx × dz) at y=0 → top rect (ltx × dz) at y=dy.
  // OCC MakeWedge convention: base on XZ plane, height along Y.
  const bottomWire = oc.makeWire([
    oc.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: dx, y: 0, z: 0 }),
    oc.makeLineEdge({ x: dx, y: 0, z: 0 }, { x: dx, y: 0, z: dz }),
    oc.makeLineEdge({ x: dx, y: 0, z: dz }, { x: 0, y: 0, z: dz }),
    oc.makeLineEdge({ x: 0, y: 0, z: dz }, { x: 0, y: 0, z: 0 }),
  ]);
  const xOff = (dx - ltx) / 2;
  const topWire = oc.makeWire([
    oc.makeLineEdge({ x: xOff, y: dy, z: 0 }, { x: xOff + ltx, y: dy, z: 0 }),
    oc.makeLineEdge({ x: xOff + ltx, y: dy, z: 0 }, { x: xOff + ltx, y: dy, z: dz }),
    oc.makeLineEdge({ x: xOff + ltx, y: dy, z: dz }, { x: xOff, y: dy, z: dz }),
    oc.makeLineEdge({ x: xOff, y: dy, z: dz }, { x: xOff, y: dy, z: 0 }),
  ]);
  let shape = oc.loft([bottomWire, topWire], true, false);
  const tx = center[0] ? -dx / 2 : 0;
  const ty = center[1] ? -dy / 2 : 0;
  const tz = center[2] ? -dz / 2 : 0;
  if (tx !== 0 || ty !== 0 || tz !== 0) shape = oc.translate(shape, tx, ty, tz);
  return cloneState(s, { shape, wires: [], selectedFaces: [], selectedEdges: [] });
}
