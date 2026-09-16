/**
 * Per-step metrics for a pipeline run -- the cheap way to see what happened.
 *
 * Grew out of python/src/polyscript/trace.py and keeps its field names and
 * JSON keys, so tooling written against the Python trace still reads this one.
 * `line` and `selection` are additions the frozen Python oracle does not have
 * (devel/parity-ledger202609.md): both are optional, so a consumer that only
 * knows the Python keys is unaffected.
 *
 * Recording is opt-in: with tracing off the evaluator never calls in here, so
 * the default build path pays nothing.
 *
 * `timing` adds a per-op wall-clock column (`ms`). It is off by default so the
 * default table and JSON keys stay identical to the Python implementation,
 * which has no timing.
 */

import type { OC, Pnt, Vec, WpState } from './ocp-kernel/types.js';
import { faceCenter, faceNormal, edgeCenter, edgeDirection, vertexPoint, to3d } from './ocp-kernel/geometry.js';

/** What a selection step actually picked, in numbers.
 *
 * A count alone cannot tell `faces ">Z"` from `faces "+Z"`: both report
 * `1/6`-ish figures on a box while one is the top and the other a side. The
 * centroid and the normal separate them without rendering anything, which is
 * the whole point -- an orientation mistake otherwise survives every numeric
 * check and only shows up in a picture. */
export interface TraceSelection {
  kind: 'face' | 'edge' | 'vertex' | 'point';
  /** Centroid of the selected items' own centres. */
  centroid: [number, number, number];
  /** Face normal or edge direction, when every selected item shares one
   *  (within 1e-6). Absent when the selection mixes orientations. */
  normal?: [number, number, number];
  /** Total area of the selected faces. */
  area?: number;
  /** Total length of the selected edges. */
  length?: number;
}

export interface TraceStep {
  index: number;
  op: string;
  context: string;
  depth: number;
  /** Line in the source file the op was written on. */
  line?: number;
  selected?: number;
  total?: number;
  /** Geometry of the selection this step made, if it made one. */
  selection?: TraceSelection;
  volume?: number;
  solids?: number;
  faces?: number;
  edges?: number;
  /** 2D context: number of faces (regions) held by the workplane. */
  faces2d?: number;
  /** 2D context: number of wires (curves) held by the workplane. */
  wires?: number;
  /** Wall-clock time of the op itself, exclusive of the trace's own
   * measuring; inclusive of any nested pipeline it evaluated. */
  ms?: number;
}

export interface TraceOptions {
  /** Record per-op wall-clock time. */
  timing?: boolean;
}

export class Trace {
  steps: TraceStep[] = [];
  readonly timing: boolean;

  constructor(options: TraceOptions = {}) {
    this.timing = options.timing ?? false;
  }

  record(opName: string, context: string, state: unknown, depth = 0, ms?: number, line?: number): void {
    const step: TraceStep = {
      index: this.steps.length + 1,
      op: opName,
      context,
      depth,
    };
    if (line !== undefined) step.line = line;
    if (this.timing && ms !== undefined) step.ms = Math.round(ms * 10) / 10;
    measure(step, state as WpState | null);
    this.steps.push(step);
  }

  /** Sum of the per-op times (only the ops that were timed). */
  totalMs(): number {
    return this.steps.reduce((acc, s) => acc + (s.ms ?? 0), 0);
  }

  toList(): Record<string, unknown>[] {
    return this.steps.map((s) => {
      const out: Record<string, unknown> = {
        index: s.index,
        op: s.op,
        context: s.context,
      };
      if (s.depth) out.depth = s.depth;
      if (s.line !== undefined) out.line = s.line;
      for (const k of ['selected', 'total', 'volume', 'solids', 'faces', 'edges', 'wires', 'ms'] as const) {
        if (s[k] !== undefined) out[k] = s[k];
      }
      if (s.selection) out.selection = s.selection;
      return out;
    });
  }

  render(): string {
    if (!this.steps.length) return '(no pipeline operations)';

    const selText = (s: TraceStep) => {
      if (s.selected === undefined) return '-';
      if (s.total === undefined) return String(s.selected);
      return `${s.selected}/${s.total}`;
    };

    const columns: [string, (s: TraceStep) => string, ((s: TraceStep) => unknown) | null][] = [
      ['#', (s) => String(s.index), null],
      ['line', (s) => String(s.line), (s) => s.line],
      ['op', (s) => '  '.repeat(s.depth) + s.op, null],
      ['context', (s) => s.context, null],
      ['sel', selText, (s) => s.selected],
      ['where', (s) => selectionText(s.selection!), (s) => s.selection],
      ['volume', (s) => s.volume!.toFixed(1), (s) => s.volume],
      ['solids', (s) => String(s.solids), (s) => s.solids],
      ['faces', (s) => String(s.faces), (s) => s.faces],
      ['2d', (s) => String(s.faces2d), (s) => s.faces2d],
      ['wires', (s) => String(s.wires), (s) => s.wires],
      ['ms', (s) => s.ms!.toFixed(1), (s) => s.ms],
    ];
    const active = columns.filter(
      ([, , present]) => present === null || this.steps.some((s) => present(s) !== undefined),
    );

    const attr: Record<string, keyof TraceStep | null> = {
      line: 'line', sel: 'selected', where: 'selection',
      volume: 'volume', solids: 'solids', faces: 'faces', '2d': 'faces2d', wires: 'wires', ms: 'ms',
    };
    const rows: string[][] = [active.map(([head]) => head)];
    for (const s of this.steps) {
      rows.push(active.map(([head, fmt]) => {
        const a = attr[head];
        return a === undefined || s[a as keyof TraceStep] !== undefined ? fmt(s) : '-';
      }));
    }

    const widths = active.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    const lines: string[] = [];
    rows.forEach((row, n) => {
      const line = row.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
      lines.push(line);
      if (n === 0) lines.push('-'.repeat(line.length));
    });
    return lines.join('\n');
  }
}

