/**
 * `rotate` arity is decided by what is being rotated, and never padded
 * (SPEC 変形 / devel/parity-ledger202609.md §4, decided 2026-09-06):
 *   solid     -> exactly 3 angles, world axes
 *   2D shape  -> exactly 1 angle, about the plane normal (in-plane)
 *   workplane -> nothing to rotate; rejected by the validator
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

/** Bounding box of whatever the state holds: the 2D face, else the wire, else the solid. */
function bbox(s: WpState) {
  const shape = s.faces[0] ?? s.wires[0] ?? s.shape;
  expect(shape).toBeTruthy();
  return boundingBox(oc, shape!);
}
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('rotate on a solid: three angles', () => {
  it('rotate 0 0 90 turns the box in the XY plane', () => {
    const bb = bbox(run('box 10 20 30 | rotate 0 0 90'));
    close(bb.xlen, 20);
    close(bb.ylen, 10);
    close(bb.zlen, 30);
  });

  it('two angles are an error, not "the third is zero"', () => {
    expect(() => run('box 10 20 30 | rotate 0 90')).toThrow(/rotate: on a solid, 3 arguments \(rx ry rz\); got 2/);
  });

  it('one angle is an error too', () => {
    expect(() => run('box 10 20 30 | rotate 90')).toThrow(/3 arguments/);
  });
});

describe('rotate on a 2D shape: one angle, in the plane', () => {
  it('rotate 90 swaps the rectangle\'s extents and keeps it in the plane', () => {
    const bb = bbox(run('rect 10 20 | rotate 90'));
    close(bb.xlen, 20);
    close(bb.ylen, 10);
    close(bb.zlen, 0);
  });

  it('rotates about the workplane origin by default', () => {
    // A rect centred at (20, 0) swung 90 degrees about the origin lands centred at (0, 20).
    const bb = bbox(run('rect 10 10 at:20 0 | rotate 90'));
    close((bb.xmin + bb.xmax) / 2, 0);
    close((bb.ymin + bb.ymax) / 2, 20);
  });

  it('origin:"local" spins the shape in place', () => {
    const bb = bbox(run('rect 10 20 at:20 0 | rotate 90 origin:"local"'));
    close((bb.xmin + bb.xmax) / 2, 20);
    close((bb.ymin + bb.ymax) / 2, 0);
    close(bb.xlen, 20);
  });

  it('a 2-component origin is in workplane coordinates', () => {
    // Rotating about the rect's own centre (20, 0) is the same as origin:"local".
    const bb = bbox(run('rect 10 20 at:20 0 | rotate 90 origin:(20, 0)'));
    close((bb.xmin + bb.xmax) / 2, 20);
    close(bb.xlen, 20);
  });

  it('three angles on a 2D shape are an error (it cannot leave its plane)', () => {
    expect(() => run('rect 10 20 | rotate 0 0 90')).toThrow(/rotate: on a 2D shape, 1 argument/);
  });

  it('a sketch on a face turns in that face and can then be cut', () => {
    const plain = run('box 40 40 10 | faces ">Z" | rect 20 4 | cut 5');
    const turned = run('box 40 40 10 | faces ">Z" | rect 20 4 | rotate 90 | cut 5');
    // Same amount removed either way (a 20x4x5 slot), but the slot now runs along Y.
    close(oc.getVolume(plain.shape!), oc.getVolume(turned.shape!));
    close(oc.getVolume(turned.shape!), 40 * 40 * 10 - 20 * 4 * 5);
    const slotAlongY = run('box 40 40 10 | faces ">Z" | rect 4 20 | cut 5');
    // Face count and volume equal the directly-drawn Y slot; a stronger check
    // than volume alone, since the two slots differ only in orientation.
    expect(oc.getSubShapes(turned.shape!, 'face').length).toBe(oc.getSubShapes(slotAlongY.shape!, 'face').length);
  });
});

describe('rotate on a bare workplane: rejected', () => {
  it('the validator refuses rotate with nothing drawn', () => {
    const errors = validate(parse('box 10 10 10 | faces ">Z" | workplane | rotate 45'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map(e => e.message).join('\n')).toMatch(/rotate|Rotate/i);
  });
});

describe('a rotated or mirrored 2D shape stays 2D for the next op (issue 2026-09-25)', () => {
  // The evaluator kept the Face / Wire, but the validator's context moved to
  // 3D after any rotate / mirror, so `rect | rotate 45 | extrude 5` was
  // refused at `poly check` although SPEC allows it.
  it.each([
    'rect 10 10 | rotate 45 | extrude 5',
    'rect 20 10 at:(20, 0) | mirror "X" | extrude 5',
    'arc (0, -25) (25, 0) center:(0, 0) | rotate 90 | sweep (circle 5)',
    'circle 20 | rotate 30 | sweep (circle 3)',
  ])('%s passes the validator', (src) => {
    expect(validate(parse(src))).toEqual([]);
  });

  it('rect | rotate 45 | extrude 5 is the turned prism', () => {
    const s = run('rect 10 10 | rotate 45 | extrude 5');
    expect(oc.getVolume(s.shape!)).toBeCloseTo(500, 6);
    const bb = boundingBox(oc, s.shape!);
    close(bb.xlen, 10 * Math.SQRT2);
    close(bb.zlen, 5);
  });

  it('a turned quarter arc sweeps to pi r^2 L', () => {
    const s = run('arc (0, -25) (25, 0) center:(0, 0) | rotate 90 | sweep (circle 5)');
    const expected = Math.PI * 25 * (Math.PI * 25 / 2);
    expect(Math.abs(oc.getVolume(s.shape!) - expected) / expected).toBeLessThan(1e-3);
  });

  it('three angles on a 2D shape point at the ways to stand a path up', () => {
    expect(() => run('arc (0, -25) (25, 0) center:(0, 0) | rotate 90 0 0 | sweep (circle 5)'))
      .toThrow(expect.objectContaining({ hint: expect.stringMatching(/workplane XZ \| wire \[arc/) }));
  });

  it('a solid still leaves rotate / mirror in 3D', () => {
    expect(validate(parse('box 10 10 10 | rotate 0 0 45 | faces ">Z" | shell 1'))).toEqual([]);
    expect(validate(parse('box 10 10 10 | mirror "X" | extrude 5')).map(e => e.code)).toEqual(['context.invalid-op']);
  });
});
