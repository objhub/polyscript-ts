/**
 * Selector semantics against the real kernel.
 *
 * The unit tests elsewhere feed synthetic normals to `selectItems`, which is
 * how `#` (SPEC's `+`) came to mean the opposite of the specification and
 * stayed that way: the tests asserted the implementation. These build an
 * actual box and count what each selector picked, so the expectations are the
 * geometry rather than a mock's opinion of it.
 *
 * The reference is SPEC.md ("=X, =Y, =Z | 法線が指定軸に平行", "+X, +Y, +Z |
 * 法線が指定軸に垂直"), which the Python kernel and CadQuery both implement.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import { getFaces, getEdges, faceCenter } from '../src/ocp-kernel/geometry.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

// A 60 x 40 x 30 box centred on the origin:
//   top/bottom (normal +-Z): 60 * 40 = 2400 each
//   front/back (normal +-Y): 60 * 30 = 1800 each
//   left/right (normal +-X): 40 * 30 = 1200 each
const BOX = 'box 60 40 30';

let oc: OC;

beforeAll(async () => {
  oc = await initOC();
}, 120000);

function select(source: string): WpState {
  const result = new Evaluator({ oc }).evaluate(parse(source));
  return result as WpState;
}

/** Total area of the selected faces -- which faces they are, in one number. */
function selectedFaceArea(source: string): { count: number; area: number; total: number } {
  const state = select(source);
  const faces = state.selectedFaces;
  const area = faces.reduce((sum, f) => sum + oc.getSurfaceArea(f), 0);
  return {
    count: faces.length,
    area: Math.round(area * 1000) / 1000,
    total: getFaces(oc, state.shape!).length,
  };
}

describe('face selectors on a 60x40x30 box', () => {
  it('>Z is the single top face', () => {
    expect(selectedFaceArea(`${BOX} | faces ">Z"`)).toEqual({ count: 1, area: 2400, total: 6 });
  });

  it('=Z is the two faces whose normal runs along Z: top and bottom', () => {
    expect(selectedFaceArea(`${BOX} | faces "=Z"`)).toEqual({ count: 2, area: 4800, total: 6 });
  });

  it('+Z is the four upright sides, not the top and bottom', () => {
    // 2 * 1800 (+-Y) + 2 * 1200 (+-X). This is the whole point of `+`: without
    // it there is no way to name the sides of a box.
    expect(selectedFaceArea(`${BOX} | faces "+Z"`)).toEqual({ count: 4, area: 6000, total: 6 });
  });

  it('+X excludes the two faces whose normal runs along X', () => {
    // 2 * 2400 (+-Z) + 2 * 1800 (+-Y)
    expect(selectedFaceArea(`${BOX} | faces "+X"`)).toEqual({ count: 4, area: 8400, total: 6 });
  });

  it('+Z and =Z are opposites and never overlap', () => {
    const perp = select(`${BOX} | faces "+Z"`).selectedFaces.map((f) => faceCenter(oc, f).z);
    const para = select(`${BOX} | faces "=Z"`).selectedFaces.map((f) => faceCenter(oc, f).z);
    // The sides are centred at z=0; top and bottom at +-15.
    expect(perp.every((z) => Math.abs(z) < 1e-6)).toBe(true);
    expect(para.map((z) => Math.round(z)).sort((a, b) => a - b)).toEqual([-15, 15]);
  });
});

describe('edge selectors on a 60x40x30 box', () => {
  function selectedEdgeCount(source: string): { count: number; total: number } {
    const state = select(source);
    return { count: state.selectedEdges.length, total: getEdges(oc, state.shape!).length };
  }

  it('=Z is the four upright edges', () => {
    expect(selectedEdgeCount(`${BOX} | edges "=Z"`)).toEqual({ count: 4, total: 12 });
  });

  it('+Z is the eight horizontal edges', () => {
    expect(selectedEdgeCount(`${BOX} | edges "+Z"`)).toEqual({ count: 8, total: 12 });
  });
});

describe('selector spellings reach the kernel once (issue: unquoted =Z warned selector.legacy)', () => {
  // SelectorLit used to evaluate to the kernel spelling (`|Z`), and the
  // boundary translated again -- so the canonical unquoted form arrived
  // looking like the deprecated internal one and warned, while the quoted
  // string it deprecates passed. `poly verify` failed on every `edges =Z`.
  const warningsOf = (source: string) => {
    drainDiagnostics();
    select(source);
    return drainDiagnostics().map((d) => d.code);
  };

  it.each([
    'box 10 20 30 | edges =Z | fillet 2',
    'box 10 20 30 | faces +Z',
    'box 10 20 30 | edges =Z >X | fillet 2',
    'box 10 20 30 | edges [=Z, >Z] | fillet 1',
    '$s = =Z\nbox 10 20 30 | edges $s | fillet 2',
    'box 10 20 30 | edges "=Z" | fillet 2',
  ])('%s warns nothing', (src) => {
    expect(warningsOf(src)).toEqual([]);
  });

  it('the kernel spelling inside a string is the one that warns', () => {
    expect(warningsOf('box 10 20 30 | edges "|Z" | fillet 2')).toEqual(['selector.legacy']);
    expect(warningsOf('box 10 20 30 | faces "#Z"')).toEqual(['selector.legacy']);
  });

  it('unquoted and quoted =Z select the same edges', () => {
    const a = select('box 10 20 30 | edges =Z').selectedEdges.length;
    const b = select('box 10 20 30 | edges "=Z"').selectedEdges.length;
    expect(a).toBe(4);
    expect(b).toBe(4);
  });
});
