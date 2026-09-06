#!/usr/bin/env bun
/**
 * Check the shipping `poly` binary against the regression snapshots.
 *
 *   POLY=packages/cli/dist/bin/poly bun tests/binary_check.ts
 *
 * `make fulltest` drives the core library directly through vitest, so it never
 * touches the CLI. That gap let `poly info`/`poly build` ship a compound where
 * the library fused (00_polyscript_logo: 4 solids, +3.6% volume) with every
 * test green. This runs the real binary over every corpus file that has a
 * snapshot and applies the same tolerances the harness does.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, 'examples');
// Regression cases live outside the teaching corpus (see tests/README.md), so
// a snapshot's .poly is in one directory or the other.
const REGRESSIONS = join(HERE, 'regressions');
const CORPUS_DIRS = [EXAMPLES, REGRESSIONS];
const SNAPS = join(HERE, 'snapshots');
// Resolved here because the binary is spawned with cwd set to the corpus
// directory the file came from.
const POLY = resolve(process.env.POLY ?? join(HERE, '..', 'build', 'bin', 'poly'));

/** The corpus directory holding `name`, or null when no such file exists. */
function corpusDirOf(name: string): string | null {
  return CORPUS_DIRS.find((dir) => existsSync(join(dir, name))) ?? null;
}

const meta = JSON.parse(readFileSync(join(SNAPS, 'meta.json'), 'utf-8'));
const bboxTol: number = meta.tolerance?.bbox ?? 0.1;
const volPct: number = meta.tolerance?.volume_percent ?? 1.0;

let checked = 0, failed = 0;
for (const snapFile of readdirSync(SNAPS).filter(f => f.endsWith('.poly.json')).sort()) {
  const name = snapFile.replace(/\.json$/, '');
  const expected = JSON.parse(readFileSync(join(SNAPS, snapFile), 'utf-8'));
  if (expected === null || 'error' in expected) continue;   // library-only or known-bad

  const cwd = corpusDirOf(name);
  if (!cwd) {
    checked++; failed++;
    console.log(`FAIL ${name}\n    no .poly in ${CORPUS_DIRS.join(' or ')} (snapshot without a source file)`);
    continue;
  }

  const r = spawnSync(POLY, ['info', name, '--json'], { cwd, encoding: 'utf-8' });
  let got: any = null;
  try { got = JSON.parse(r.stdout).shape; } catch { /* fall through */ }
  const problems: string[] = [];
  if (r.status !== 0 || !got) {
    const tail = ((r.stderr || r.stdout || r.error?.message || '') as string).trim().split('\n').pop();
    problems.push(`poly info failed (exit ${r.status}): ${tail}`);
  } else {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(got.bbox.min[i] - expected.bbox.min[i]) > bboxTol) problems.push(`bbox.min[${i}] ${got.bbox.min[i]} vs ${expected.bbox.min[i]}`);
      if (Math.abs(got.bbox.max[i] - expected.bbox.max[i]) > bboxTol) problems.push(`bbox.max[${i}] ${got.bbox.max[i]} vs ${expected.bbox.max[i]}`);
    }
    const dv = Math.abs(got.volume - expected.volume) / Math.max(Math.abs(expected.volume), 1e-9) * 100;
    if (dv > volPct) problems.push(`volume ${got.volume.toFixed(2)} vs ${expected.volume} (${dv.toFixed(2)}%)`);
    for (const k of ['faces', 'edges', 'vertices'] as const) {
      if (got.topology[k] !== expected.topology[k]) problems.push(`${k} ${got.topology[k]} vs ${expected.topology[k]}`);
    }
  }
  checked++;
  if (problems.length) { failed++; console.log(`FAIL ${name}\n    ${problems.join('\n    ')}`); }
}
console.log(`binary_check: ${checked - failed}/${checked} corpus files match the snapshots (${POLY})`);
process.exit(failed ? 1 : 0);
