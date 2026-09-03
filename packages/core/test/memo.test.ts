/**
 * memoizeKernel(): a second evaluation of the same source does no kernel
 * work, and editing one statement only re-runs what depends on it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { memoizeKernel } from '../src/ocp-kernel/memo.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let raw: OC;
beforeAll(async () => {
  raw = await initOC();
});

function run(oc: OC, source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}

const HEAD = 'head = polygon 6 8 | extrude 6 | faces ">Z" | chamfer 1\n';
const SHAFT = 'shaft = cylinder 4 24 | translate 0 0 6 | diff (cylinder 2 30)\n';

describe('memoizeKernel', () => {
  it('replays an identical build from the cache, handle for handle', () => {
    const memo = memoizeKernel(raw);
    const a = run(memo.oc, `${HEAD}${SHAFT}union [head, shaft]`);
    const first = memo.stats();
    expect(first.misses).toBeGreaterThan(0);

    memo.resetStats();
    const b = run(memo.oc, `${HEAD}${SHAFT}union [head, shaft]`);
    const second = memo.stats();
    expect(second.misses).toBe(0);
    expect(second.hits).toBe(first.hits + first.misses);
    expect(b.shape).toBe(a.shape);
    expect(raw.getVolume(b.shape!)).toBeCloseTo(raw.getVolume(a.shape!), 6);
  });

  it('re-runs only the statements that changed', () => {
    const memo = memoizeKernel(raw);
    run(memo.oc, `${HEAD}${SHAFT}union [head, shaft]`);
    memo.resetStats();
    const edited = run(memo.oc, `${HEAD}${SHAFT.replace('cylinder 2 30', 'cylinder 3 30')}union [head, shaft]`);
    const s = memo.stats();
    // head and the shaft blank are hits; the inner cylinder, the diff and
    // the final union are the misses.
    expect(s.hits).toBeGreaterThan(0);
    expect(s.misses).toBeLessThan(s.hits);
    const plain = run(raw, `${HEAD}${SHAFT.replace('cylinder 2 30', 'cylinder 3 30')}union [head, shaft]`);
    expect(raw.getVolume(edited.shape!)).toBeCloseTo(raw.getVolume(plain.shape!), 4);
  });

  it('passes through non-memoized methods and hands out array copies', () => {
    const memo = memoizeKernel(raw);
    const box = memo.oc.makeBox(10, 10, 10);
    expect(memo.oc.getVolume(box)).toBeCloseTo(1000, 6);
    const faces1 = memo.oc.getSubShapes(box, 'face');
    const faces2 = memo.oc.getSubShapes(box, 'face');
    expect(faces2).toEqual(faces1);
    expect(faces2).not.toBe(faces1);
    faces1.length = 0;
    expect(memo.oc.getSubShapes(box, 'face')).toHaveLength(6);
  });

  it('does not cache a call that throws', () => {
    const memo = memoizeKernel(raw);
    const bad = () => memo.oc.makeBox(-1, 0, 0);
    let threw = 0;
    for (let i = 0; i < 2; i++) {
      try { bad(); } catch { threw++; }
    }
    expect(threw).toBe(2);
    expect(memo.stats().misses).toBe(2);
  });

  it('evicts the least recently used entry past maxEntries', () => {
    const memo = memoizeKernel(raw, { maxEntries: 2 });
    memo.oc.makeBox(1, 1, 1);
    memo.oc.makeBox(2, 2, 2);
    memo.oc.makeBox(1, 1, 1); // refresh
    memo.oc.makeBox(3, 3, 3); // evicts the 2-box
    memo.resetStats();
    memo.oc.makeBox(1, 1, 1);
    memo.oc.makeBox(2, 2, 2);
    expect(memo.stats()).toMatchObject({ hits: 1, misses: 1, size: 2 });
  });
});
