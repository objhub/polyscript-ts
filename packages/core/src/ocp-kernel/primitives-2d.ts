/**
 * OCP Kernel 2D primitives — rect, circle, ellipse, polygon, text.
 */

import type { WpState } from './types.js';
import { cloneState } from './types.js';
import { to3d } from './geometry.js';
import { makeRectWire, makeCircleWire, makeEllipseWire, makeWireFromPoints } from './builders.js';
import { getOffsets } from './workplane.js';
import { textToWires } from './text-render.js';

export type Center2 = [boolean, boolean];

export function wpRect(s: WpState, w: number, h: number, center: Center2 = [true, true]): WpState {
  const { oc } = s;
  const offsets = getOffsets(s);
  const dx = center[0] ? 0 : w / 2;
  const dy = center[1] ? 0 : h / 2;
  const newWires = [...s.wires];
  for (const [cx, cy] of offsets) {
    newWires.push(makeRectWire(oc, w, h, s.plane, cx + dx, cy + dy));
  }
  return cloneState(s, { wires: newWires });
}

export function wpCircle(s: WpState, r: number, center: Center2 = [true, true]): WpState {
  const { oc } = s;
  const offsets = getOffsets(s);
  const dx = center[0] ? 0 : r;
  const dy = center[1] ? 0 : r;
  const newWires = [...s.wires];
  for (const [cx, cy] of offsets) {
    newWires.push(makeCircleWire(oc, r, s.plane, cx + dx, cy + dy));
  }
  return cloneState(s, { wires: newWires });
}

export function wpEllipse(s: WpState, rx: number, ry: number, center: Center2 = [true, true]): WpState {
  const { oc } = s;
  const offsets = getOffsets(s);
  const dx = center[0] ? 0 : rx;
  const dy = center[1] ? 0 : ry;
  const newWires = [...s.wires];
  for (const [cx, cy] of offsets) {
    newWires.push(makeEllipseWire(oc, rx, ry, s.plane, cx + dx, cy + dy));
  }
  return cloneState(s, { wires: newWires });
}

export function wpPolygon(s: WpState, pts: [number, number][]): WpState {
  const { oc } = s;
  const points3d = pts.map(([x, y]) => to3d(oc, s.plane, x + s.centerX, y + s.centerY));
  const wire = makeWireFromPoints(oc, points3d, true);
  return cloneState(s, { wires: [...s.wires, wire] });
}

export function wpText(s: WpState, content: string, size: number, _depth: number): WpState {
  // Try real font rendering via opentype.js
  const wires = textToWires(s.oc, content, size, s.plane);
  if (wires && wires.length > 0) {
    return cloneState(s, { wires: [...s.wires, ...wires] });
  }
  // Fallback: rectangular placeholder
  const w = size * String(content).length * 0.6;
  const h = size;
  return wpRect(s, w, h);
}
