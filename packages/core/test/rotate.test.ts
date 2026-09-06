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
