/**
 * OCP Kernel wire/face builders and transform helpers.
 * Uses occt-wasm API: makeLineEdge, makeWire, makeFace, etc.
 */

import type { OC, Pnt, Pln, Wire, Face, Shape } from './types.js';
import type { Vec3 } from 'occt-wasm';
import { planeNormal, to3d } from './geometry.js';

// ---------------------------------------------------------------------------
// Wire/Face builders
// ---------------------------------------------------------------------------

export function makeWireFromPoints(oc: OC, points: Pnt[], close: boolean = false): Wire {
  const edges: Wire[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    edges.push(oc.makeLineEdge(points[i], points[i + 1]));
  }
  if (close && points.length > 2) {
    edges.push(oc.makeLineEdge(points[points.length - 1], points[0]));
  }
  return oc.makeWire(edges);
}

export function makeFaceFromWire(oc: OC, wire: Wire): Face {
  return oc.makeFace(wire);
}

export function makeRectWire(oc: OC, w: number, h: number, plane: Pln, cx: number = 0, cy: number = 0): Wire {
  const hw = w / 2, hh = h / 2;
  const pts = [
    to3d(oc, plane, cx - hw, cy - hh),
    to3d(oc, plane, cx + hw, cy - hh),
    to3d(oc, plane, cx + hw, cy + hh),
    to3d(oc, plane, cx - hw, cy + hh),
  ];
  return makeWireFromPoints(oc, pts, true);
}

export function makeCircleWire(oc: OC, r: number, plane: Pln, cx: number = 0, cy: number = 0): Wire {
  if (!Number.isFinite(r) || r <= 0) {
    throw new Error('circle radius must be positive');
  }
  const center = to3d(oc, plane, cx, cy);
  const normal = planeNormal(plane);
  const edge = oc.makeCircleEdge(center, normal, r);
  return oc.makeWire([edge]);
}

export function makeEllipseWire(oc: OC, rx: number, ry: number, plane: Pln, cx: number = 0, cy: number = 0): Wire {
  if (!Number.isFinite(rx) || rx <= 0) {
    throw new Error('ellipse rx must be positive');
  }
  if (!Number.isFinite(ry) || ry <= 0) {
    throw new Error('ellipse ry must be positive');
  }
  const center = to3d(oc, plane, cx, cy);
  const normal = planeNormal(plane);
  // makeEllipseEdge: major >= minor required
  const majorR = Math.max(rx, ry);
  const minorR = Math.min(rx, ry);
  const edge = oc.makeEllipseEdge(center, normal, majorR, minorR);
  return oc.makeWire([edge]);
}

/**
 * Create a line wire from start to end point.
 */
export function makeLineWire(oc: OC, start: Pnt, end: Pnt): Wire {
  const edge = oc.makeLineEdge(start, end);
  return oc.makeWire([edge]);
}

/**
 * Create a three-point arc wire (start -> mid -> end).
 */
export function makeArcWire(oc: OC, start: Pnt, mid: Pnt, end: Pnt): Wire {
  const edge = oc.makeArcEdge(start, mid, end);
  return oc.makeWire([edge]);
}

/**
 * Create a center-arc wire (start -> end, given center and normal).
 * Computes the midpoint on the minor arc and delegates to the 3-point
 * makeArcEdge — this avoids gp_Ax2's implicit reference-direction choice
 * that would otherwise make startAngle/endAngle ambiguous.
 */
export function makeCenterArcWire(oc: OC, start: Pnt, end: Pnt, center: Pnt, normal: Pnt): Wire {
  const mid = computeCenterArcMidpoint(start, end, center, normal);
  const edge = oc.makeArcEdge(start, mid, end);
  return oc.makeWire([edge]);
}

/**
 * Compute the midpoint on the minor arc defined by center, start, end.
 * Returns a point at radius |center-start| from center, on the chord-midpoint side.
 * Falls back to normal × (end - start) for the semicircle case.
 */
export function computeCenterArcMidpoint(start: Pnt, end: Pnt, center: Pnt, normal: Pnt): Pnt {
  const r = Math.sqrt(
    (center.x - start.x) ** 2 + (center.y - start.y) ** 2 + (center.z - start.z) ** 2,
  );
  const mcx = (start.x + end.x) / 2;
  const mcy = (start.y + end.y) / 2;
  const mcz = (start.z + end.z) / 2;
  const vx = mcx - center.x;
  const vy = mcy - center.y;
  const vz = mcz - center.z;
  const vlen = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (vlen > 1e-10) {
    const k = r / vlen;
    return { x: center.x + vx * k, y: center.y + vy * k, z: center.z + vz * k };
  }
  const ex = end.x - start.x;
  const ey = end.y - start.y;
  const ez = end.z - start.z;
  const px = normal.y * ez - normal.z * ey;
  const py = normal.z * ex - normal.x * ez;
  const pz = normal.x * ey - normal.y * ex;
  const plen = Math.sqrt(px * px + py * py + pz * pz);
  if (plen < 1e-12) {
    throw new Error('computeCenterArcMidpoint: degenerate geometry');
  }
  const k = r / plen;
  return { x: center.x + px * k, y: center.y + py * k, z: center.z + pz * k };
}

/**
 * Create a tangent-arc wire (start -> end, given tangent direction at start).
 * Uses makeTangentArc(start, tangent, end).
 */
export function makeTangentArcWire(oc: OC, start: Pnt, tangent: Pnt, end: Pnt): Wire {
  const edge = oc.makeTangentArc(start, tangent, end);
  return oc.makeWire([edge]);
}

