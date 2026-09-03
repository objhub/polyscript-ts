/**
 * OCP Kernel geometry helpers — point/direction/plane construction,
 * topology exploration, and geometry analysis.
 *
 * With occt-wasm, points/directions are plain Vec3 objects.
 * Functions like makePnt/makeDir/makeVec are kept for evaluator compatibility.
 */

import type { OC, Pnt, Dir, Vec, Pln, Face, Edge, Vertex, Shape } from './types.js';

// ---------------------------------------------------------------------------
// Point/Direction/Vector constructors (return Vec3)
// ---------------------------------------------------------------------------

export function makePnt(_oc: OC, x: number, y: number, z: number): Pnt {
  return { x, y, z };
}

export function makeDir(_oc: OC, x: number, y: number, z: number): Dir {
  return { x, y, z };
}

export function makeVec(_oc: OC, x: number, y: number, z: number): Vec {
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Plane helpers
// ---------------------------------------------------------------------------

export function makePlane(_oc: OC, name: string): Pln {
  const origin: Pnt = { x: 0, y: 0, z: 0 };
  if (name === 'XZ') {
    return { origin, normal: { x: 0, y: 1, z: 0 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 0, z: 1 } };
  } else if (name === 'YZ') {
    return { origin, normal: { x: 1, y: 0, z: 0 }, xDir: { x: 0, y: 1, z: 0 }, yDir: { x: 0, y: 0, z: 1 } };
  }
  // default XY
  return { origin, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 } };
}

export function planeOrigin(plane: Pln): Pnt {
  return plane.origin;
}

export function planeNormal(plane: Pln): Dir {
  return plane.normal;
}

export function planeXDir(plane: Pln): Dir {
  return plane.xDir;
}

export function planeYDir(plane: Pln): Dir {
  return plane.yDir;
}

export function to3d(_oc: OC, plane: Pln, x: number, y: number): Pnt {
  const o = plane.origin;
  const xd = plane.xDir;
  const yd = plane.yDir;
  return {
    x: o.x + x * xd.x + y * yd.x,
    y: o.y + x * xd.y + y * yd.y,
    z: o.z + x * xd.z + y * yd.z,
  };
}

/** Project a 3D world point onto *plane*, returning local 2D (u, v). */
export function projectTo2d(plane: Pln, x: number, y: number, z: number): [number, number] {
  const o = plane.origin, xd = plane.xDir, yd = plane.yDir;
  const dx = x - o.x, dy = y - o.y, dz = z - o.z;
  return [
    dx * xd.x + dy * xd.y + dz * xd.z,
    dx * yd.x + dy * yd.y + dz * yd.z,
  ];
}

// ---------------------------------------------------------------------------
// Topology exploration
// ---------------------------------------------------------------------------

export function getFaces(oc: OC, shape: Shape): Face[] {
  return oc.getSubShapes(shape, 'face');
}

export function getEdges(oc: OC, shape: Shape): Edge[] {
  return oc.getSubShapes(shape, 'edge');
}

export function getVertices(oc: OC, shape: Shape): Vertex[] {
  return oc.getSubShapes(shape, 'vertex');
}

/**
 * Extract the first solid from a compound shape.
 * Boolean operations (fuse/cut/common) in occt-wasm return compound shapes,
 * but fillet/chamfer require a solid. This extracts the solid when needed.
 */
export function ensureSolid(oc: OC, shape: Shape): Shape {
  if (typeof oc.getShapeType !== 'function') return shape;
  if (oc.getShapeType(shape) === 'compound') {
    const solids = oc.getSubShapes(shape, 'solid');
    if (solids.length === 1) return solids[0];
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Geometry analysis
// ---------------------------------------------------------------------------

export function faceCenter(oc: OC, face: Face): Pnt {
  // Plain (control-point hull) bbox, not the analytically-sampled optimal
  // one: selector evaluation calls this once per face, and AddOptimal was
  // 15x slower on curved faces (03_enclosure spent 53% of its build here).
  // This also matches the Python kernel, whose _face_center has always used
  // plain BRepBndLib.Add_s.
  const bb = oc.getBoundingBoxFast(face);
  return {
    x: (bb.xmin + bb.xmax) / 2,
    y: (bb.ymin + bb.ymax) / 2,
    z: (bb.zmin + bb.zmax) / 2,
  };
}

export function faceNormal(oc: OC, face: Face): Dir {
  const uv = oc.uvBounds(face);
  const u = (uv.uMin + uv.uMax) / 2;
  const v = (uv.vMin + uv.vMax) / 2;
  return oc.surfaceNormal(face, u, v);
}

export function edgeCenter(oc: OC, edge: Edge): Pnt {
  return oc.getLinearCenterOfMass(edge);
}

export function edgeDirection(oc: OC, edge: Edge): Vec | null {
  const params = oc.curveParameters(edge);
  const p1 = oc.curvePointAtParam(edge, params.first);
  const p2 = oc.curvePointAtParam(edge, params.last);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (mag < 1e-10) return null;
  return { x: dx / mag, y: dy / mag, z: dz / mag };
}

export function vertexPoint(oc: OC, vertex: Vertex): Pnt {
  return oc.vertexPosition(vertex);
}

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

/**
 * Rotate a Z-axis-aligned shape so that its axis points along the given direction.
 * Uses oc.rotate() (gp_Trsf) instead of oc.generalTransform() (gp_GTrsf) because
 * GTrsf does not correctly compute bounding boxes for curved surfaces (cylinders,
 * spheres) in occt-wasm — it distorts them via an approximate BSpline conversion.
 * oc.rotate() keeps the shape as a proper rotated solid with exact bounding boxes.
 */
export function alignZToDir(oc: OC, shape: Shape, dir: [number, number, number]): Shape {
  const [dx, dy, dz] = dir;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-10) return shape;
  const nx = dx / len, ny = dy / len, nz = dz / len;

  // Already pointing along +Z — no rotation needed
  if (Math.abs(nz - 1) < 1e-10) return shape;

  // Pointing along -Z — rotate 180° around X axis
  if (Math.abs(nz + 1) < 1e-10) {
    return oc.rotate(shape, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, Math.PI);
  }

  // General case: rotation axis k = normalize(Z × dir) = normalize(-ny, nx, 0)
  // angle θ = acos(Z · dir/|dir|) = acos(nz)
  const axLen = Math.sqrt(ny * ny + nx * nx);
  const kx = -ny / axLen, ky = nx / axLen;
  const theta = Math.acos(Math.max(-1, Math.min(1, nz)));
  return oc.rotate(shape, { point: { x: 0, y: 0, z: 0 }, direction: { x: kx, y: ky, z: 0 } }, theta);
}

// ---------------------------------------------------------------------------
// Axis helpers
// ---------------------------------------------------------------------------

export function axisComponent(pnt: Pnt, axis: string): number {
  const a = axis.toUpperCase();
  if (a === 'X') return pnt.x;
  if (a === 'Y') return pnt.y;
  return pnt.z;
}

export function vecComponent(v: Vec | Dir, axis: string): number {
  const a = axis.toUpperCase();
  if (a === 'X') return v.x;
  if (a === 'Y') return v.y;
  return v.z;
}
