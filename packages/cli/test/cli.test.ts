import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? '', code: err.status ?? 1 };
  }
}

const tmpFile = join(tmpdir(), 'polyscript-cli-test.poly');

describe('CLI', () => {
  it('check — valid file', () => {
    writeFileSync(tmpFile, 'box 10 10 10 | fillet 2');
    const { stdout, code } = run(['check', tmpFile]);
    expect(code).toBe(0);
    expect(stdout).toContain('OK');
    unlinkSync(tmpFile);
  });

  it('check — syntax error', () => {
    writeFileSync(tmpFile, 'box | | |');
    const { code } = run(['check', tmpFile]);
    expect(code).toBe(2);
    unlinkSync(tmpFile);
  });

  it('dump-ast — outputs JSON', () => {
    writeFileSync(tmpFile, 'sphere 10');
    const { stdout, code } = run(['dump-ast', tmpFile]);
    expect(code).toBe(0);
    const ast = JSON.parse(stdout);
    expect(ast.type).toBe('Program');
    expect(ast.statements[0].type).toBe('SphereExpr');
    unlinkSync(tmpFile);
  });

  it('dump-ast --pretty — formatted JSON', () => {
    writeFileSync(tmpFile, 'box 1 2 3');
    const { stdout, code } = run(['dump-ast', tmpFile, '--pretty']);
    expect(code).toBe(0);
    expect(stdout).toContain('\n'); // formatted
    unlinkSync(tmpFile);
  });

  it('build -o .svg — a line drawing, not an STL', () => {
    writeFileSync(tmpFile, 'box 100 60 40');
    const out = join(tmpdir(), 'polyscript-cli-test.svg');
    const { code } = run(['build', tmpFile, '-o', out]);
    expect(code).toBe(0);
    const svg = readFileSync(out, 'utf-8');
    expect(svg.startsWith('<svg')).toBe(true);
    // Four panels by default, and the footer carries the modelled size.
    for (const label of ['Front', 'Top', 'Right', 'Iso']) expect(svg).toContain(`>${label}</text>`);
    expect(svg).toContain('100 × 60 × 40 (X×Y×Z)');
    unlinkSync(out);
    unlinkSync(tmpFile);
  });

  it('build --view — one named panel', () => {
    writeFileSync(tmpFile, 'box 100 60 40');
    const out = join(tmpdir(), 'polyscript-cli-test-one.svg');
    const { code } = run(['build', tmpFile, '-o', out, '--view', 'iso']);
    expect(code).toBe(0);
    const svg = readFileSync(out, 'utf-8');
    // A single view carries no panel label and no size footer -- but it still
    // draws the gnomon, whose axis names are <text> too.
    expect(svg).not.toContain('>Iso</text>');
    expect(svg).not.toContain('(X×Y×Z)');
    expect(svg).toContain('>Z</text>');
    unlinkSync(out);
    unlinkSync(tmpFile);
  });

  it('build --view — an unknown name is refused', () => {
    writeFileSync(tmpFile, 'box 10 10 10');
    const out = join(tmpdir(), 'polyscript-cli-test-bad.svg');
    const { code } = run(['build', tmpFile, '-o', out, '--view', 'oblique']);
    expect(code).toBe(1);
    unlinkSync(tmpFile);
  });

  it('check — missing file', () => {
    const { code } = run(['check', join(tmpdir(), 'nonexistent.poly')]);
    expect(code).toBe(1);
  });
});
