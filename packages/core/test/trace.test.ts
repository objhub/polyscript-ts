/**
 * Trace: the per-step table. Timing is opt-in so the default output keeps
 * the Python implementation's columns and JSON keys.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { Trace } from '../src/trace.js';
import type { OC } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function traced(source: string, trace: Trace): Trace {
  const ev = new Evaluator({ oc, parseFn: parse, trace });
  ev.evaluate(parse(source));
  return trace;
}

const SRC = 'box 20 20 10 | faces ">Z" | shell 2 | edges "|Z" | fillet 1';

describe('Trace', () => {
  it('has no ms by default: table and JSON match the Python trace', () => {
    const t = traced(SRC, new Trace());
    expect(t.steps.every((s) => s.ms === undefined)).toBe(true);
    expect(t.toList().every((s) => !('ms' in s))).toBe(true);
    expect(t.render().split('\n')[0]).not.toMatch(/\bms\b/);
  });

  it('records per-op wall-clock time when timing is on', () => {
    const t = traced(SRC, new Trace({ timing: true }));
    expect(t.steps).toHaveLength(4);
    for (const s of t.steps) {
      expect(typeof s.ms).toBe('number');
      expect(s.ms!).toBeGreaterThanOrEqual(0);
    }
    // fillet does real work; a selector is bookkeeping.
    const fillet = t.steps.find((s) => s.op.startsWith('fillet'))!;
    expect(fillet.ms!).toBeGreaterThan(0);
    expect(t.totalMs()).toBeCloseTo(t.steps.reduce((a, s) => a + s.ms!, 0), 5);
    expect(t.toList()[3]).toHaveProperty('ms');
    expect(t.render().split('\n')[0]).toMatch(/\bms$/);
  });
});
