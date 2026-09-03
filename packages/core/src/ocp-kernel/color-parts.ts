/**
 * Split a result shape into parts that can each carry one color.
 *
 * `WpState.colorMap` records `color` ops by the shape handle the color was
 * applied to. Those handles are snapshots: every later op (a boolean, a
 * fillet, a transform) produces a new shape, so by the end of a pipeline
 * most entries name shapes that no longer exist in the result. Exporting the
 * entries themselves therefore exports stale geometry -- for
 * `box | color "red" | diff (cylinder 4 30)` it is the uncut box.
 *
 * The only handles that are still meaningful are the ones whose solids are
 * literally sub-solids of the result (OCCT keeps untouched solids shared, so
 * `isSame` finds them). Everything else falls back to the state's current
 * color, which every op propagates. A fused solid is one solid and gets one
 * color; per-face colors surviving a boolean would need the operation
 * history and is out of scope here.
 */

import type { OC, Shape, WpState } from './types.js';

export type RGB = [number, number, number];

export interface ColorPart {
  shape: Shape;
  /** RGB 0..1. Undefined when the source set no color. */
  color?: RGB;
  /** 0..1, default 1. */
  alpha?: number;
}

function colorKey(p: { color?: RGB; alpha?: number }): string {
  return p.color ? `${p.color.join(',')}/${p.alpha ?? 1}` : '';
}

/** True when the parts do not all share one color. */
export function hasDistinctColors(parts: readonly ColorPart[]): boolean {
  if (parts.length < 2) return false;
  const first = colorKey(parts[0]);
  return parts.some((p) => colorKey(p) !== first);
}

/**
 * Parts of `shape` (normally `wp.shape`) by color. A shape with one solid, or
 * without colorMap entries that disagree with the state's color, is a single
 * part. Parts come out in first-appearance order of their solids.
 */
export function colorParts(oc: OC, wp: WpState, shape: Shape): ColorPart[] {
  const base: ColorPart = { shape };
  if (wp.color) {
    base.color = wp.color;
    base.alpha = wp.alpha ?? 1;
  }

  // Entries with the base color stay in: a `color` applied to the whole
  // compound after the parts were colored must win over those parts.
  const entries = [...(wp.colorMap ?? [])]
    .map(([s, [r, g, b, a]]) => ({ shape: s, color: [r, g, b] as RGB, alpha: a }));
  if (!entries.some((e) => colorKey(e) !== colorKey(base))) return [base];

  let solids: Shape[];
  try {
    solids = oc.getSubShapes(shape, 'solid');
  } catch {
    return [base];
  }
  if (solids.length < 2) return [base];

  // Later `color` ops win over earlier ones, so match newest entry first.
  const candidates = entries.reverse().map((e) => ({
    ...e,
    solids: safeSolids(oc, e.shape),
  }));

  const groups = new Map<string, { part: ColorPart; solids: Shape[] }>();
  for (const solid of solids) {
    let owner: ColorPart = base;
    for (const c of candidates) {
      if (c.solids.some((s) => oc.isSame(s, solid))) {
        owner = { shape: solid, color: c.color, alpha: c.alpha };
        break;
      }
    }
    const key = colorKey(owner);
    const group = groups.get(key);
    if (group) group.solids.push(solid);
    else groups.set(key, { part: { shape: solid, color: owner.color, alpha: owner.alpha }, solids: [solid] });
  }

  if (groups.size < 2) return [base];
  return [...groups.values()].map(({ part, solids: members }) => ({
    ...part,
    shape: members.length === 1 ? members[0] : oc.makeCompound(members),
  }));
}

function safeSolids(oc: OC, shape: Shape): Shape[] {
  try {
    return oc.getSubShapes(shape, 'solid');
  } catch {
    return [];
  }
}
