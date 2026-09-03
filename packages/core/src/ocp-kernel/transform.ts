/**
 * OCP Kernel transform operations — translate, rotate, pushPoints, spline.
 * Uses occt-wasm: kernel.translate(), kernel.rotate(), kernel.interpolatePoints().
 */

import type { WpState } from './types.js';
import { cloneState } from './types.js';
import { to3d } from './geometry.js';
import { translateShape, rotateShape, scaleShapeUniform, scaleShapeNonUniform } from './builders.js';

export function wpTranslate(s: WpState, x: number, y: number, z: number): WpState {
  const { oc } = s;
  if (!s.shape) return s;
  const shape = translateShape(oc, s.shape, { x, y, z });
  return cloneState(s, { shape });
}

export function wpRotate(s: WpState, center: [number, number, number], axis: [number, number, number], angle: number): WpState {
  const { oc } = s;
  if (!s.shape) return s;
  const shape = rotateShape(oc, s.shape, center, axis, angle);
  return cloneState(s, { shape });
}

export function wpScale(s: WpState, center: [number, number, number], sx: number, sy: number, sz: number): WpState {
  const { oc } = s;
  if (!s.shape) return s;
  let shape: typeof s.shape;
  if (sx === sy && sy === sz) {
    // Uniform scale — use dedicated oc.scale() for better precision
    shape = scaleShapeUniform(oc, s.shape, center, sx);
  } else {
    // Non-uniform scale — use generalTransform with affine matrix
    shape = scaleShapeNonUniform(oc, s.shape, center, sx, sy, sz);
  }
  return cloneState(s, { shape });
}

export function wpPushPoints(s: WpState, pts: [number, number][]): WpState {
  return cloneState(s, { points: pts });
}

/**
 * Relative 2D cursor move — shifts centerX/centerY by (dx, dy).
 * Equivalent to CadQuery's .center(dx, dy).
 */
export function wpMove(s: WpState, dx: number, dy: number): WpState {
  return cloneState(s, { centerX: s.centerX + dx, centerY: s.centerY + dy });
}

/**
 * Absolute 2D cursor move — sets centerX/centerY to (x, y).
 * Note: In CadQuery, moveTo and center both shift relative.
 * Here we implement moveTo as setting absolute position on the workplane.
 */
export function wpMoveTo(s: WpState, x: number, y: number): WpState {
  return cloneState(s, { centerX: x, centerY: y });
}

export function wpMirror(s: WpState, axisName: string): WpState {
  if (!s.shape) return s;
  const { oc } = s;
  const origin = { x: 0, y: 0, z: 0 };
  let normal = { x: 1, y: 0, z: 0 };
  const ax = axisName.toUpperCase();
  if (ax === 'Y') normal = { x: 0, y: 1, z: 0 };
  else if (ax === 'Z') normal = { x: 0, y: 0, z: 1 };
  const shape = oc.mirror(s.shape, origin, normal);
  return cloneState(s, { shape });
}

export function wpSpline(s: WpState, pts: [number, number][]): WpState {
  const { oc } = s;
  const points3d = pts.map(([x, y]) => to3d(oc, s.plane, x, y));
  const wire = oc.interpolatePoints(points3d);
  return cloneState(s, { wires: [...s.wires, wire] });
}
