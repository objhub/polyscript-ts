/**
 * Sweep orientation along paths off the XY plane (issue 2026-09-25).
 *
 * The profile was always swept with a constant +Z binormal. On a path in a
 * vertical plane the tangent passes through +-Z, where that frame degenerates
 * and flips: a half-circle handle came out at 42% of its volume, or 0, as one
 * valid solid with exit 0. A planar path now uses its plane normal.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function volume(source: string): number {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return oc.getVolume(((Array.isArray(v) ? v[0] : v) as WpState).shape!);
}

const A = Math.PI * 25; // circle 5

describe('sweep keeps the profile perpendicular on non-XY paths', () => {
  it.each([
    ['straight along Z', 'wire [(0,0,0), (0,0,50)]', A * 50],
    ['half circle in XZ, tangent +-Z at the ends', 'arc (0,0,0) (20,0,20) (0,0,40)', A * Math.PI * 20],
    ['half circle in XZ, tangent +Z at the start', 'arc (0,0,0) (10,0,10) (20,0,0)', A * Math.PI * 10],
    ['half circle in YZ', 'arc (0,0,0) (0,10,10) (0,20,0)', A * Math.PI * 10],
    ['mug handle on workplane XZ', 'workplane XZ | wire [(37,74), arc (37,74) (62,47.5) (34,21)]', 6542.41],
    ['half circle in XY (unchanged)', 'arc (0,0,0) (10,10,0) (20,0,0)', A * Math.PI * 10],
  ])('%s', (_name, path, expected) => {
    drainDiagnostics();
    const v = volume(`${path} | sweep (circle 5)`);
    expect(Math.abs(v - expected) / expected).toBeLessThan(1e-3);
    expect(drainDiagnostics().map(d => d.code)).not.toContain('check.sweep-distorted');
  });

  it('a sharp corner between a line and an arc keeps the arc', () => {
    // RoundCorner fails for one seam placement; the old fallback (plain pipe)
    // dropped the arc and returned the 10mm line alone (785).
    const v = volume('wire [(0,0,0), (0,0,10), arc (0,0,10) (20,0,30) (0,0,50)] | sweep (circle 5)');
    const smooth = A * (10 + Math.PI * 20);
    expect(v / smooth).toBeGreaterThan(0.98);
    expect(v / smooth).toBeLessThan(1.02);
  });

  it('a helix still sweeps with +Z (same volume as before)', () => {
    expect(volume('helix 10 20 60 | sweep (circle 2)')).toBeCloseTo(9478.15, 1);
  });

  it('an off-centre profile is not reported: Pappus, not distortion', () => {
    drainDiagnostics();
    volume('arc (0,0,0) (5,5,0) (10,0,0) | sweep (rect 30 2 at:(20,0))');
    expect(drainDiagnostics().map(d => d.code)).not.toContain('check.sweep-distorted');
  });
});
