import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCliValue, buildOverrides } from '../src/params.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 };
}

/** Parse an STL file and return its bounding box max X. */
function stlMaxX(path: string): number {
  const c = readFileSync(path, 'utf-8');
  const verts = [...c.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)];
  let max = -Infinity;
  for (const m of verts) max = Math.max(max, parseFloat(m[1]));
  return max;
}

describe('parseCliValue', () => {
  it('infers int', () => {
    expect(parseCliValue('100')).toBe(100);
    expect(parseCliValue('-5')).toBe(-5);
  });

  it('infers float', () => {
    expect(parseCliValue('1.5')).toBe(1.5);
    expect(parseCliValue('-0.5')).toBe(-0.5);
  });

  it('infers bool', () => {
    expect(parseCliValue('true')).toBe(true);
    expect(parseCliValue('True')).toBe(true);
    expect(parseCliValue('FALSE')).toBe(false);
  });

  it('falls back to string', () => {
    expect(parseCliValue('PLA')).toBe('PLA');
    expect(parseCliValue('hello world')).toBe('hello world');
  });

  it('empty string stays string', () => {
    expect(parseCliValue('')).toBe('');
  });
});

describe('buildOverrides (pure)', () => {
  it('single define', () => {
    expect(buildOverrides(['width=100'], undefined)).toEqual({ width: 100 });
  });

  it('multiple defines', () => {
    expect(buildOverrides(['width=100', 'height=50', 'name=PLA'], undefined)).toEqual({
      width: 100,
      height: 50,
      name: 'PLA',
    });
  });

  it('loads params file', () => {
    const pf = '/tmp/polyscript-cli-params-test.json';
    writeFileSync(pf, JSON.stringify({ w: 10, h: 20, material: 'ABS' }));
    try {
      expect(buildOverrides([], pf)).toEqual({ w: 10, h: 20, material: 'ABS' });
    } finally {
      if (existsSync(pf)) unlinkSync(pf);
    }
  });

  it('CLI -D overrides params file', () => {
    const pf = '/tmp/polyscript-cli-params-test2.json';
    writeFileSync(pf, JSON.stringify({ w: 10 }));
    try {
      expect(buildOverrides(['w=999'], pf)).toEqual({ w: 999 });
    } finally {
      if (existsSync(pf)) unlinkSync(pf);
    }
  });
});

describe('CLI integration — -D and --params-file', () => {
  const srcFile = '/tmp/polyscript-cli-param-test.poly';
  const outFile = '/tmp/polyscript-cli-param-test.stl';

  it('-D changes runtime value', () => {
    writeFileSync(srcFile, 'w = 10\nbox w w w\n');
    const { code } = run(['build', srcFile, '-D', 'w=50', '-o', outFile]);
    expect(code).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    // STL should reflect 50-unit box
    const xmax = stlMaxX(outFile);
    // box w w w with w=50 centers at origin, so max X = 25
    expect(xmax).toBeCloseTo(25, 1);
    unlinkSync(srcFile);
    unlinkSync(outFile);
  });

  it('default works without -D', () => {
    writeFileSync(srcFile, 'w = 10\nbox w w w\n');
    const { code } = run(['build', srcFile, '-o', outFile]);
    expect(code).toBe(0);
    unlinkSync(srcFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  });

  it('unknown parameter emits warning', () => {
    writeFileSync(srcFile, 'w = 10\nbox w w w\n');
    const { code, stderr } = run(['build', srcFile, '-D', 'unknown_x=42', '-o', outFile]);
    expect(code).toBe(0);  // warning, not error
    expect(stderr).toContain('Warning');
    expect(stderr).toContain('unknown_x');
    unlinkSync(srcFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  });

  it('invalid -D format exits non-zero', () => {
    writeFileSync(srcFile, 'box 10 10 10\n');
    const { code, stderr } = run(['build', srcFile, '-D', 'no_equals', '-o', outFile]);
    expect(code).not.toBe(0);
    expect(stderr).toContain('NAME=VALUE');
    unlinkSync(srcFile);
  });

  it('missing params file exits non-zero', () => {
    writeFileSync(srcFile, 'box 10 10 10\n');
    const { code, stderr } = run([
      'build', srcFile,
      '--params-file', '/tmp/does-not-exist-xyz.json',
      '-o', outFile,
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toContain('not found');
    unlinkSync(srcFile);
  });

  it('--params-file loads values', () => {
    const pf = '/tmp/polyscript-cli-params-int.json';
    writeFileSync(srcFile, 'w = 10\nbox w w w\n');
    writeFileSync(pf, JSON.stringify({ w: 30 }));
    try {
      const { code } = run(['build', srcFile, '--params-file', pf, '-o', outFile]);
      expect(code).toBe(0);
      expect(existsSync(outFile)).toBe(true);
      const xmax = stlMaxX(outFile);
      // w=30 box: half = 15, so max X = 15
      expect(xmax).toBeCloseTo(15, 1);
    } finally {
      unlinkSync(srcFile);
      if (existsSync(outFile)) unlinkSync(outFile);
      unlinkSync(pf);
    }
  });

  it('CLI -D beats --params-file', () => {
    const pf = '/tmp/polyscript-cli-params-pri.json';
    writeFileSync(srcFile, 'w = 10\nbox w w w\n');
    writeFileSync(pf, JSON.stringify({ w: 30 }));
    try {
      const { code } = run([
        'build', srcFile,
        '--params-file', pf,
        '-D', 'w=40',
        '-o', outFile,
      ]);
      expect(code).toBe(0);
      const xmax = stlMaxX(outFile);
      // w=40 wins: max X = 20
      expect(xmax).toBeCloseTo(20, 1);
    } finally {
      unlinkSync(srcFile);
      if (existsSync(outFile)) unlinkSync(outFile);
      unlinkSync(pf);
    }
  });
});
