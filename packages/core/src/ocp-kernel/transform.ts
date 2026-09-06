/**
 * OCP Kernel transform operations — translate, rotate, pushPoints, spline.
 * Uses occt-wasm: kernel.translate(), kernel.rotate(), kernel.interpolatePoints().
 */

import type { WpState } from './types.js';
import { planeNormal, ensureSolid } from './geometry.js';
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

/**
 * Rotate the 2D geometry on the workplane (faces and wires) about the plane
 * normal through `center`. The solid, if any, is untouched: a sketch drawn on
 * a face turns in that face, it does not tilt the part.
 */
export function wpRotate2D(s: WpState, center: [number, number, number], angleDeg: number): WpState {
  const { oc } = s;
  const n = planeNormal(s.plane);
  const axis: [number, number, number] = [n.x, n.y, n.z];
  const faces = s.faces.map((f) => rotateShape(oc, f, center, axis, angleDeg));
  const wires = s.wires.map((w) => rotateShape(oc, w, center, axis, angleDeg));
  return cloneState(s, { faces, wires });
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

export interface MirrorOptions {
  /** A point on the mirror plane. Defaults to the world origin for a solid
   *  and to the workplane origin for 2D geometry. */
  center?: [number, number, number];
  /** Return the original fused with its reflection instead of the reflection
   *  alone -- the "model half, mirror to finish" idiom. */
  keep?: boolean;
}

/**
 * Reflect the state's geometry across the plane perpendicular to `axisName`.
 *
 * On a solid the axis is a world axis. On 2D geometry it is the workplane's
 * own axis, so `mirror "X"` on a sketch flips the sketch's X and stays in the
 * plane; the plane's normal never appears, since reflecting across the sketch
 * plane would leave every 2D shape where it was.
 */
export function wpMirror(s: WpState, axisName: string, options: MirrorOptions = {}): WpState {
  const { oc } = s;
  const ax = axisName.toUpperCase();
  const has2D = s.faces.length > 0 || s.wires.length > 0;

  if (has2D) {
    const o = s.plane.origin;
    const center = options.center ?? [o.x, o.y, o.z];
    const point = { x: center[0], y: center[1], z: center[2] };
    // "X" flips the sketch's X: the mirror plane is the one whose normal is the
    // workplane's X direction.
    const normal = ax === 'Y' ? s.plane.yDir : s.plane.xDir;
    const faces = s.faces.map((f) => oc.mirror(f, point, normal));
    const wires = s.wires.map((w) => oc.mirror(w, point, normal));
    return options.keep
      ? cloneState(s, { faces: [...s.faces, ...faces], wires: [...s.wires, ...wires] })
      : cloneState(s, { faces, wires });
  }

  if (!s.shape) return s;
  const center = options.center ?? [0, 0, 0];
  const point = { x: center[0], y: center[1], z: center[2] };
  let normal = { x: 1, y: 0, z: 0 };
  if (ax === 'Y') normal = { x: 0, y: 1, z: 0 };
  else if (ax === 'Z') normal = { x: 0, y: 0, z: 1 };
  const mirrored = oc.mirror(s.shape, point, normal);
  if (!options.keep) return cloneState(s, { shape: mirrored });
  const fused = ensureSolid(oc, oc.fuse(s.shape, mirrored));
  return cloneState(s, { shape: fused });
}

export function wpSpline(s: WpState, pts: [number, number][]): WpState {
  const { oc } = s;
  const points3d = pts.map(([x, y]) => to3d(oc, s.plane, x, y));
  const wire = oc.interpolatePoints(points3d);
  return cloneState(s, { wires: [...s.wires, wire] });
}
