/**
 * OCP Kernel selection — faces, edges, vertices, workplane, tag operations.
 */

import type { WpState, Dir, Pln } from './types.js';
import { cloneState } from './types.js';
import { makePlane, getFaces, getEdges, getVertices, faceCenter, faceNormal, edgeCenter, edgeDirection, vertexPoint, to3d, projectTo2d } from './geometry.js';
import { selectItems } from './selector.js';

/**
 * Fail when a selector matched nothing.
 *
 * A selector that matches zero items is never what the author meant, and the
 * downstream damage is silent: fillet/chamfer widen to every edge, hole and
 * workplane quietly do nothing. All of them leave a healthy-looking solid, so
 * the mistake survives every numeric check and only shows up in a picture.
 *
 * SPEC.md ("セレクタが何も選択しなかった場合: ランタイムエラー") has always
 * specified an error here.
 */
function checkSelection(kind: string, selector: string | undefined, selected: unknown[], total: number): void {
  if (!selector || selected.length > 0) return;
  throw new Error(
    `selector '${selector}' matched 0 of ${total} ${kind} -- ` +
    'the following operation would apply to everything or to nothing',
  );
}

export function wpFaces(s: WpState, selector?: string, tagName?: string): WpState {
  const { oc } = s;
  if (tagName && s.tags.has(tagName)) {
    return cloneState(s, { shape: s.tags.get(tagName)!, selectedFaces: [], selectedEdges: [] });
  }
  if (!s.shape) return s;
  const allFaces = getFaces(oc, s.shape);
  const selected = selector
    ? selectItems(oc, allFaces, selector, f => faceCenter(oc, f), f => faceNormal(oc, f))
    : allFaces;
  checkSelection('faces', selector, selected, allFaces.length);
  return cloneState(s, { selectedFaces: selected, selectedEdges: [] });
}

export function wpEdges(s: WpState, selector?: string, tagName?: string): WpState {
  const { oc } = s;
  if (tagName && s.tags.has(tagName)) {
    return cloneState(s, { shape: s.tags.get(tagName)!, selectedFaces: [], selectedEdges: [] });
  }
  if (!s.shape) return s;
  const allEdges = getEdges(oc, s.shape);
  const selected = selector
    ? selectItems(oc, allEdges, selector, e => edgeCenter(oc, e), e => edgeDirection(oc, e))
    : allEdges;
  checkSelection('edges', selector, selected, allEdges.length);
  return cloneState(s, { selectedEdges: selected, selectedFaces: [] });
}

export function wpVertices(s: WpState, selector?: string, tagName?: string): WpState {
  const { oc } = s;
  if (tagName && s.tags.has(tagName)) {
    return cloneState(s, { shape: s.tags.get(tagName)! });
  }

  // 2D context: extract vertices from wires and convert to points on the plane
  if (s.wires.length > 0) {
    const pts: [number, number][] = [];
    const o = s.plane.origin;
    const xd = s.plane.xDir;
    const yd = s.plane.yDir;
    for (const wire of s.wires) {
      const verts = oc.getSubShapes(wire, 'vertex');
      for (const v of verts) {
        const p = oc.vertexPosition(v);
        // Project 3D point onto the workplane to get 2D coordinates
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const dz = p.z - o.z;
        const u = dx * xd.x + dy * xd.y + dz * xd.z;
        const vv = dx * yd.x + dy * yd.y + dz * yd.z;
        // Deduplicate (wire vertices appear twice at shared corners)
        if (!pts.some(([pu, pv]) => Math.abs(pu - u) < 1e-6 && Math.abs(pv - vv) < 1e-6)) {
          pts.push([u, vv]);
        }
      }
    }
    return cloneState(s, { points: pts, wires: [] });
  }

  if (!s.shape) return s;
  const allVerts = getVertices(oc, s.shape);
  const selected = selector
    ? selectItems(oc, allVerts, selector, v => vertexPoint(oc, v))
    : allVerts;
  checkSelection('vertices', selector, selected, allVerts.length);
  return cloneState(s, { selectedVertices: selected });
}