// ---------------------------------------------------------------------------
// Center-arc math utilities
// ---------------------------------------------------------------------------

/**
 * Compute start/end angles for an arc defined by center, start point, end point, and normal.
 * Returns angles in radians suitable for makeCircleArc.
 * Chooses the minor arc (shorter path) by default.
 */
export function computeArcAngles(
  center: Pnt, start: Pnt, end: Pnt, normal: Pnt
): { startAngle: number; endAngle: number } {
  // Build local coordinate system from normal
  // X-axis: from center to start (normalized)
  const dx = start.x - center.x;
  const dy = start.y - center.y;
  const dz = start.z - center.z;
  const rStart = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (rStart < 1e-12) {
    throw new Error('arc: start point coincides with center');
  }
  const ux = dx / rStart, uy = dy / rStart, uz = dz / rStart;

  // Y-axis: normal x X-axis (right-hand rule)
  const nx = normal.x, ny = normal.y, nz = normal.z;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (vLen < 1e-12) {
    throw new Error('arc: normal is parallel to center-start direction');
  }
  const vyNorm = { x: vx / vLen, y: vy / vLen, z: vz / vLen };

  // Project (end - center) onto local X (u) and Y (v)
  const ex = end.x - center.x;
  const ey = end.y - center.y;
  const ez = end.z - center.z;
  const projX = ex * ux + ey * uy + ez * uz;
  const projY = ex * vyNorm.x + ey * vyNorm.y + ez * vyNorm.z;

  // Start angle is 0 by definition (X-axis is center->start direction)
  const startAngle = 0;
  let endAngle = Math.atan2(projY, projX);

  // Ensure minor arc (|sweep| <= pi). If > pi, flip direction.
  if (endAngle < 0) endAngle += 2 * Math.PI;
  // Minor arc means sweep <= pi
  if (endAngle > Math.PI) {
    // Use the complementary arc by going negative direction
    endAngle = endAngle - 2 * Math.PI;
  }
  // Special case: exactly pi (semicircle) — default to CCW (positive)
  if (Math.abs(Math.abs(endAngle) - Math.PI) < 1e-10) {
    endAngle = Math.PI;
  }

  return { startAngle, endAngle };
}

/**
 * Compute the center of an arc given start, end, radius, and workplane normal.
 * Chooses the center on the short-arc side (minor arc).
 */
export function computeCenterFromRadius(
  start: Pnt, end: Pnt, radius: number, normal: Pnt
): Pnt {
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const mz = (start.z + end.z) / 2;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (d > 2 * radius + 1e-10) {
    throw new Error(`arc: |SE| (${d.toFixed(4)}) > 2*r (${(2 * radius).toFixed(4)}) — arc cannot be formed`);
  }

  const halfD = d / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - halfD * halfD));

  // Perpendicular direction in the workplane: normal x (end - start), normalized
  const px = normal.y * dz - normal.z * dy;
  const py = normal.z * dx - normal.x * dz;
  const pz = normal.x * dy - normal.y * dx;
  const pLen = Math.sqrt(px * px + py * py + pz * pz);
  if (pLen < 1e-12) {
    throw new Error('arc: start and end points are coincident or normal is parallel to SE');
  }
  const nx = px / pLen, ny2 = py / pLen, nz = pz / pLen;

  // Choose the center that gives the minor arc
  // The minor-arc center is on the side where the perpendicular points
  return {
    x: mx + nx * h,
    y: my + ny2 * h,
    z: mz + nz * h,
  };
}

/**
 * Create a bezier wire from control points.
 */
export function makeBezierWire(oc: OC, controlPoints: Pnt[]): Wire {
  const edge = oc.makeBezierEdge(controlPoints);
  return oc.makeWire([edge]);
}

export function makeHelixWire(oc: OC, pitch: number, height: number, radius: number): Wire {
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const axis: Vec3 = { x: 0, y: 0, z: 1 };
  return oc.makeHelixWire(origin, axis, pitch, height, radius);
}

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

export function translateShape(oc: OC, shape: Shape, vec: Vec3): Shape {
  return oc.translate(shape, vec.x, vec.y, vec.z);
}

export function rotateShape(oc: OC, shape: Shape, center: [number, number, number], axis: [number, number, number], angleDeg: number): Shape {
  return oc.rotate(
    shape,
    {
      point: { x: center[0], y: center[1], z: center[2] },
      direction: { x: axis[0], y: axis[1], z: axis[2] },
    },
    angleDeg * Math.PI / 180,
  );
}

/**
 * Uniform scale around a center point using oc.scale().
 */
export function scaleShapeUniform(oc: OC, shape: Shape, center: [number, number, number], factor: number): Shape {
  return oc.scale(shape, { x: center[0], y: center[1], z: center[2] }, factor);
}

/**
 * Non-uniform scale (sx, sy, sz) around a center point.
 * Uses oc.generalTransform() with a 3x4 row-major affine matrix that
 * translates to origin, scales, then translates back.
 */
export function scaleShapeNonUniform(oc: OC, shape: Shape, center: [number, number, number], sx: number, sy: number, sz: number): Shape {
  const [cx, cy, cz] = center;
  // Combined matrix: T(center) * S(sx,sy,sz) * T(-center)
  // Row-major 3x4: [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]
  const matrix = [
    sx, 0,  0,  cx * (1 - sx),
    0,  sy, 0,  cy * (1 - sy),
    0,  0,  sz, cz * (1 - sz),
  ];
  return oc.generalTransform(shape, matrix);
}
