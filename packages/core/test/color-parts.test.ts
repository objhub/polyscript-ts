/**
 * colorParts(): which colors survive to the end of a pipeline.
 *
 * Runs the real kernel: the whole point is how OCCT booleans treat the
 * handles recorded in colorMap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { colorParts, hasDistinctColors } from '../src/ocp-kernel/color-parts.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}

describe('colorParts', () => {
  it('a diff after color yields one part of the cut result, not the uncut original', () => {
    const wp = run('box 20 20 10 | color "red" | diff (cylinder 4 30)');
    const parts = colorParts(oc, wp, wp.shape!);
    expect(parts).toHaveLength(1);
    expect(parts[0].shape).toBe(wp.shape);
    expect(parts[0].color).toEqual([1, 0, 0]);
    expect(oc.getVolume(parts[0].shape)).toBeCloseTo(oc.getVolume(wp.shape!), 6);
    expect(hasDistinctColors(parts)).toBe(false);
  });

  it('a fused solid is one solid with one color', () => {
    const wp = run('box 20 20 10 | color "red" | union (cylinder 4 20 | translate 0 0 5 | color "blue")');
    const parts = colorParts(oc, wp, wp.shape!);
    expect(parts).toHaveLength(1);
    expect(parts[0].color).toEqual([1, 0, 0]);
  });

  it('disjoint colored parts keep their own colors', () => {
    const wp = run('box 10 10 10 | color "red" | union (box 10 10 10 | translate 30 0 0 | color "blue")');
    const parts = colorParts(oc, wp, wp.shape!);
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.color)).toEqual([[1, 0, 0], [0, 0, 1]]);
    for (const p of parts) expect(oc.getVolume(p.shape)).toBeCloseTo(1000, 6);
    expect(hasDistinctColors(parts)).toBe(true);
  });

  it('a later color on the whole compound wins', () => {
    const wp = run('box 10 10 10 | color "red" | union (box 10 10 10 | translate 30 0 0 | color "blue") | color "lime"');
    const parts = colorParts(oc, wp, wp.shape!);
    expect(parts).toHaveLength(1);
    expect(parts[0].color).toEqual([0, 1, 0]);
  });

  it('a single-color model is a single part carrying the state color', () => {
    const wp = run('box 10 10 10 | color "red"');
    const parts = colorParts(oc, wp, wp.shape!);
    expect(parts).toEqual([{ shape: wp.shape, color: [1, 0, 0], alpha: 1 }]);
  });
});
