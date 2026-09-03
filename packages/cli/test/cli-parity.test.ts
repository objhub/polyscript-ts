/**
 * Parity tests for the CLI surface that the polyscript-modeling verification
 * workflow depends on: `info`, `--trace`, `--strict`, `--json`, and the
 * 0/1/2/3/4 exit-code contract. Mirrors python/tests/test_check_trace.py.
 *
 * These spawn the real CLI (dist build) because exit codes and stream
 * separation are part of the contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status ?? 1 };
  }
}

let dir: string;
const f = (name: string) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'poly-cli-parity-'));
  writeFileSync(f('good.poly'), 'box 60 40 30 | faces ">Z" | shell 2\n');
  writeFileSync(f('warn.poly'), 'box 60 40 30 | faces "Z" | shell 2\n');
  writeFileSync(f('syntax.poly'), 'box 10 |\n');
  writeFileSync(f('evalfail.poly'), 'box 10 10 10 | edges ">Z and =Z" | fillet 1\n');
  // Two overlapping top-level shapes: their union is one solid of 1000 + 1000 - 125.
  writeFileSync(f('implicit-union.poly'), 'box 10 10 10\nbox 10 10 10 | translate 5 5 5\n');
}, 30000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('exit codes (0/2/3/4 contract)', () => {
  it('clean build exits 0', () => {
    expect(run(['build', f('good.poly'), '-o', f('o.stl')]).code).toBe(0);
  }, 120000);

  it('syntax error exits 2', () => {
    expect(run(['build', f('syntax.poly'), '-o', f('o.stl')]).code).toBe(2);
  }, 120000);

  it('a warning under --strict exits 3', () => {
    const r = run(['build', f('warn.poly'), '-o', f('o.stl'), '--strict']);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('--strict');
  }, 120000);

  it('evaluation failure exits 4', () => {
    const r = run(['build', f('evalfail.poly'), '-o', f('o.stl')]);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('matched 0 of');
  }, 120000);
});

describe('info', () => {
  it('reports bbox/volume/solids/validity', () => {
    const r = run(['info', f('good.poly')]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('volume:');
    expect(r.stdout).toContain('solids: 1   valid: True');
    expect(r.stdout).toMatch(/topology: \d+ faces/);
  }, 120000);

  it('fuses several top-level shapes into one solid, like the harness and the browser', () => {
    // The CLI used to build a compound here, so info reported 2 solids and a
    // volume that double-counted the overlap (00_polyscript_logo: 4 solids,
    // +3.6%) while the regression harness -- which bypasses the CLI -- passed.
    const r = run(['info', f('implicit-union.poly'), '--json']);
    const d = JSON.parse(r.stdout);
    expect(d.shape.solids).toBe(1);
    expect(d.shape.volume).toBeCloseTo(1875, 0);
  }, 120000);

  it('--json returns the shape payload', () => {
    const r = run(['info', f('good.poly'), '--json']);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(true);
    expect(d.shape.solids).toBe(1);
    expect(d.shape.is_valid).toBe(true);
    expect(d.shape.volume).toBeGreaterThan(0);
  }, 120000);
});

describe('--trace', () => {
  it('prints per-step selection counts and volumes', () => {
    const r = run(['build', f('good.poly'), '-o', f('o.stl'), '--trace']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/faces >Z\s+FaceSelection\s+1\/6/);
    expect(r.stdout).toMatch(/shell 2\s+3D/);
  }, 120000);

  it('--json carries the trace array with python-compatible keys', () => {
    const r = run(['build', f('good.poly'), '-o', f('o.stl'), '--trace', '--json']);
    const d = JSON.parse(r.stdout);
    expect(Array.isArray(d.trace)).toBe(true);
    const sel = d.trace.find((s: any) => s.op.startsWith('faces'));
    expect(sel.selected).toBe(1);
    expect(sel.total).toBe(6);
    const last = d.trace[d.trace.length - 1];
    expect(last.volume).toBeGreaterThan(0);
    expect(last.solids).toBe(1);
  }, 120000);
});

describe('warnings', () => {
  it('an unrecognized selector warns (and is a diagnostic in --json)', () => {
    const r = run(['build', f('warn.poly'), '-o', f('o.stl'), '--json']);
    const d = JSON.parse(r.stdout);
    const warns = d.diagnostics.filter((x: any) => x.severity === 'warning');
    expect(warns.length).toBe(1);
    expect(warns[0].message).toContain("unrecognized selector 'Z'");
  }, 120000);
});