/**
 * Create or reset workplane.
 * - If faces are selected, create workplane from the first selected face.
 * - If planeName is given (e.g. "XZ"), create a named standard plane.
 * - Otherwise, reset wires/cursor on current plane.
 */
export function wpWorkplane(s: WpState, planeName?: string, origin?: number[]): WpState {
  if (s.selectedFaces.length > 0) {
    const { oc } = s;
    const face = s.selectedFaces[0];
    const center = faceCenter(oc, face);
    const normal = faceNormal(oc, face);
    // Determine xDir: cross(Z, normal) matching Python/CadQuery convention
    let xdir: Dir;
    if (Math.abs(normal.z) > 0.9) {
      // Top/bottom: xDir = +X
      xdir = { x: 1, y: 0, z: 0 };
    } else {
      // Side faces: xDir = cross(Z, normal)
      const cx = 0 * normal.z - 1 * normal.y;  // Z.y*n.z - Z.z*n.y = -n.y
      const cy = 1 * normal.x - 0 * normal.z;  // Z.z*n.x - Z.x*n.z = n.x
      const cz = 0 * normal.y - 0 * normal.x;  // Z.x*n.y - Z.y*n.x = 0
      const mag = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (mag < 1e-6) {
        xdir = { x: 1, y: 0, z: 0 };
      } else {
        xdir = { x: cx / mag, y: cy / mag, z: cz / mag };
      }
    }
    // Compute yDir from normal and xDir, ensuring it points "up" (+Z for side faces, +Y for top/bottom)
    let yd = {
      x: normal.y * xdir.z - normal.z * xdir.y,
      y: normal.z * xdir.x - normal.x * xdir.z,
      z: normal.x * xdir.y - normal.y * xdir.x,
    };
    // Flip yDir so it points upward: prefer +Z, or +Y for horizontal faces
    if (Math.abs(normal.z) > 0.9) {
      // Top/bottom: yDir should have +Y component
      if (yd.y < 0) yd = { x: -yd.x, y: -yd.y, z: -yd.z };
    } else {
      // Side faces: yDir should have +Z component
      if (yd.z < 0) yd = { x: -yd.x, y: -yd.y, z: -yd.z };
    }
    let planeOrigin = center;
    if (origin) {
      const basePlane: Pln = { origin: center, normal, xDir: xdir, yDir: yd };
      let u: number, v: number;
      if (origin.length === 2) {
        // 2D: interpret as world coordinates along the plane's local axes.
        const xd = xdir, yd2 = yd;
        const wx = origin[0] * xd.x + origin[1] * yd2.x;
        const wy = origin[0] * xd.y + origin[1] * yd2.y;
        const wz = origin[0] * xd.z + origin[1] * yd2.z;
        [u, v] = projectTo2d(basePlane, wx, wy, wz);
      } else {
        [u, v] = projectTo2d(basePlane, origin[0], origin[1], origin[2]);
      }
      const p = to3d(oc, basePlane, u, v);
      planeOrigin = { x: p.x, y: p.y, z: p.z };
    }
    const plane: Pln = { origin: planeOrigin, normal, xDir: xdir, yDir: yd };
    return cloneState(s, {
      plane, wires: [], selectedFaces: [], selectedEdges: [], points: null,
      centerX: 0, centerY: 0,
    });
  }
  if (planeName) {
    const newPlane = makePlane(s.oc, planeName);
    return cloneState(s, { plane: newPlane, wires: [], centerX: 0, centerY: 0, points: null });
  }
  return cloneState(s, { wires: [], centerX: 0, centerY: 0, points: null });
}

export function wpTag(s: WpState, name: string): WpState {
  const tags = new Map(s.tags);
  if (s.shape) tags.set(name, s.shape);
  return cloneState(s, { tags });
}
