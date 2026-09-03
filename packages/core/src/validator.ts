/**
 * PolyScript validator — context model type checking.
 *
 * Tracks the context (Workplane/2D/3D/FaceSelection/EdgeSelection/VertexSelection/PointSelection)
 * as it walks through pipeline operations, and reports errors when an operation
 * is used in an invalid context.
 */

import type {
  Program, Statement, Expression, PipeOp, Pipeline,
  FuncDef,
} from './ast.js';
import { nextContext } from './context.js';

// --- Context types ---

export type Context =
  | 'Workplane'
  | '2D'
  | '3D'
  | 'FaceSelection'
  | 'EdgeSelection'
  | 'VertexSelection'
  | 'PointSelection';

// --- Validation error ---

export interface ValidationError {
  message: string;
  nodeType: string;
}

// --- Allowed operations per context ---

const CONTEXT_OPS: Record<Context, Set<string>> = {
  Workplane: new Set([
    'RectExpr', 'CircleExpr', 'EllipseExpr', 'PolylineExpr', 'PolygonExpr', 'TextExpr',
    'Implicit2DPrimitive', 'Place',
    'PointsSelect',
    // A workplane is a drawing cursor: you can reposition it, drill at its
    // origin, or turn it into a point set. `faces >Z | workplane origin: 0 0
    // | hole r` is the documented way to drill at an explicit spot.
    'Hole', 'Move', 'MoveTo', 'GridPipe', 'PolarPipe', 'AsTag',
  ]),
  '2D': new Set([
    'Extrude', 'Revolve', 'Sweep', 'Loft', 'Cut', 'Hole', 'Fillet', 'Offset',
    'Move', 'MoveTo', 'Implicit2DPrimitive', 'Place',
    'Diff', 'Union', 'Inter',
    'VertsSelect',
    'GridPipe', 'PolarPipe',
  ]),
  '3D': new Set([
    'FacesSelect', 'EdgesSelect', 'VertsSelect',
    'Fillet', 'Chamfer', 'Shell',
    'Diff', 'Union', 'Inter',
    'Translate', 'Rotate', 'Scale', 'Mirror', 'Floor',
    'Color',
    'AsTag',
    'GridPipe', 'PolarPipe',
  ]),
  FaceSelection: new Set([
    'Workplane', 'PointsSelect', 'Fillet', 'Chamfer', 'Shell', 'Offset', 'AsTag',
    'Implicit2DPrimitive', 'Place', 'Hole', 'Move', 'MoveTo',
    // SPEC L1035-1039: `grid`/`polar` after `faces` are shorthand for
    // `points (grid ...)` / `points (polar ...)` and transition to PointSelection.
    'GridPipe', 'PolarPipe',
  ]),
  EdgeSelection: new Set([
    'Fillet', 'Chamfer', 'AsTag',
  ]),
  VertexSelection: new Set([
    'Implicit2DPrimitive', 'Implicit3DPrimitive', 'AsTag', 'Translate', 'Place',
  ]),
  PointSelection: new Set([
    'Hole', 'Implicit2DPrimitive', 'Implicit3DPrimitive', 'Translate', 'Place',
    // devel/TODO.md: grid/polar chain in point context.
    'GridPipe', 'PolarPipe',
  ]),
};

// --- Source expression context ---

function sourceContext(expr: Expression): Context | null {
  switch (expr.type) {
    case 'BoxExpr':
    case 'CylinderExpr':
    case 'SphereExpr':
      return '3D';
    case 'RectExpr':
    case 'CircleExpr':
    case 'EllipseExpr':
    case 'PolylineExpr':
    case 'PolygonExpr':
    case 'TextExpr':
    case 'SketchExpr':
    case 'WireLiteralExpr':
    case 'LinePathExpr':
    case 'ArcPathExpr':
    case 'CenterArcPathExpr':
    case 'BezierPathExpr':
    case 'HelixPathExpr':
    case 'SplinePathExpr':
      return '2D';
    case 'Union':
    case 'Diff':
    case 'Inter': {
      // Determine context from the list elements (e.g. union [rect ...] → 2D).
      // null (an operand that cannot be resolved statically, such as a
      // variable) must propagate: assuming 3D here rejects the legal
      // `union [$profile, circle 9.5] | extrude 8`.
      const listArg = expr.args[0];
      const probe =
        listArg && listArg.type === 'ListLit' && listArg.elements.length > 0
          ? listArg.elements[0]
          : listArg;
      if (probe) return sourceContext(probe);
      return '3D';
    }
    case 'Workplane':
      return 'Workplane';
    case 'Pipeline':
      return pipelineResultContext(expr);
    case 'FuncCall':
    case 'VarRef':
      // Can't statically determine — return null to skip validation
      return null;
    default:
      return '3D';
  }
}

