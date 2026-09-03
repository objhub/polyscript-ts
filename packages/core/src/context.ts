/**
 * Shared pipeline context types and transitions.
 * Used by both the validator and the evaluator.
 */

export type PipelineContext =
  | 'Workplane'
  | '2D'
  | '3D'
  | 'FaceSelection'
  | 'EdgeSelection'
  | 'VertexSelection'
  | 'PointSelection'
  | 'unknown';

/** Compute the next context after a pipe operation. */
export function nextContext(ctx: PipelineContext, opType: string): PipelineContext {
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
      // 2D bool stays in 2D (face-level), 3D bool stays in 3D.
      return ctx === '2D' ? '2D' : '3D';
    case 'Translate':
      if (ctx === 'VertexSelection' || ctx === 'PointSelection') return ctx;
      return '3D';
    case 'Fillet': case 'Chamfer':
      return ctx === '2D' ? '2D' : '3D';
    case 'Offset':
      return '2D';
    case 'Implicit2DPrimitive':
    case 'Place':
      return '2D';
    case 'Implicit3DPrimitive':
      return '3D';
    case 'GridPipe': case 'PolarPipe':
      return (ctx === 'FaceSelection' || ctx === 'PointSelection') ? 'PointSelection' : ctx;
    case 'Color': case 'AsTag':
      return ctx;
    case 'Move': case 'MoveTo':
      // move/moveto after face/edge selection establishes a 2D drawing
      // context (so subsequent ops like hole dispatch to the 2D variant
      // instead of the face-center variant).
      if (ctx === 'FaceSelection' || ctx === 'EdgeSelection') return '2D';
      return ctx;
    default:
      return ctx;
  }
}
