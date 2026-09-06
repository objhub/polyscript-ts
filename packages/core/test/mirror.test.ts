/**
 * `mirror "X"|"Y"|"Z"` reflects and does not keep the original; `keep:true`
 * fuses both halves; `origin:` moves the mirror plane. Decided 2026-09-06
 * (devel/parity-ledger202609.md §4). 2D geometry mirrors in its own plane.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { boundingBox } from '../src/ocp-kernel/workplane.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
}, 120_000);

function run(source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('mirror on a solid', () => {
  it('reflects across the world plane and keeps the volume', () => {
    const s = run('box 10 10 10 | translate 20 0 0 | mirror "X"');
    const bb = boundingBox(oc, s.shape!);
    close(bb.xmin, -25);
    close(bb.xmax, -15);
    close(oc.getVolume(s.shape!), 1000);
  });

  it('keep:true fuses the original with its reflection', () => {
    const s = run('box 10 10 10 | translate 20 0 0 | mirror "X" keep:true');
    const bb = boundingBox(oc, s.shape!);
    close(bb.xmin, -25);
    close(bb.xmax, 25);
    close(oc.getVolume(s.shape!), 2000);
  });

  it('keep:true on a half that touches the plane gives one solid of twice the volume', () => {
    // The phone-stand idiom: half built against the plane, mirrored to a whole.
    const s = run('box 10 20 30 | translate 5 0 0 | mirror "X" keep:true');
    close(oc.getVolume(s.shape!), 2 * 6000);
    expect(oc.getSubShapes(s.shape!, 'solid').length).toBe(1);
  });

  it('origin: moves the mirror plane', () => {
    const s = run('box 10 10 10 | translate 20 0 0 | mirror "X" origin:(5, 0, 0)');
    const bb = boundingBox(oc, s.shape!);
    close((bb.xmin + bb.xmax) / 2, -10); // 20 reflected about x=5
  });

  it('the axis is required and must be X, Y or Z', () => {
    expect(() => run('box 10 10 10 | mirror')).toThrow(/mirror requires one axis name/);
    expect(() => run('box 10 10 10 | mirror "W"')).toThrow(/mirror requires one axis name/);
  });
});

describe('mirror on 2D geometry', () => {
  it('flips the sketch\'s own X and stays in the plane', () => {
    const s = run('rect 10 4 at:20 0 | mirror "X"');
    expect(s.faces.length).toBe(1);
    const bb = boundingBox(oc, s.faces[0]);
    close((bb.xmin + bb.xmax) / 2, -20);
    close(bb.zlen, 0);
  });

  it('keep:true keeps both faces, which extrude into one symmetric solid', () => {
    const s = run('rect 10 4 at:20 0 | mirror "X" keep:true');
    expect(s.faces.length).toBe(2);
    const solid = run('rect 10 4 at:20 0 | mirror "X" keep:true | extrude 5');
    close(oc.getVolume(solid.shape!), 2 * 10 * 4 * 5);
  });

  it('on a face of a solid, mirrors the sketch across the face\'s axis, not the part', () => {
    const plain = run('box 40 40 10 | faces ">Z" | rect 4 20 at:10 0 | cut 5');
    const mirrored = run('box 40 40 10 | faces ">Z" | rect 4 20 at:10 0 | mirror "X" | cut 5');
    // Same slot volume removed, on the other side.
    close(oc.getVolume(plain.shape!), oc.getVolume(mirrored.shape!));
    const bbP = boundingBox(oc, plain.shape!);
    const bbM = boundingBox(oc, mirrored.shape!);
    close(bbP.xlen, bbM.xlen); // the box itself did not move or grow
  });

  it('"Z" is not a 2D axis', () => {
    expect(() => run('rect 10 4 | mirror "Z"')).toThrow(/"X" \/ "Y"; got "Z"/);
  });

  it('the validator refuses mirror on a bare workplane', () => {
    const errors = validate(parse('box 10 10 10 | faces ">Z" | workplane | mirror "X"'));
    expect(errors.length).toBeGreaterThan(0);
  });
});
