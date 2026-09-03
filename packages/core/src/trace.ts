/**
 * Per-step metrics for a pipeline run -- the cheap way to see what happened.
 *
 * Mirrors python/src/polyscript/trace.py: same step fields, same JSON keys,
 * same rendered table, so tooling built against one implementation's --trace
 * output works against the other. Keep the two in sync.
 *
 * Recording is opt-in: with tracing off the evaluator never calls in here, so
 * the default build path pays nothing.
 */

import type { OC, WpState } from './ocp-kernel/types.js';

export interface TraceStep {
  index: number;
  op: string;
  context: string;
  depth: number;
  selected?: number;
  total?: number;
  volume?: number;
  solids?: number;
  faces?: number;
  edges?: number;
  wires?: number;
}

export class Trace {
  steps: TraceStep[] = [];

  record(opName: string, context: string, state: unknown, depth = 0): void {
    const step: TraceStep = {
      index: this.steps.length + 1,
      op: opName,
      context,
      depth,
    };
    measure(step, state as WpState | null);
    this.steps.push(step);
  }

  toList(): Record<string, unknown>[] {
    return this.steps.map((s) => {
      const out: Record<string, unknown> = {
        index: s.index,
        op: s.op,
        context: s.context,
      };
      if (s.depth) out.depth = s.depth;
      for (const k of ['selected', 'total', 'volume', 'solids', 'faces', 'edges', 'wires'] as const) {
        if (s[k] !== undefined) out[k] = s[k];
      }
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
      ['op', (s) => '  '.repeat(s.depth) + s.op, null],
      ['context', (s) => s.context, null],
      ['sel', selText, (s) => s.selected],
      ['volume', (s) => s.volume!.toFixed(1), (s) => s.volume],
      ['solids', (s) => String(s.solids), (s) => s.solids],
      ['faces', (s) => String(s.faces), (s) => s.faces],
      ['wires', (s) => String(s.wires), (s) => s.wires],
    ];
    const active = columns.filter(
      ([, , present]) => present === null || this.steps.some((s) => present(s) !== undefined),
    );

    const attr: Record<string, keyof TraceStep | null> = {
      sel: 'selected', volume: 'volume', solids: 'solids', faces: 'faces', wires: 'wires',
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
      }
      recorded = true;
      break;
    }
  }
  if (!recorded && state.points) {
    step.selected = state.points.length;
  }

  if (oc && state.shape) {
    try {
      step.volume = Math.round(oc.getVolume(state.shape) * 10000) / 10000;
      step.solids = oc.getSubShapes(state.shape, 'solid').length;
      step.faces = oc.getSubShapes(state.shape, 'face').length;
      step.edges = oc.getSubShapes(state.shape, 'edge').length;
    } catch { /* best-effort */ }
  }

  if (state.wires?.length) {
    step.wires = state.wires.length;
  }
}
