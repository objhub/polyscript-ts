#!/usr/bin/env bun
/**
 * Regenerate B-Rep regression snapshots from the TypeScript implementation.
 *
 *   bun tests/generate_snapshots.ts                 # every example
 *   bun tests/generate_snapshots.ts 19_threaded_bolt.poly [...]   # just these
 *
 * Reads each example with the shipping `poly` binary (`poly info --json`) and
 * writes snapshots/<name>.json in the same shape the Python generator used, plus
 * a `source` block recording that this snapshot came from TypeScript.
 *
 * What a snapshot means depends on where it came from:
 *
 * - Snapshots without a `source` block were produced by the Python
 *   implementation on OCP/OCCT 7.9.3 (see meta.json). That is an independent
 *   second kernel, so agreement with it is evidence the TS geometry is right.
 * - Snapshots with `source.implementation = "typescript"` were produced by the
 *   code under test. They detect *change* -- an unintended difference in
 *   geometry -- but they cannot vouch for correctness. When you regenerate one,
 *   you are asserting, on your own authority, that the new numbers are right:
 *   check them another way first (--trace, an analytic volume, a section).
 *
 * Regenerate only for a deliberate model or kernel change, one file at a time,
 * and say so in the commit. Never run this to make a red test green.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(HERE, 'examples');
const SNAPSHOT_DIR = join(HERE, 'snapshots');
const POLY = process.env.POLY ?? join(HERE, '..', 'packages', 'cli', 'dist', 'bin', 'poly');

if (!existsSync(POLY)) {
  console.error(`poly binary not found at ${POLY} -- run \`make binary\` or set POLY=`);
  process.exit(1);
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

function polyVersion(): string {
  return spawnSync(POLY, ['--version'], { encoding: 'utf-8' }).stdout.trim();
}

function occtVersion(): string {
  // The kernel version is whatever occt-wasm build packages/cli depends on.
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'packages', 'cli', 'package.json'), 'utf-8'));
  const spec: string = pkg.dependencies?.['occt-wasm'] ?? '';
  const m = /occt-wasm-([0-9][^/]*)\.tgz/.exec(spec);
  return m ? `occt-wasm ${m[1]}` : spec;
}

function snapshotFor(polyFile: string): unknown {
  const r = spawnSync(POLY, ['info', basename(polyFile), '--json'], {
    cwd: dirname(polyFile), encoding: 'utf-8',
  });
  let out: { ok?: boolean; shape?: any; diagnostics?: unknown[] } = {};
  try { out = JSON.parse(r.stdout); } catch { /* fall through */ }
  if (r.status !== 0 || !out.ok) {
    const msg = (r.stderr || r.stdout || '').trim().split('\n').pop() ?? `exit ${r.status}`;
    return { error: msg };
  }
  if (!out.shape) return null;               // library-only file: keep the null convention
  const s = out.shape;
  return {
    bbox: { min: s.bbox.min.map(round4), max: s.bbox.max.map(round4) },
    volume: round4(s.volume),
    topology: s.topology,
    source: {
      implementation: 'typescript',
      poly_version: polyVersion(),
      kernel: occtVersion(),
      generated_at: new Date().toISOString(),
    },
  };
}

const requested = process.argv.slice(2);
const files = (requested.length
  ? requested.map(f => join(EXAMPLES_DIR, basename(f)))
  : readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.poly')).sort().map(f => join(EXAMPLES_DIR, f)));

let written = 0;
for (const f of files) {
  const snap = snapshotFor(f);
  writeFileSync(join(SNAPSHOT_DIR, `${basename(f)}.json`), JSON.stringify(snap, null, 2) + '\n');
  const tag = snap === null ? 'null (library)' : 'error' in (snap as object) ? `ERROR ${(snap as any).error}` : 'ok';
  console.log(`  ${tag.padEnd(14)} ${basename(f)}`);
  written++;
}

// meta.json: keep the frozen-oracle record, add the TS provenance note.
const metaPath = join(SNAPSHOT_DIR, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};
meta.tolerance ??= { bbox: 0.1, volume_percent: 1.0 };
meta.provenance = {
  note: 'A snapshot without a `source` block is from the frozen Python oracle above and is evidence of correctness. A snapshot with `source.implementation = "typescript"` was produced by the code under test: it detects change, not correctness, and was human-verified when written.',
  last_typescript_regeneration: new Date().toISOString(),
  typescript_kernel: occtVersion(),
};
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
console.log(`Wrote ${written} snapshot(s) -> ${SNAPSHOT_DIR}`);
