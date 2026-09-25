/**
 * Structured diagnostics — the machine-readable channel for everything that
 * went wrong.
 *
 * Every diagnostic carries a **stable code**, so a caller can key off it
 * instead of matching prose: docs anchor on it, `poly explain <code>` prints
 * the long form, and an agent driving the CLI can look up the fix without
 * re-reading a reference file. The prose in `message` may be reworded at any
 * time; the code may not.
 *
 * This module is also the process-wide sink for kernel-level warnings. The
 * selector engine has no channel back to the CLI (Python uses the stdlib
 * `warnings` module for the same purpose); the CLI drains the sink after a run
 * and turns entries into report diagnostics, and into failures under --strict.
 */

import type { SourceLocation } from './ast.js';

export type Severity = 'error' | 'warning' | 'info';

/**
 * The closed set of diagnostic codes.
 *
 * Namespaced by phase so the prefix alone says where the run died:
 * `syntax.` parse, `context.`/`arg.`/`def.`/`call.` validation, `selector.`/`eval.` runtime,
 * `check.` post-build observations (informational -- never fail a build),
 * `param.`/`io.` the CLI's own surface.
 */
export const DIAGNOSTIC_CODES = [
  'syntax.parse',
  'context.invalid-op',
  'arg.missing',
  'def.shadows-builtin',
  'call.arity',
  'selector.empty',
  'selector.unknown',
  'eval.error',
  'check.multiple-solids',
  'check.no-effect',
  'check.brep-invalid',
  'param.unknown',
  'io.read',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** One line, no position and no fix -- those are separate fields. */
  message: string;
  /** What to do about it. Imperative, one line. */
  hint?: string;
  line?: number;
  column?: number;
}

/**
 * Narrow an arbitrary `code` property to this module's set.
 *
 * Errors thrown by occt-wasm carry codes of their own (`CONSTRUCTION_FAILED`,
 * `StdFail_NotDone`, ...). They are useful text, but they are not diagnostic
 * codes: nothing documents them, `poly explain` has no entry, and letting them
 * through would break the promise that `code` comes from a closed set.
 */
export function asDiagnosticCode(code: unknown): DiagnosticCode | undefined {
  return (DIAGNOSTIC_CODES as readonly string[]).includes(code as string)
    ? (code as DiagnosticCode)
    : undefined;
}

export function makeDiagnostic(
  code: DiagnosticCode,
  severity: Severity,
  message: string,
  opts: { hint?: string; loc?: SourceLocation } = {},
): Diagnostic {
  const d: Diagnostic = { code, severity, message };
  if (opts.hint) d.hint = opts.hint;
  if (opts.loc) {
    d.line = opts.loc.line;
    d.column = opts.loc.column;
  }
  return d;
}

/** `file:line:col error code: message -- hint`, one line, gcc-ish so an
 *  editor and a human reader both find the spot. */
export function formatDiagnostic(d: Diagnostic, file?: string): string {
  const where = d.line !== undefined
    ? `${file ? `${file}:` : ''}${d.line}:${d.column ?? 0} `
    : file ? `${file}: ` : '';
  const hint = d.hint ? ` -- ${d.hint}` : '';
  return `${where}${d.severity} ${d.code}: ${d.message}${hint}`;
}

/** An Error that carries a diagnostic code and a fix.
 *
 * The kernel throws these from deep inside OCCT-facing code, where the AST
 * node is out of reach; the evaluator adds the source position on the way out
 * and the CLI turns the whole thing into one diagnostic. */
export interface CodedError extends Error {
  code?: DiagnosticCode;
  hint?: string;
}

export function codedError(code: DiagnosticCode, message: string, hint?: string): CodedError {
  const e = new Error(message) as CodedError;
  e.code = code;
  if (hint) e.hint = hint;
  return e;
}

// --- Process-wide sink -------------------------------------------------------

const _sink: Diagnostic[] = [];

export function pushDiagnostic(d: Diagnostic): void {
  _sink.push(d);
}

/** Record a kernel-level warning. The code defaults to nothing useful on
 *  purpose: every call site should name its own. */
