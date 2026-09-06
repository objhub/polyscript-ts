/**
 * OCP Kernel extrusion operations — extrude, revolve, sweep, loft, cut, hole.
 * Uses occt-wasm: kernel.extrude(), kernel.revolve(), kernel.pipe(), kernel.loft(), etc.
 */

import { SweepMode, TransitionMode } from 'occt-wasm';
import type { OC, WpState, Wire, Face, Shape, Pln, Dir } from './types.js';
import { cloneState } from './types.js';
import { planeOrigin, planeNormal, planeXDir, ensureSolid, faceCenter, faceNormal, to3d, alignZToDir } from './geometry.js';
import { makeFaceFromWire, makeCircleWire } from './builders.js';
import { fastBoundingBox, getOffsets } from './workplane.js';
import { pruneDebrisSolids, describeOperand } from './boolean.js';
import { requireFaces, stateWire, faceBoundary } from './faces.js';

/**
 * The faces an area-consuming op works on, failing when there are none.
 *
 * A bare solid (`box | extrude 5`) or an empty workplane has nothing to
 * extrude; returning the state unchanged used to hide that, and the validator
 * only catches the literal spelling, not a variable holding the solid.
 */
function consumeFaces(s: WpState, op: string, verb: string): Face[] {
  const faces = requireFaces(s, op);
  if (faces.length === 0) {
    const example = s.shape ? `box 10 10 10 | faces >Z | rect 5 5 | ${op}` : `rect 10 10 | ${op}`;
    throw new Error(
      `${op}: nothing to ${verb} -- the context holds ${describeOperand(s)}, not a face. ` +
      `Draw an outline first ('${example} ...')`,
    );
  }
  return faces;
}

/** A cut or hole needs a solid to remove material from. */
function requireSolid(s: WpState, op: string): Shape {
  if (s.shape) return s.shape;
  throw new Error(
    `${op}: nothing to ${op === 'hole' ? 'drill into' : 'cut from'} -- the context holds ${describeOperand(s)} but no solid. ` +
    `Extrude first, or select a face of a solid ('box 10 10 10 | faces >Z | ${op === 'hole' ? 'hole 3' : 'circle 3 | cut'}')`,
  );
}

export function wpExtrude(s: WpState, height: number, draftAngleDeg?: number): WpState {
  const { oc } = s;
  const normal = planeNormal(s.plane);
  const dx = normal.x * height;
  const dy = normal.y * height;
  const dz = normal.z * height;
  let newShape = s.shape;
  // Each face is extruded as it is, holes included; several faces fuse into
  // one solid (pipe-stacked primitives are an implicit union).
  for (const face of consumeFaces(s, 'extrude', 'extrude')) {
    let solid: Shape;
    if (draftAngleDeg !== undefined && draftAngleDeg !== 0) {
      // draftPrism(shape, dx, dy, dz, angleDeg) for tapered extrusion
      solid = oc.draftPrism(face, dx, dy, dz, draftAngleDeg);
    } else {
      solid = oc.extrude(face, dx, dy, dz);
    }
    newShape = newShape ? ensureSolid(oc, oc.fuse(newShape, solid)) : solid;
  }
  return cloneState(s, { shape: newShape, faces: [], selectedFaces: [], selectedEdges: [] });
}

/**
 * Revolve a 2D profile around an axis.
 * @param axis - axis name: "X", "Y", or "Z"
 * @param degrees - rotation angle in degrees (default 360)
 */
