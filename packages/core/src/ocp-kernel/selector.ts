/**
 * OCP Kernel selector engine — filters topology items by selector strings.
 * Uses Vec3-based geometry (no OC instance needed for vector math).
 */

import type { OC, Pnt, Dir, Vec } from './types.js';
import { axisComponent, vecComponent } from './geometry.js';
import { pushWarning } from '../diagnostics.js';

// _oc is reserved for selector kinds that need OCP geometry inspection
// (e.g. surface curvature, parameter range checks). Current selectors only
// use Vec3 math via centerFn/directionFn, but we keep the parameter so
// future selectors can be added without changing the public signature.
/**
 * Filter topology items by a selector.
 *
 * Returns an empty array when nothing matched. It used to fall back to
 * returning every item, which turned a selector typo into "select everything"
 * -- `edges ">Z and =Z" | fillet 3` rounded the whole box instead of failing.
 * The caller (see `checkSelection` in selection.ts) reports the empty match.
 *
 * Selectors arrive already normalised to the internal form (`|` parallel,
 * `#` perpendicular); see `normalizeSelector` in eval/pipe-selection.ts.
 */
export function selectItems(
  _oc: OC,
  items: any[],
  selector: string,
  centerFn: (item: any) => Pnt,
  directionFn?: (item: any) => Vec | Dir | null,
): any[] {
  if (!items.length) return items;
  const sel = selector.trim();

  // compound OR: ">Z or >X" — union of each selector's results
  if (sel.includes(' or ')) {
    const parts = sel.split(' or ');
    const seen = new Set<any>();
    const result: any[] = [];
    for (const part of parts) {
      for (const item of selectItems(_oc, items, part.trim(), centerFn, directionFn)) {
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
      result = selectItems(_oc, result, part.trim(), centerFn, directionFn);
    }
    return result;
  }

  if (sel.length < 2) {
    // An unknown selector falls through to "return everything", which reads
    // as success: a typo like faces "Z" selects all six faces of a box.
    // Mirror the Python kernel's warning so --strict can catch it.
    pushWarning(`unrecognized selector '${sel}' -- no filtering applied, all ${items.length} items selected`);
    return items;
  }
  const op = sel[0];
  const axis = sel[1].toUpperCase();

  if (op === '>') {
    const vals = items.map(item => ({ item, v: axisComponent(centerFn(item), axis) }));
    const maxVal = Math.max(...vals.map(x => x.v));
    return vals.filter(x => Math.abs(x.v - maxVal) < 1e-6).map(x => x.item);
  }

  if (op === '<') {
    const vals = items.map(item => ({ item, v: axisComponent(centerFn(item), axis) }));
    const minVal = Math.min(...vals.map(x => x.v));
    return vals.filter(x => Math.abs(x.v - minVal) < 1e-6).map(x => x.item);
  }

  if (op === '|' && directionFn) {
    const axisVec: Vec = axis === 'X' ? { x: 1, y: 0, z: 0 } :
                         axis === 'Y' ? { x: 0, y: 1, z: 0 } :
                                        { x: 0, y: 0, z: 1 };
    const result: any[] = [];
    for (const item of items) {
      const d = directionFn(item);
      if (d) {
        // Cross product magnitude
        const cx = d.y * axisVec.z - d.z * axisVec.y;
        const cy = d.z * axisVec.x - d.x * axisVec.z;
        const cz = d.x * axisVec.y - d.y * axisVec.x;
        const crossMag = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (crossMag < 0.1) result.push(item);
      }
    }
    return result;
  }

  // # = perpendicular to axis (internal form of SPEC's + selector)
  // A face/edge is perpendicular to axis when its normal/direction is parallel to that axis
  if (op === '#' && directionFn) {
    const axisVec: Vec = axis === 'X' ? { x: 1, y: 0, z: 0 } :
                         axis === 'Y' ? { x: 0, y: 1, z: 0 } :
                                        { x: 0, y: 0, z: 1 };
    const result: any[] = [];
    for (const item of items) {
      const d = directionFn(item);
      if (d) {
        // Dot product: if |dot| > 0.9, normal is parallel to axis => face is perpendicular
        const dot = Math.abs(d.x * axisVec.x + d.y * axisVec.y + d.z * axisVec.z);
        if (dot > 0.9) result.push(item);
      }
    }
    return result;
  }

  if (op === '+' && directionFn) {
    const result: any[] = [];
    for (const item of items) {
      const d = directionFn(item);
      if (d && vecComponent(d, axis) > 0.5) result.push(item);
    }
    return result;
  }

  if (op === '-' && directionFn) {
    const result: any[] = [];
    for (const item of items) {
      const d = directionFn(item);
      if (d && vecComponent(d, axis) < -0.5) result.push(item);
    }
    return result;
  }

  pushWarning(`unrecognized selector '${sel}' -- no filtering applied, all ${items.length} items selected`);
  return items;
}
