/**
 * OCP Kernel 2D primitives — rect, circle, ellipse, polygon, text.
 */

import type { WpState } from './types.js';
import { cloneState } from './types.js';
import { to3d } from './geometry.js';
import { makeRectWire, makeCircleWire, makeEllipseWire, makeWireFromPoints, makeFaceFromWire } from './builders.js';
import { getOffsets } from './workplane.js';
import { textToFaces } from './text-render.js';

export type Center2 = [boolean, boolean];

export function wpRect(s: WpState, w: number, h: number, center: Center2 = [true, true]): WpState {
  const { oc } = s;
  const offsets = getOffsets(s);
  const dx = center[0] ? 0 : w / 2;
  const dy = center[1] ? 0 : h / 2;
  const newFaces = [...s.faces];
  for (const [cx, cy] of offsets) {
    newFaces.push(makeFaceFromWire(oc, makeRectWire(oc, w, h, s.plane, cx + dx, cy + dy)));
  }
  return cloneState(s, { faces: newFaces });
}

export function wpCircle(s: WpState, r: number, center: Center2 = [true, true]): WpState {
  const { oc } = s;
  const offsets = getOffsets(s);
  const dx = center[0] ? 0 : r;
  const dy = center[1] ? 0 : r;
  const newFaces = [...s.faces];
  for (const [cx, cy] of offsets) {
    newFaces.push(makeFaceFromWire(oc, makeCircleWire(oc, r, s.plane, cx + dx, cy + dy)));
  }
  return cloneState(s, { faces: newFaces });
}

export function wpEllipse(s: WpState, rx: number, ry: number, center: Center2 = [true, true]): WpState {
  const { oc } = s;
  const offsets = getOffsets(s);
  const dx = center[0] ? 0 : rx;
  const dy = center[1] ? 0 : ry;
  const newFaces = [...s.faces];
  for (const [cx, cy] of offsets) {
    newFaces.push(makeFaceFromWire(oc, makeEllipseWire(oc, rx, ry, s.plane, cx + dx, cy + dy)));
  }
  return cloneState(s, { faces: newFaces });
}

export function wpPolygon(s: WpState, pts: [number, number][]): WpState {
  const { oc } = s;
  const points3d = pts.map(([x, y]) => to3d(oc, s.plane, x + s.centerX, y + s.centerY));
  const wire = makeWireFromPoints(oc, points3d, true);
  return cloneState(s, { faces: [...s.faces, makeFaceFromWire(oc, wire)] });
}

export function wpText(s: WpState, content: string, size: number, _depth: number): WpState {
  // Try real font rendering via opentype.js
  const faces = textToFaces(s.oc, content, size, s.plane);
  if (faces && faces.length > 0) {
    return cloneState(s, { faces: [...s.faces, ...faces] });
  }
  // Fallback: rectangular placeholder
  const w = size * String(content).length * 0.6;
  const h = size;
  return wpRect(s, w, h);
}
