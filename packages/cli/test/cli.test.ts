import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

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

const tmpFile = '/tmp/polyscript-cli-test.poly';

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

  it('check — missing file', () => {
    const { code } = run(['check', '/tmp/nonexistent.poly']);
    expect(code).toBe(1);
  });
});
