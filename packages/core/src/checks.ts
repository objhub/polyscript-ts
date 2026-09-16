/**
 * Post-build observations — the checklist a human reviewer would run, done in
 * numbers.
 *
 * These are the failures that leave a healthy-looking solid and exit 0: parts
 * that never fused, an operation that quietly did nothing, a B-Rep OCCT calls
 * invalid. None of them is reliably wrong -- several shipped examples are
 * deliberately multi-solid -- so every check here is `info`: it never fails a
 * build, not even under --strict. It exists so the number lands in the report
 * next to the trace, where whoever reads it can compare it against intent.
 *
 * Only discrete or clearly-thresholded quantities, per
 * devel/lang-vision202609.md section 4.3: solid counts and face counts are
 * stable, and the volume comparisons below are relative and generous.
 */

import { makeDiagnostic, type Diagnostic } from './diagnostics.js';
import type { TraceStep } from './trace.js';
import type { ShapeInfo } from './ocp-kernel/analysis.js';

/** Ops that must remove material. */
const MUST_REDUCE = new Set(['hole', 'cut', 'diff', 'shell']);

/** Ops that must change the face count (and normally the volume with it). */
const MUST_REFACE = new Set(['fillet', 'chamfer']);

/** Relative tolerance for "the volume did not move". Loose on purpose: this is
 *  a flag for a human, and a feature that shaves off a millionth of the volume
 *  is not the feature that was asked for either. */
const VOLUME_EPS = 1e-9;

export function runChecks(trace: TraceStep[] | undefined, info: ShapeInfo | null): Diagnostic[] {
  const out: Diagnostic[] = [];

  if (info && info.solids > 1) {
    out.push(makeDiagnostic(
      'check.multiple-solids',
      'info',
      `the result is ${info.solids} solids, not 1`,
      {
        hint: 'parts that only touch along a curve do not fuse -- overlap them by 0.5mm '
          + 'and union again, unless they are meant to be separate pieces',
      },
    ));
  }

  if (info && !info.is_valid) {
    out.push(makeDiagnostic(
      'check.brep-invalid',
      'info',
      'OCCT reports the result as an invalid B-Rep',
      { hint: 'look for the step where the face count jumps; tangent booleans are the usual cause' },
    ));
  }

  out.push(...noEffectChecks(trace ?? []));
  return out;
}

/** Steps whose numbers say the operation did not happen. */
function noEffectChecks(trace: TraceStep[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (let i = 1; i < trace.length; i++) {
    const step = trace[i];
    const prev = trace[i - 1];
    // Only against the step immediately before it in the same pipeline: a
    // nested pipeline's steps build a tool, not this shape.
    if (step.depth !== prev.depth) continue;
    if (prev.volume === undefined || step.volume === undefined || prev.volume <= 0) continue;

    const keyword = step.op.split(' ')[0];
    const dv = Math.abs(step.volume - prev.volume) / prev.volume;

    if (MUST_REDUCE.has(keyword) && dv < VOLUME_EPS) {
      out.push(makeDiagnostic(
        'check.no-effect',
        'info',
        `step ${step.index} '${step.op}' left the volume unchanged (${step.volume})`,
        {
          hint: keyword === 'hole' || keyword === 'cut'
            ? 'the tool may not reach the material, or the face selection may be on the wrong face'
            : 'the tool may not overlap the material',
          loc: step.line !== undefined ? { line: step.line, column: 0 } : undefined,
        },
      ));
    } else if (MUST_REFACE.has(keyword) && step.faces !== undefined
      && step.faces === prev.faces && dv < VOLUME_EPS) {
      out.push(makeDiagnostic(
        'check.no-effect',
        'info',
        `step ${step.index} '${step.op}' changed neither the face count (${step.faces}) nor the volume`,
        {
          hint: 'the radius may be too small to round anything, or the edge selection may be empty '
            + '(OCCT also refuses to fillet a face produced by shell)',
          loc: step.line !== undefined ? { line: step.line, column: 0 } : undefined,
        },
      ));
    }
  }
  return out;
}