export function wpRevolve(s: WpState, axis: 'X' | 'Y' | 'Z', degrees: number = 360): WpState {
  const { oc } = s;
  const faces = consumeFaces(s, 'revolve', 'revolve');
  const origin = planeOrigin(s.plane);

  // Determine axis direction from name
  const directions: Record<string, { x: number; y: number; z: number }> = {
    X: { x: 1, y: 0, z: 0 },
    Y: { x: 0, y: 1, z: 0 },
    Z: { x: 0, y: 0, z: 1 },
  };
  const direction = directions[axis] ?? directions.Y;

  let newShape = s.shape;
  for (const face of faces) {
    let solid: Shape;
    try {
      solid = oc.revolve(face, { point: origin, direction }, degrees * Math.PI / 180);
    } catch (err) {
      // BRepPrimAPI_MakeRevol fails when the profile crosses the axis
      // (`circle 5 | revolve X` is centred on it).
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}. ` +
        `The profile must lie entirely on one side of the ${axis} axis; move it off the axis ('circle 5 at:(10, 0) | revolve ${axis}')`,
      );
    }
    newShape = newShape ? ensureSolid(oc, oc.fuse(newShape, solid)) : solid;
  }
  return cloneState(s, { shape: newShape, faces: [] });
}

export function wpSweep(s: WpState, profileWire: Wire, profilePlane: Pln): WpState {
  const { oc } = s;
  // The pipeline subject carries the PATH (spine); the argument is the profile.
  // A spine is a wire; a single hole-free face lends its boundary (a torus is
  // `circle R | sweep (circle r)`).
  const pathWire = stateWire(s, 'sweep');
  if (!pathWire) {
    throw new Error(
      `sweep: nothing to sweep along -- the context holds ${describeOperand(s)}, not a path. ` +
      `The pipeline subject is the path and the argument the profile ('circle 20 | sweep (circle 2)')`,
    );
  }

  // Ensure the spine wire has 3D curve representations built,
  // otherwise sweep fails on curved spines (arcs, helices).
  oc.buildCurves3d(pathWire);

  // Re-orient the profile to sit at the spine start, perpendicular to the
  // start tangent.  MakePipeShell assumes the profile is already placed
  // correctly; without this step a profile drawn in XY is swept as a 2D
  // ribbon along XY-planar paths. The source frame is the profile's own
  // workplane (it was authored there), not the path's workplane.
  const orientedWire = orientProfileToSpineStart(oc, profileWire, pathWire, profilePlane);

  let solid: Shape;
  try {
    // ConstantBinormal=+Z: profile stays vertically oriented along the spine
    // (no twist on helices, springs, threaded-bolt grooves). Mirrors the
    // Python oracle: SetMode(gp_Dir(0,0,1)) + SetTransitionMode(RoundCorner).
    solid = oc.sweepAdvanced(orientedWire, pathWire, {
      mode: SweepMode.FixedUp,
      up: { x: 0, y: 0, z: 1 },
      transitionMode: TransitionMode.RoundCorner,
    });
  } catch {
    const face = makeFaceFromWire(oc, orientedWire);
    solid = oc.pipe(face, pathWire);
  }
  let newShape = solid;
  if (s.shape) {
    newShape = ensureSolid(oc, oc.fuse(s.shape, solid));
  }
  return cloneState(s, { shape: newShape, faces: [], wires: [] });
}

/**
 * Place a sweep profile at the start of its spine. Mirrors Python OCP's
 * approach: take the **analytical** start point + tangent of the spine via
 * BRepAdaptor_CompCurve.D1 (facade `wireFirstPointTangent`), build a target
 * Ax3 frame with a fixed +Z binormal (fallback +X/+Y if the tangent is along
 * Z), and transform the profile from its source workplane Ax3 to that
 * target Ax3 with `gp_Trsf.SetTransformation` (facade `transformShapeAx3`).
 */
function orientProfileToSpineStart(
  oc: WpState['oc'], profile: Wire, spine: Wire, plane: Pln,
): Wire {
  // Mock OC in tests may lack the facade helpers — skip silently.
  if (typeof (oc as { wireFirstPointTangent?: unknown }).wireFirstPointTangent !== 'function'
      || typeof (oc as { transformShapeAx3?: unknown }).transformShapeAx3 !== 'function') {
    return profile;
  }
  let pt: { point: Dir; tangent: Dir };
  try {
    pt = oc.wireFirstPointTangent(spine);
  } catch {
    return profile;
  }
  const start = pt.point;
  const tangent = pt.tangent;

  // Pick a binormal: fixed +Z unless tangent is nearly parallel.
  let binormal: Dir = { x: 0, y: 0, z: 1 };
  if (Math.abs(tangent.z) > 0.9) {
    binormal = Math.abs(tangent.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  }
  // Target X = normalize(tangent × binormal); OCC's Ax3 builds Y = Z × X.
  const rx = tangent.y * binormal.z - tangent.z * binormal.y;
  const ry = tangent.z * binormal.x - tangent.x * binormal.z;
  const rz = tangent.x * binormal.y - tangent.y * binormal.x;
  const rlen = Math.hypot(rx, ry, rz);
  if (rlen < 1e-10) return profile;
  const targetXDir: Dir = { x: rx / rlen, y: ry / rlen, z: rz / rlen };

  try {
    return oc.transformShapeAx3(
      profile,
      { origin: planeOrigin(plane), normal: planeNormal(plane), xDir: planeXDir(plane) },
      { origin: start, normal: tangent, xDir: targetXDir },
    ) as Wire;
  } catch {
    return profile;
  }
}

/**
 * Loft through multiple cross-section wires.
 * @param sectionWires - additional section wires (beyond the pipe source at offset 0)
 * @param height - total height (sections distributed evenly) OR undefined if heights given
 * @param heights - explicit offset for each additional section
 * @param ruled - if true, use ruled surface
 */
export function wpLoft(
  s: WpState,
  sectionWires: Wire[][],
  height?: number,
  heights?: number[],
  ruled?: boolean,
): WpState {
  const { oc } = s;
  const faces = consumeFaces(s, 'loft', 'loft from');

  const normal = planeNormal(s.plane);
  const n = sectionWires.length; // number of additional sections

  // Compute offsets for each additional section
  let offsets: number[];
  if (heights) {
    offsets = heights;
  } else if (height !== undefined) {
    // Distribute evenly: h*1/(n), h*2/(n), ... h
    offsets = [];
    for (let i = 1; i <= n; i++) {
      offsets.push(height * i / n);
    }
  } else {
    throw new Error('loft requires either a height or heights list');
  }

  // For each source face, build a loft with corresponding section wires
  let newShape = s.shape;
  for (const srcFace of faces) {
    // Collect all wires: source boundary at offset 0, then each section translated
    const allWires: Wire[] = [faceBoundary(oc, srcFace, 'loft')];
    for (let i = 0; i < n; i++) {
      const d = offsets[i];
      // Each sectionWires[i] may have multiple wires; take the first
      const w = sectionWires[i][0];
      const translated = oc.translate(w, normal.x * d, normal.y * d, normal.z * d);
      allWires.push(translated as Wire);
    }
    const solid = oc.loft(allWires, true, ruled ?? false);
    if (newShape) {
      newShape = ensureSolid(oc, oc.fuse(newShape, solid));
    } else {
      newShape = solid;
    }
  }
  return cloneState(s, { shape: newShape, faces: [], selectedFaces: [], selectedEdges: [] });
}

/** The drawing a cut removes from the solid. */
function cutFaces(s: WpState): Face[] {
  const faces = requireFaces(s, 'cut');
  if (faces.length === 0) {
    throw new Error(
      `cut: nothing is drawn on the selected face. ` +
      `Draw the outline first ('box 10 10 10 | faces >Z | circle 3 | cut 2')`,
    );
  }
  return faces;
}

export function wpCutThruAll(s: WpState): WpState {
  const { oc } = s;
  const solid = requireSolid(s, 'cut');
  const faces = cutFaces(s);
  const bb = fastBoundingBox(oc, solid);
  const cutHeight = Math.max(bb.xlen, bb.ylen, bb.zlen) * 4;
  const normal = planeNormal(s.plane);
  const tools: Shape[] = [];
  for (const face of faces) {
    const toolPos = oc.extrude(face, normal.x * cutHeight, normal.y * cutHeight, normal.z * cutHeight);
    const toolNeg = oc.extrude(face, -normal.x * cutHeight, -normal.y * cutHeight, -normal.z * cutHeight);
    tools.push(ensureSolid(oc, oc.fuse(toolPos, toolNeg)));
  }
  const newShape = cutTools(oc, solid, tools);
  return cloneState(s, { shape: newShape, faces: [], selectedFaces: [], selectedEdges: [] });
}

export function wpCutBlind(s: WpState, depth: number): WpState {
  const { oc } = s;
  let newShape = requireSolid(s, 'cut');
  const faces = cutFaces(s);
  const normal = planeNormal(s.plane);
  const dx = normal.x * depth;
  const dy = normal.y * depth;
  const dz = normal.z * depth;
  for (const face of faces) {
    const tool = oc.extrude(face, dx, dy, dz);
    newShape = ensureSolid(oc, oc.cut(newShape, tool));
  }
  return cloneState(s, { shape: newShape, faces: [], selectedFaces: [], selectedEdges: [] });
}

/**
 * Cut every tool out of `shape` in one boolean.
 *
 * A hole grid used to loop `cut` once per tool; `cutAll` hands the whole tool
 * list to a single BRepAlgoAPI_Cut (SetTools + SetRunParallel + SetUseOBB),
 * which intersects the base shape once instead of N times.
 */
function cutTools(oc: OC, shape: Shape, tools: Shape[]): Shape {
  if (tools.length === 0) return shape;
  if (tools.length === 1) return pruneDebrisSolids(oc, ensureSolid(oc, oc.cut(shape, tools[0])));
  return pruneDebrisSolids(oc, ensureSolid(oc, oc.cutAll(shape, tools)));
}

export function wpHole(s: WpState, radius: number, depth?: number): WpState {
  const { oc } = s;
  let newShape = requireSolid(s, 'hole');
  const offsets = getOffsets(s);

  let cutH: number;
  if (depth === undefined) {
    const bb = fastBoundingBox(oc, newShape);
    cutH = Math.max(bb.xlen, bb.ylen, bb.zlen) * 4;
  } else {
    cutH = depth;
  }

  const normal = planeNormal(s.plane);

  const tools: Shape[] = [];
  for (const [cx, cy] of offsets) {
    let cyl: Shape;
    if (depth === undefined) {
      // Through-all: use a single centered cylinder to avoid a seam face
      // that results from fusing two half-cylinder extrusions.
      const center3d = to3d(oc, s.plane, cx, cy);
      cyl = oc.makeCylinder(radius, 2 * cutH);
      cyl = oc.translate(cyl, 0, 0, -cutH);
      cyl = alignZToDir(oc, cyl, [normal.x, normal.y, normal.z]);
      cyl = oc.translate(cyl, center3d.x, center3d.y, center3d.z);
    } else {
      // Blind hole: extrude from entry point into the solid
      const circWire = makeCircleWire(oc, radius, s.plane, cx, cy);
      const cirFace = makeFaceFromWire(oc, circWire);
      cyl = oc.extrude(cirFace, -normal.x * cutH, -normal.y * cutH, -normal.z * cutH);
    }
    tools.push(cyl);
  }
  newShape = cutTools(oc, newShape, tools);

  return cloneState(s, { shape: newShape, faces: [], wires: [], points: null, selectedFaces: [], selectedEdges: [] });
}

/**
 * Create holes at the center of each selected face.
 * Equivalent to: for each selected face, create a workplane, place a circle, and cut.
 * `faces >Z | hole 5` === `faces >Z | circle 5 | cut`
 */
export function wpFaceHole(s: WpState, radius: number, depth?: number): WpState {
  const { oc } = s;
  if (!s.shape || s.selectedFaces.length === 0) return s;

  let newShape: Shape = s.shape;

  let cutH: number;
  if (depth === undefined) {
    const bb = fastBoundingBox(oc, s.shape);
    cutH = Math.max(bb.xlen, bb.ylen, bb.zlen) * 4;
  } else {
    cutH = depth;
  }

  const tools: Shape[] = [];
  for (const face of s.selectedFaces) {
    const center = faceCenter(oc, face);
    const normal = faceNormal(oc, face);

    // Build a local workplane on this face
    let xdir: Dir;
    if (Math.abs(normal.z) > 0.9) {
      xdir = { x: 1, y: 0, z: 0 };
    } else {
      const zDir = { x: 0, y: 0, z: 1 };
      const cx = zDir.y * normal.z - zDir.z * normal.y;
      const cy = zDir.z * normal.x - zDir.x * normal.z;
      const cz = zDir.x * normal.y - zDir.y * normal.x;
      const mag = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (mag < 1e-6) {
        xdir = { x: 1, y: 0, z: 0 };
      } else {
        xdir = { x: cx / mag, y: cy / mag, z: cz / mag };
      }
    }
    const yd = {
      x: normal.y * xdir.z - normal.z * xdir.y,
      y: normal.z * xdir.x - normal.x * xdir.z,
      z: normal.x * xdir.y - normal.y * xdir.x,
    };
    const plane: Pln = { origin: center, normal, xDir: xdir, yDir: yd };

    let cyl: Shape;
    if (depth === undefined) {
      // Through-all: use a single centered cylinder to avoid a seam face
      cyl = oc.makeCylinder(radius, 2 * cutH);
      cyl = oc.translate(cyl, 0, 0, -cutH);
      cyl = alignZToDir(oc, cyl, [normal.x, normal.y, normal.z]);
      cyl = oc.translate(cyl, center.x, center.y, center.z);
    } else {
      // Blind hole: extrude from face center into the solid
      const circWire = makeCircleWire(oc, radius, plane, 0, 0);
      const cirFace = makeFaceFromWire(oc, circWire);
      cyl = oc.extrude(cirFace, -normal.x * cutH, -normal.y * cutH, -normal.z * cutH);
    }
    tools.push(cyl);
  }
  newShape = cutTools(oc, newShape, tools);

  return cloneState(s, { shape: newShape, faces: [], wires: [], points: null, selectedFaces: [], selectedEdges: [] });
}