function pipelineResultContext(pipeline: Pipeline): Context | null {
  let ctx = sourceContext(pipeline.source);
  for (const op of pipeline.ops) {
    if (ctx === null) return null;
    ctx = nextContext(ctx, op.type) as Context;
  }
  return ctx;
}

// --- Validator ---

export function validate(program: Program): ValidationError[] {
  const errors: ValidationError[] = [];
  const funcDefs = new Map<string, FuncDef>();
  const variables = new Set<string>();

  for (const stmt of program.statements) {
    validateStatement(stmt, errors, funcDefs, variables);
  }

  return errors;
}

function validateStatement(
  stmt: Statement,
  errors: ValidationError[],
  funcDefs: Map<string, FuncDef>,
  variables: Set<string>,
): void {
  switch (stmt.type) {
    case 'FuncDef':
      funcDefs.set(stmt.name, stmt);
      // Validate function body
      validateExpression(stmt.body, errors, funcDefs, variables);
      break;
    case 'Assignment':
      variables.add(stmt.name);
      validateExpression(stmt.value, errors, funcDefs, variables);
      break;
    case 'Import':
      break;
    default:
      validateExpression(stmt, errors, funcDefs, variables);
  }
}

function validateExpression(
  expr: Expression,
  errors: ValidationError[],
  funcDefs: Map<string, FuncDef>,
  variables: Set<string>,
): void {
  if (expr.type === 'Pipeline') {
    validatePipeline(expr, errors);
  }

  // Check variable/function references
  if (expr.type === 'VarRef' && !variables.has(expr.name)) {
    // Not an error during parsing — could be a parameter or forward reference
    // Soft check only
  }

  if (expr.type === 'FuncCall' && !funcDefs.has(expr.name) && !variables.has(expr.name)) {
    // Could be an imported function — soft check only
  }

  // Recurse into IndexAccess sub-expressions
  if (expr.type === 'IndexAccess') {
    validateExpression(expr.object, errors, funcDefs, variables);
    validateExpression(expr.index, errors, funcDefs, variables);
  }
}

function validatePipeline(pipeline: Pipeline, errors: ValidationError[]): void {
  let ctx: Context | null = sourceContext(pipeline.source);

  for (const op of pipeline.ops) {
    // Skip validation when context is unknown (e.g. FuncCall/VarRef source)
    if (ctx !== null) {
      const allowed = CONTEXT_OPS[ctx];
      if (allowed && !allowed.has(op.type)) {
        errors.push({
          message: `Operation '${op.type}' is not valid in ${ctx} context`,
          nodeType: op.type,
        });
      }
      ctx = nextContext(ctx, op.type) as Context;
    } else {
      // Context is unknown (a VarRef or FuncCall source). Only recover it from
      // ops whose result context does not depend on their input -- `extrude`
      // always yields 3D, `faces` always yields a FaceSelection.
      //
      // Assuming 3D for the rest used to "recover" a context that was never
      // established, and then reject legal pipelines built on it:
      // `$profile | polar 6 0 | union (circle 5) | extrude 3` was refused
      // because the boolean was judged in the invented 3D context.
      const from3D = nextContext('3D', op.type);
      const from2D = nextContext('2D', op.type);
      if (from3D === from2D) ctx = from3D as Context;
    }
  }

  // Validate nested expressions in pipe ops
  for (const op of pipeline.ops) {
    validatePipeOpNested(op, errors);
  }
}

function validatePipeOpNested(op: PipeOp, errors: ValidationError[]): void {
  // Check required arguments
  switch (op.type) {
    case 'Revolve':
      // axis is always present (parser enforces it)
      // degrees is optional (defaults to 360 at eval time)
      // No further validation needed here.
      break;
    case 'Extrude':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "extrude requires a height argument",
          nodeType: 'Extrude',
        });
      }
      break;
    case 'Loft':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "loft requires a sections list argument",
          nodeType: 'Loft',
        });
      }
      break;
    case 'Hole':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "hole requires a radius argument",
          nodeType: 'Hole',
        });
      }
      break;
    case 'Fillet':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "fillet requires a radius argument",
          nodeType: 'Fillet',
        });
      }
      break;
    case 'Chamfer':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "chamfer requires a radius argument",
          nodeType: 'Chamfer',
        });
      }
      break;
    case 'Shell':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "shell requires a thickness argument",
          nodeType: 'Shell',
        });
      }
      break;
    case 'Offset':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "offset requires a distance argument",
          nodeType: 'Offset',
        });
      }
      break;
    case 'Scale':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "scale requires a factor argument",
          nodeType: 'Scale',
        });
      }
      break;
    case 'Mirror':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: "mirror requires an axis argument",
          nodeType: 'Mirror',
        });
      }
      break;
    case 'Diff':
    case 'Union':
    case 'Inter':
      if ('args' in op && op.args.length === 0) {
        errors.push({
          message: `${op.type.toLowerCase()} requires a shape argument`,
          nodeType: op.type,
        });
      }
      break;
  }
}
