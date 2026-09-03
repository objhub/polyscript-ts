/**
 * OCP Kernel workplane — bounding box, workplane factory, offset helper.
 */

import type { OC, Shape, BoundingBox, WpState } from './types.js';
import { makePlane } from './geometry.js';

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export function boundingBox(oc: OC, shape: Shape): BoundingBox {
  const bb = oc.getBoundingBox(shape);
  return {
    xmin: bb.xmin, ymin: bb.ymin, zmin: bb.zmin,
    xmax: bb.xmax, ymax: bb.ymax, zmax: bb.zmax,
    xlen: bb.xmax - bb.xmin,
    ylen: bb.ymax - bb.ymin,
    zlen: bb.zmax - bb.zmin,
  };
}

/**
 * Approximate bounding box (control-point hulls). Cheaper than boundingBox()
 * by an order of magnitude on curved shapes, but may be looser. Safe wherever
 * the box is only used as an over-approximation -- e.g. sizing a through-all
 * cutting tool -- never for a reported bbox.
 */
export function fastBoundingBox(oc: OC, shape: Shape): BoundingBox {
  const bb = oc.getBoundingBoxFast(shape);
  return {
    xmin: bb.xmin, ymin: bb.ymin, zmin: bb.zmin,
    xmax: bb.xmax, ymax: bb.ymax, zmax: bb.zmax,
    xlen: bb.xmax - bb.xmin,
    ylen: bb.ymax - bb.ymin,
    zlen: bb.zmax - bb.zmin,
  };
}

// ---------------------------------------------------------------------------
// Workplane factory
// ---------------------------------------------------------------------------

export function createWorkplane(oc: OC, planeName: string = 'XY'): WpState {
  return {
    oc,
    plane: makePlane(oc, planeName),
    shape: null,
    wires: [],
    selectedFaces: [],
    selectedEdges: [],
    selectedVertices: [],
    tags: new Map(),
    points: null,
    centerX: 0,
    centerY: 0,
  };
}

// ---------------------------------------------------------------------------
// Offset helper (for at/polar/grid points)
// ---------------------------------------------------------------------------

export function getOffsets(s: WpState): [number, number][] {
  if (s.points) return s.points.map(([px, py]) => [px + s.centerX, py + s.centerY]);
  return [[s.centerX, s.centerY]];
}
