/**
 * Kernel-call memoization for interactive rebuilds.
 *
 * A PolyScript build is a pure function of the source, and every kernel call
 * is a pure function of its arguments: same inputs, same geometry. Handles are
 * plain numbers into the kernel's arena and core never releases them, so a
 * call keyed on (method, args) can hand back the handle it produced last time.
 * Because the key includes input handles, a hit on `makeBox 20 20 10` makes
 * the `translate` fed by it a hit too, and so on down the chain until the
 * first op whose arguments actually changed.
 *
 * This is what makes editing one statement in the playground cheap: the
 * statements that did not change cost nothing, including their booleans.
 * Change a parameter everything depends on and the hit rate is zero; the
 * overhead is then one string key per call, negligible next to any boolean.
 *
 * Only shape-producing methods are memoized (see MEMOIZED). Queries are cheap
 * and mesh extraction returns large arrays. Methods that mutate their argument
 * (buildCurves3d) or manage the arena (release*) must never be memoized.
 *
 * Entries evicted from the LRU are not released: the handle may still be
 * referenced by a previous result the caller is displaying. That is the
 * status quo (nothing was ever released), and unchanged subtrees now create
 * no new handles at all, so memory grows more slowly than before, not faster.
 */

import type { OC } from './types.js';

/** Kernel methods whose result depends only on their arguments and that
 *  return handles. */
export const MEMOIZED: ReadonlySet<string> = new Set([
  // primitives
  'makeBox', 'makeCylinder', 'makeSphere', 'makeCone', 'makeTorus',
  // 2D / wires
  'makeLineEdge', 'makeArcEdge', 'makeCircleEdge', 'makeEllipseEdge', 'makeBezierEdge',
  'makeTangentArc', 'interpolatePoints', 'interpolatePointsWithTangents',
  'makeWire', 'makeFace', 'makeFaceOnSurface', 'makeCompound', 'outerWire',
  'offsetWire2D', 'fillet2D', 'makeHelixWire',
  // 2D -> 3D
  'extrude', 'revolve', 'loft', 'pipe', 'sweepAdvanced', 'draftPrism',
  // booleans
  'fuse', 'cut', 'common', 'intersect', 'fuseAll', 'cutAll',
  // modifiers
  'fillet', 'chamfer', 'shell', 'unifySameDomain',
  // transforms
  'translate', 'rotate', 'scale', 'mirror', 'generalTransform', 'transformShapeAx3',
  // sub-shape queries return handles and are called for every selector
  'getSubShapes',
]);

export interface KernelMemoStats {
  hits: number;
  misses: number;
  /** Entries currently held. */
  size: number;
}

export interface KernelMemo {
  /** The memoizing view of the kernel. Pass this to the evaluator. */
  oc: OC;
  stats(): KernelMemoStats;
  /** Zero hits/misses (the entries stay). Call at the start of a build to
   *  get per-build figures. */
  resetStats(): void;
  clear(): void;
}

export interface KernelMemoOptions {
  /** Entries to keep; the least recently used go first. Default 4096. */
  maxEntries?: number;
}

type AnyFn = (...args: unknown[]) => unknown;

export function memoizeKernel(oc: OC, options: KernelMemoOptions = {}): KernelMemo {
  const maxEntries = options.maxEntries ?? 4096;
  const cache = new Map<string, unknown>();
  let hits = 0;
  let misses = 0;

  const wrappers = new Map<string, AnyFn>();
  const wrapperFor = (name: string): AnyFn => {
    let fn = wrappers.get(name);
    if (!fn) {
      const method = ((oc as unknown as Record<string, AnyFn>)[name]).bind(oc);
      fn = (...args: unknown[]) => {
        const key = `${name} ${keyOf(args)}`;
        if (cache.has(key)) {
          hits++;
          const value = cache.get(key);
          // Refresh recency.
          cache.delete(key);
          cache.set(key, value);
          return copyOut(value);
        }
        misses++;
        // An op that throws is not cached: the evaluator has fallbacks that
        // depend on seeing the throw each time.
        const value = method(...args);
        cache.set(key, value);
        if (cache.size > maxEntries) {
          cache.delete(cache.keys().next().value as string);
        }
        return copyOut(value);
      };
      wrappers.set(name, fn);
    }
    return fn;
  };

  const proxy = new Proxy(oc as unknown as Record<string | symbol, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && MEMOIZED.has(prop) && typeof target[prop] === 'function') {
        return wrapperFor(prop);
      }
      const value = Reflect.get(target, prop, receiver);
      // Bind other methods to the real kernel: OcctKernel uses private
      // fields, which a Proxy as `this` would break.
      return typeof value === 'function' ? (value as AnyFn).bind(oc) : value;
    },
  });

  return {
    oc: proxy as unknown as OC,
    stats: () => ({ hits, misses, size: cache.size }),
    resetStats: () => {
      hits = 0;
      misses = 0;
    },
    clear: () => {
      cache.clear();
      hits = 0;
      misses = 0;
    },
  };
}

/** Callers filter/sort the arrays they get; never hand out the cached one. */
function copyOut(value: unknown): unknown {
  return Array.isArray(value) ? value.slice() : value;
}

/** Stable key for an argument list: numbers (handles included), strings,
 *  booleans, arrays, typed arrays and plain objects. -0 and NaN are kept
 *  distinct from 0 so a degenerate call is never confused with a real one. */
function keyOf(args: unknown[]): string {
  return JSON.stringify(args, (_k, v) => {
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : `#${String(v)}`;
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
    if (typeof v === 'bigint') return `#${v}n`;
    return v;
  });
}