/** Fill in whichever metrics make sense for the state. Best-effort: a trace
 * that throws would turn a diagnostic aid into a new failure mode. */
function measure(step: TraceStep, state: WpState | null): void {
  if (!state || typeof state !== 'object') return;
  const oc: OC | undefined = (state as WpState).oc;

  const selections: [unknown[] | undefined, 'face' | 'edge' | 'vertex'][] = [
    [state.selectedFaces, 'face'],
    [state.selectedEdges, 'edge'],
    [state.selectedVertices as unknown[] | undefined, 'vertex'],
  ];
  let recorded = false;
  for (const [selected, kind] of selections) {
    if (selected?.length) {
      step.selected = selected.length;
      if (oc && state.shape) {
        try { step.total = oc.getSubShapes(state.shape, kind).length; } catch { /* best-effort */ }
        try { step.selection = describeSelection(oc, selected, kind); } catch { /* best-effort */ }
      }
      recorded = true;
      break;
    }
  }
  if (!recorded && state.points) {
    step.selected = state.points.length;
    if (oc && state.points.length) {
      try {
        step.selection = {
          kind: 'point',
          centroid: centroidOf(state.points.map(([x, y]) => to3d(oc, state.plane, x, y))),
        };
      } catch { /* best-effort */ }
    }
  }

  if (oc && state.shape) {
    try {
      step.volume = Math.round(oc.getVolume(state.shape) * 10000) / 10000;
      step.solids = oc.getSubShapes(state.shape, 'solid').length;
      step.faces = oc.getSubShapes(state.shape, 'face').length;
      step.edges = oc.getSubShapes(state.shape, 'edge').length;
    } catch { /* best-effort */ }
  }

  // 2D content: regions and curves are counted apart, the way the context
  // types them (devel/2d-face-wire202609.md).
  if (state.faces?.length) {
    step.faces2d = state.faces.length;
  }
  if (state.wires?.length) {
    step.wires = state.wires.length;
  }
}

/** Where the selection is and which way it faces.
 *
 * Cheap: one bbox centre and one surface normal per item, the same calls the
 * selector engine already makes to decide what to select. */
function describeSelection(
  oc: OC,
  items: unknown[],
  kind: 'face' | 'edge' | 'vertex',
): TraceSelection {
  const centres: Pnt[] = [];
  const dirs: (Vec | null)[] = [];
  let area = 0;
  for (const item of items) {
    if (kind === 'face') {
      centres.push(faceCenter(oc, item as never));
      dirs.push(faceNormal(oc, item as never));
      try { area += oc.getSurfaceArea(item as never); } catch { /* best-effort */ }
    } else if (kind === 'edge') {
      centres.push(edgeCenter(oc, item as never));
      dirs.push(edgeDirection(oc, item as never));
    } else {
      centres.push(vertexPoint(oc, item as never));
    }
  }
  const sel: TraceSelection = { kind, centroid: centroidOf(centres) };
  const shared = sharedDirection(dirs);
  if (shared) sel.normal = shared;
  if (kind === 'face' && area > 0) sel.area = round(area);
  return sel;
}

function centroidOf(points: Pnt[]): [number, number, number] {
  const n = Math.max(points.length, 1);
  const sum = points.reduce(
    (a, p) => [a[0] + p.x, a[1] + p.y, a[2] + p.z] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  return [round(sum[0] / n), round(sum[1] / n), round(sum[2] / n)];
}

/** The direction every item shares, or null when they differ. Two faces
 *  pointing opposite ways (the top and the bottom of a box) must not average
 *  into a meaningless zero vector. */
function sharedDirection(dirs: (Vec | null)[]): [number, number, number] | null {
  if (!dirs.length || dirs.some((d) => !d)) return null;
  const first = dirs[0] as Vec;
  for (const d of dirs as Vec[]) {
    if (Math.abs(d.x - first.x) > 1e-6 || Math.abs(d.y - first.y) > 1e-6 || Math.abs(d.z - first.z) > 1e-6) {
      return null;
    }
  }
  return [round(first.x), round(first.y), round(first.z)];
}

function round(v: number): number {
  const r = Math.round(v * 10000) / 10000;
  return r === 0 ? 0 : r;  // -0 prints as "-0" and diffs against 0
}

/** `(0, 0, 25)` -> `(0,0,25)`, and an axis-aligned direction as `+Z`. */
function vecText(v: [number, number, number]): string {
  return `(${v.map((c) => String(Math.round(c * 100) / 100)).join(',')})`;
}

function dirText(v: [number, number, number]): string {
  const axes = ['X', 'Y', 'Z'];
  for (let i = 0; i < 3; i++) {
    const others = [0, 1, 2].filter((j) => j !== i);
    if (Math.abs(Math.abs(v[i]) - 1) < 1e-6 && others.every((j) => Math.abs(v[j]) < 1e-6)) {
      return `${v[i] > 0 ? '+' : '-'}${axes[i]}`;
    }
  }
  return vecText(v);
}

/** The `where` column: what the step selected, in one field. */
export function selectionText(sel: TraceSelection): string {
  const parts = [`c=${vecText(sel.centroid)}`];
  if (sel.normal) parts.push(`${sel.kind === 'edge' ? 'd' : 'n'}=${dirText(sel.normal)}`);
  if (sel.area !== undefined) parts.push(`a=${Math.round(sel.area * 10) / 10}`);
  return parts.join(' ');
}
