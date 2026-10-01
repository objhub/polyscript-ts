/**
 * OCP Kernel selector engine — filters topology items by selector strings.
 * Uses Vec3-based geometry (no OC instance needed for vector math).
 */

import type { OC, Pnt, Dir, Vec } from './types.js';
import { axisComponent } from './geometry.js';
import { pushWarning, codedError } from '../diagnostics.js';

// _oc is reserved for selector kinds that need OCP geometry inspection
// (e.g. surface curvature, parameter range checks). Current selectors only
// use Vec3 math via centerFn/directionFn, but we keep the parameter so
// future selectors can be added without changing the public signature.
/**
 * Filter topology items by a selector.
 *
 * Returns an empty array when nothing matched. It used to fall back to
 * returning every item, which turned a selector typo into "select everything"
 * -- `edges >Z =Z | fillet 3` rounded the whole box instead of failing.
 * The caller (see `checkSelection` in selection.ts) reports the empty match.
 *
 * Selectors arrive already normalised to the internal form (`|` parallel,
 * `#` perpendicular); see `normalizeSelector` in eval/pipe-selection.ts.
 */
/**
 * A selector back in the notation it was written in.
 *
 * The evaluator translates `=Z` to `|Z` and `+Z` to `#Z` before the kernel
 * sees them (`normalizeSelector` in eval/pipe-selection.ts), and reporting the
 * internal form sends the reader looking for a symbol the language does not
 * have.
 */
export function selectorSourceForm(sel: string): string {
  // The source spells AND as juxtaposition and OR as a list; the joined
  // `and` / `or` words are the internal (and the deprecated quoted) form.
  const alternatives = sel.split(' or ').map(part => part.split(' and ').join(' '));
  return alternatives.length > 1 ? `[${alternatives.join(', ')}]` : alternatives[0];
}

const HINT = "a selector is an operator plus an axis or plane: '>Z' topmost, '<X' leftmost, "
  + "'=Z' parallel to Z (upright edges, side faces), '=XY' parallel to the XY plane "
  + "(horizontal edges, top and bottom faces), '+Z' / '-Z' faces that face up / down";

const AXIS_VEC: Record<string, Vec> = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } };

/** The unit vector a selector's axis or plane stands for: an axis is its own
 *  direction, a plane is its normal (XY -> Z). Null for anything else. */
function selectorVector(axes: string): { vec: Vec; plane: boolean } | null {
  const letters = axes.toUpperCase();
  if (letters.length === 1 && AXIS_VEC[letters]) return { vec: AXIS_VEC[letters], plane: false };
  const planeNormal: Record<string, string> = { XY: 'Z', YZ: 'X', XZ: 'Y' };
  const n = planeNormal[letters];
  return n ? { vec: AXIS_VEC[n], plane: true } : null;
}

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossMag = (a: Vec, b: Vec) =>
  Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export function selectItems(
  _oc: OC,
  items: any[],
  selector: string,
  centerFn: (item: any) => Pnt,
  directionFn?: (item: any) => Vec | Dir | null,
  kind: 'face' | 'edge' | 'vertex' = 'edge',
): any[] {
  if (!items.length) return items;
  const sel = selector.trim();

  // compound OR: ">Z or >X" — union of each selector's results
  if (sel.includes(' or ')) {
    const parts = sel.split(' or ');
    const seen = new Set<any>();
    const result: any[] = [];
    for (const part of parts) {
      for (const item of selectItems(_oc, items, part.trim(), centerFn, directionFn, kind)) {
        if (!seen.has(item)) {
          seen.add(item);
          result.push(item);
        }
      }
    }
    return result;
  }

  // compound AND: ">Z and |X" — intersection (progressive filtering)
  if (sel.includes(' and ')) {
    const parts = sel.split(' and ');
    let result = items;
    for (const part of parts) {
      result = selectItems(_oc, result, part.trim(), centerFn, directionFn, kind);
    }
    return result;
  }

  if (sel.length < 2) {
    // An unknown selector falls through to "return everything", which reads
    // as success: a typo like faces "Z" selects all six faces of a box.
    // Mirror the Python kernel's warning so --strict can catch it.
    pushWarning(`unrecognized selector '${selectorSourceForm(sel)}' -- no filtering applied, all ${items.length} items selected`,
      { code: 'selector.unknown', hint: HINT });
    return items;
  }
  const op = sel[0];
  const axes = sel.slice(1);
  const target = selectorVector(axes);

  if ((op === '>' || op === '<') && target && !target.plane) {
    const axis = axes.toUpperCase();
    const vals = items.map(item => ({ item, v: axisComponent(centerFn(item), axis) }));
    const extreme = op === '>' ? Math.max(...vals.map(x => x.v)) : Math.min(...vals.map(x => x.v));
    return vals.filter(x => Math.abs(x.v - extreme) < 1e-6).map(x => x.item);
  }

  // `=`: parallel, in the geometric sense -- the edge or the face itself,
  // not the face's normal (CadQuery's `|Z`, which this once mirrored, is
  // normal-based: `faces |Z` is the top and bottom, which reads backwards).
  //   =Z   an edge running along Z; a face that contains the Z direction
  //        (the sides of a box)
  //   =XY  an edge lying in an XY-parallel plane; a face parallel to the
  //        XY plane (the top and bottom)
  if (op === '=' && target && directionFn) {
    const { vec, plane } = target;
    const result: any[] = [];
    for (const item of items) {
      const d = directionFn(item);
      if (!d) continue;
      // An edge's direction is parallel to an axis / lies in a plane; a
      // face's normal does the opposite: it is perpendicular to an axis the
      // face contains, and parallel to the normal of a plane the face lies in.
      const alongVec = kind === 'face' ? plane : !plane;
      if (alongVec ? crossMag(d, vec) < 0.1 : Math.abs(dot(d, vec)) < 0.1) result.push(item);
    }
    return result;
  }

  // `+Z` / `-Z`: the way a face faces. An edge has no front.
  if ((op === '+' || op === '-') && target && !target.plane && directionFn) {
    if (kind !== 'face') {
      throw codedError('eval.error',
        `${op}${axes} selects faces by the direction they face; an edge has no front`,
        `for edges use =${axes} (along ${axes}) or a plane like =XY (lying flat)`);
    }
    const sign = op === '+' ? 1 : -1;
    return items.filter(item => {
      const d = directionFn(item);
      return d !== null && sign * dot(d, target.vec) > 0.5;
    });
  }

  pushWarning(`unrecognized selector '${selectorSourceForm(sel)}' -- no filtering applied, all ${items.length} items selected`,
      { code: 'selector.unknown', hint: HINT });
  return items;
}