export function pushWarning(
  message: string,
  opts: { code?: DiagnosticCode; hint?: string; loc?: SourceLocation } = {},
): void {
  _sink.push(makeDiagnostic(opts.code ?? 'eval.error', 'warning', message, opts));
}

/** Return everything recorded and clear the sink. */
export function drainDiagnostics(): Diagnostic[] {
  return _sink.splice(0, _sink.length);
}

// --- Long-form explanations (`poly explain <code>`) --------------------------

interface Explanation {
  title: string;
  /** Why this happens, and what the failure looks like if unnoticed. */
  why: string;
  /** A wrong/right pair, or the concrete steps out. */
  fix: string;
}

const EXPLANATIONS: Record<DiagnosticCode, Explanation> = {
  'syntax.parse': {
    title: 'The file is not valid PolyScript',
    why: 'The parser stopped at the reported line and column. Common causes: a\n'
      + 'pipe with nothing after it, an unclosed bracket or quote, and\n'
      + 'subtraction written without spaces (`10 -5` parses as two arguments).',
    fix: 'Arithmetic minus needs a space on both sides; a negative literal needs\n'
      + 'none:\n'
      + '  a = 10 - 5      # subtraction\n'
      + '  b = -5          # negative literal\n'
      + '  c = 10 -5       # ambiguous, and read as two arguments',
  },
  'context.invalid-op': {
    title: 'This operation is not legal on what the pipeline is holding',
    why: 'A pipeline moves through contexts: a solid (3D), a selection of faces\n'
      + 'or edges, a 2D region (Face) or curve (Wire). Each operation accepts\n'
      + 'only some of them -- `extrude` needs a Face, `shell` needs a face\n'
      + 'selection, `fillet` needs an edge selection.',
    fix: 'Insert the step that produces the context the operation wants:\n'
      + '  box 10 10 10 | faces ">Z" | shell 2        # select before shelling\n'
      + '  rect 50 30 | extrude 5                     # extrude a region\n'
      + '  wire [(0,0), (10,0)] | offset 1 | extrude 5 # a curve has no area\n'
      + 'The message lists the contexts the operation is allowed in.',
  },
  'arg.missing': {
    title: 'A required argument was not given',
    why: 'The operation has no default for that argument, so there is nothing\n'
      + 'sensible to assume.',
    fix: 'Supply it: `fillet 2`, `shell 1.5`, `extrude 10`, `hole 3`.',
  },
  'def.shadows-builtin': {
    title: 'A def has the name of a built-in function',
    why: 'Calls resolve to the built-in first, so the def is never reached.\n'
      + 'Nothing else would tell you: `def rad($R, $k, $t) = ...` followed by\n'
      + '`rad($R, $k, $t)` calls the degrees-to-radians built-in, drops the\n'
      + 'extra arguments, and builds a part a hundred times too small with\n'
      + 'exit 0.',
    fix: 'Rename the def:\n'
      + '  def rad($R, $k) = ...          # never called\n'
      + '  def radius_at($R, $k) = ...    # called\n'
      + 'The built-ins are sin cos tan asin acos atan atan2 sqrt abs floor\n'
      + 'ceil round min max radians degrees rad deg len range.',
  },
  'call.arity': {
    title: 'A built-in function was called with the wrong number of arguments',
    why: 'Built-ins take a fixed number of arguments (min and max take one or\n'
      + 'more, range one to three). Extra arguments used to be dropped\n'
      + 'silently, which usually means the call was meant for a def of the\n'
      + 'same name.',
    fix: 'Pass the arguments the built-in takes: `sin(30)`, `atan2(y, x)`,\n'
      + '`range(0, 10, 2)`. If you meant your own function, give it a name\n'
      + 'that is not a built-in (see def.shadows-builtin).',
  },
  'selector.empty': {
    title: 'A selector matched nothing',
    why: 'This is the most damaging silent failure in the language, which is why\n'
      + 'it is an error and not a warning. With an empty selection the next\n'
      + 'operation either does nothing (`hole`, `workplane`) or widens to\n'
      + 'everything (`fillet`, `chamfer`): a box asked for a rounded top edge\n'
      + 'comes out rounded all over, with a plausible volume, a valid B-Rep and\n'
      + 'exit 0.',
    fix: 'Read the selector symbols, which are not intuitive:\n'
      + '  >Z <Z   the topmost / bottommost faces or edges\n'
      + '  =Z      edges PARALLEL to Z (the four vertical corners of a box)\n'
      + '  +Z      faces PERPENDICULAR to Z (the sides, not the top)\n'
      + '`>Z and =Z` is the classic empty match: a top face has no edge that\n'
      + 'also runs along Z. Use `poly verify --trace` to see what each step\n'
      + 'selected, including the centroid and normal of the selection.',
  },
  'selector.unknown': {
    title: 'The selector string was not recognised, so nothing was filtered',
    why: 'An unparsable selector applies no filter at all, which reads as\n'
      + 'success: `faces "Z"` keeps all six faces of a box and the following\n'
      + '`shell` hollows the whole thing.',
    fix: 'A selector is an operator plus an axis: `>Z`, `<X`, `=Z`, `+Y`. The\n'
      + 'operator is not optional. Quote it: `faces ">Z"`.',
  },
  'eval.error': {
    title: 'The geometry kernel refused the operation',
    why: 'The pipeline was legal but the shape was not buildable: a degenerate\n'
      + 'radius, a fillet larger than the material, a boolean between a solid\n'
      + 'and a 2D region, an OCCT limit (`shell` after `fillet`).',
    fix: 'Bisect the pipeline: build it up to the failing step and inspect it\n'
      + 'with `poly verify --trace`, which reports volume, solid count and face\n'
      + 'count after every step. Order matters: `fillet` before `shell`.',
  },
  'check.multiple-solids': {
    title: 'The result is more than one solid',
    why: 'Two parts that only touch do not fuse: a boss sitting exactly on a\n'
      + 'floor, a cylinder tangent to a plane, or a part that floats because a\n'
      + 'wall came out thinner than assumed. Nothing errors, the volume looks\n'
      + 'right, and the piece prints as loose fragments.',
    fix: 'If it should be one piece, overlap the parts by 0.5-1mm and union\n'
      + 'again. Face-to-face contact does fuse; line contact (a curved surface\n'
      + 'meeting a flat one) does not. Several shipped examples are deliberately\n'
      + 'multi-solid, so this is informational -- compare it against intent.',
  },
  'check.no-effect': {
    title: 'An operation did not change the shape',
    why: 'A `hole` on an empty face selection, a `fillet` whose radius rounded\n'
      + 'nothing, a `diff` whose tool missed the material. The build succeeds\n'
      + 'and the feature is simply absent.',
    fix: 'Check the step before it in the trace: what it selected, and whether\n'
      + 'the tool actually overlaps the material. A tool that exactly touches a\n'
      + 'surface is the usual cause -- make it overlap or clear the surface,\n'
      + 'never exactly tangent.',
  },
  'check.brep-invalid': {
    title: 'OCCT reports the resulting B-Rep as invalid',
    why: 'Self-intersecting faces, degenerate edges or debris solids left by a\n'
      + 'boolean between tangent surfaces. Exports may still succeed and produce\n'
      + 'a mesh no slicer can print.',
    fix: 'Find the step that broke it with `poly verify --trace`: a jump in the\n'
      + 'face count or a solid count above 1 usually marks it. Avoid booleans\n'
      + 'whose tool exactly touches the material surface.',
  },
  'param.unknown': {
    title: '-D named a parameter the file does not declare',
    why: 'The override was ignored, so the model was built with its own defaults\n'
      + 'and the reported dimensions are not the ones asked for.',
    fix: 'Declare it with an @param annotation above the assignment:\n'
      + '  # @param 60..120 desc:"width (mm)"\n'
      + '  width = 80',
  },
  'io.read': {
    title: 'The file could not be read',
    why: 'Wrong path, or no permission.',
    fix: 'Check the path. `-` reads the source from stdin.',
  },
};

export function explain(code: string): string | null {
  const e = EXPLANATIONS[code as DiagnosticCode];
  if (!e) return null;
  return `${code} -- ${e.title}\n\nWhy\n${e.why}\n\nFix\n${e.fix}`;
}
