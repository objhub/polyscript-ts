/**
 * Shared pipeline context types and transitions.
 * Used by both the validator and the evaluator.
 *
 * 2D content has two types (devel/2d-face-wire202609.md): a `Face` is a
 * region with area (rect, circle, sketch, text, 2D booleans, offset results)
 * and a `Wire` is a curve (line, arc, bezier, spline, helix, `wire [...]`).
 * The type is fixed by the constructor -- a closed wire never becomes a face
 * by itself; only `offset` turns a wire into a face.
 */

import type { Expression, PipeOp } from './ast.js';

export type PipelineContext =
  | 'Workplane'
  | 'Face'
  | 'Wire'
  | '3D'
  | 'FaceSelection'
  | 'EdgeSelection'
  | 'VertexSelection'
  | 'PointSelection'
  | 'unknown';

/** Expression types that construct a Wire (curve) rather than a Face. */
const WIRE_SOURCES = new Set<string>([
  'WireLiteralExpr', 'LinePathExpr', 'ArcPathExpr', 'CenterArcPathExpr',
  'BezierPathExpr', 'HelixPathExpr', 'SplinePathExpr',
]);

/** Expression types that construct a Face (region). */
const FACE_SOURCES = new Set<string>([
  'RectExpr', 'CircleExpr', 'EllipseExpr', 'PolylineExpr', 'PolygonExpr',
  'TextExpr', 'SketchExpr',
]);

/**
 * Static 2D type of a constructor expression: 'Face', 'Wire', or null when the
 * expression is not a 2D constructor (a variable, a call, a 3D primitive).
 */
export function static2DType(expr: Expression | undefined): 'Face' | 'Wire' | null {
  if (!expr) return null;
  if (WIRE_SOURCES.has(expr.type)) return 'Wire';
  if (FACE_SOURCES.has(expr.type)) return 'Face';
  if (expr.type === 'BinOp' && shapeOperatorKind(expr.op)) {
    // A boolean of 2D operands is a Face (a Wire operand is an eval error).
    return (static2DType(expr.left) ?? static2DType(expr.right)) ? 'Face' : null;
  }
  return null;
}

/** The boolean a shape operator spells, or null for any other operator. */
export function shapeOperatorKind(op: string): 'union' | 'diff' | 'inter' | null {
  switch (op) {
    case '+': return 'union';
    case '-': return 'diff';
    case '*': return 'inter';
    default: return null;
  }
}

/** Source keyword of each pipe op node type, for messages and the trace. */
export const OP_KEYWORD: Record<string, string> = {
  FacesSelect: 'faces', EdgesSelect: 'edges', VertsSelect: 'verts', PointsSelect: 'points',
  Workplane: 'workplane', AsTag: 'as',
  Fillet: 'fillet', Chamfer: 'chamfer', Shell: 'shell', Offset: 'offset',
  Diff: 'diff', Union: 'union', Inter: 'inter', Place: 'place',
  Hole: 'hole', Cut: 'cut', Extrude: 'extrude', Revolve: 'revolve', Sweep: 'sweep', Loft: 'loft',
  Translate: 'translate', Rotate: 'rotate', Scale: 'scale', Move: 'move', MoveTo: 'moveto',
  Mirror: 'mirror', Floor: 'floor', Color: 'color',
  GridPipe: 'grid', PolarPipe: 'polar',
  Implicit2DPrimitive: '2d', Implicit3DPrimitive: '3d',
};

/** The keyword a pipe op was written with (`rect` for an implicit 2D
 * primitive, not the AST name `Implicit2DPrimitive`). */
export function opKeyword(op: PipeOp): string {
  if (op.type === 'Implicit2DPrimitive' || op.type === 'Implicit3DPrimitive') {
    const prim = op.primitive.type;
    if (prim === 'WireLiteralExpr') return 'wire';
    return prim.replace(/(Path)?Expr$/, '').toLowerCase();
  }
  return OP_KEYWORD[op.type] ?? op.type.toLowerCase();
}

function is2D(ctx: PipelineContext): boolean {
  return ctx === 'Face' || ctx === 'Wire';
}

/**
 * Compute the next context after a pipe operation.
 *
 * `op` is the operation node when the caller has it; a few transitions depend
 * on the operand (`| wire [...]` yields Wire, `| rect w h` yields Face) and
 * fall back to Face without it.
 */
export function nextContext(ctx: PipelineContext, opType: string, op?: PipeOp): PipelineContext {
  switch (opType) {
    case 'FacesSelect': return 'FaceSelection';
    case 'EdgesSelect': return 'EdgeSelection';
    case 'VertsSelect': return 'VertexSelection';
    case 'PointsSelect': return 'PointSelection';
    case 'Workplane': return 'Workplane';
    case 'Extrude': case 'Revolve': case 'Sweep': case 'Loft': case 'Cut': case 'Hole':
    case 'Shell': case 'Rotate': case 'Scale': case 'Mirror':
      return '3D';
    case 'Diff': case 'Union': case 'Inter':
      // 2D bool stays on faces, 3D bool stays in 3D.
      return is2D(ctx) ? 'Face' : '3D';
    case 'Translate':
      if (ctx === 'VertexSelection' || ctx === 'PointSelection') return ctx;
      return '3D';
    case 'Fillet': case 'Chamfer':
      // 2D fillet rounds the corners of whatever is drawn, keeping its type.
      return is2D(ctx) ? ctx : '3D';
    case 'Offset':
      // The one Wire -> Face transition: a thickened curve is a region.
      return 'Face';
    case 'Implicit2DPrimitive': {
      const prim = op && op.type === 'Implicit2DPrimitive' ? op.primitive : undefined;
      return static2DType(prim) ?? 'Face';
    }
    case 'Place': {
      const arg = op && op.type === 'Place' ? op.args[0] : undefined;
      const t = static2DType(arg);
      if (t) return t;
      return ctx === 'Wire' ? 'Wire' : 'Face';
    }
    case 'Implicit3DPrimitive':
      return '3D';
    case 'GridPipe': case 'PolarPipe':
      return (ctx === 'FaceSelection' || ctx === 'PointSelection') ? 'PointSelection' : ctx;
    case 'Color': case 'AsTag':
      return ctx;
    case 'Move': case 'MoveTo':
      // move/moveto after a face/edge selection turns the selection into a
      // drawing cursor on that face (so subsequent ops like hole dispatch to
      // the workplane variant instead of the face-center variant).
      if (ctx === 'FaceSelection' || ctx === 'EdgeSelection') return 'Workplane';
      return ctx;
    default:
      return ctx;
  }
}
