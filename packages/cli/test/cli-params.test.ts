import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCliValue, buildOverrides, checkOverrideTypes, commentedParamLines } from '../src/params.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 };
}

/** Parse a binary STL file and return its bounding box max X. */
function stlMaxX(path: string): number {
  const c = readFileSync(path);
  const view = new DataView(c.buffer, c.byteOffset, c.byteLength);
  const facets = view.getUint32(80, true);
  let max = -Infinity;
  for (let t = 0; t < facets; t++) {
    for (let v = 0; v < 3; v++) {
      max = Math.max(max, view.getFloat32(84 + 50 * t + 12 + 12 * v, true));
    }
  }
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
    const pf = join(tmpdir(), 'polyscript-cli-params-test.json');
    writeFileSync(pf, JSON.stringify({ w: 10, h: 20, material: 'ABS' }));
    try {
      expect(buildOverrides([], pf)).toEqual({ w: 10, h: 20, material: 'ABS' });
    } finally {
      if (existsSync(pf)) unlinkSync(pf);
    }
  });

  it('CLI -D overrides params file', () => {
    const pf = join(tmpdir(), 'polyscript-cli-params-test2.json');
    writeFileSync(pf, JSON.stringify({ w: 10 }));
    try {
      expect(buildOverrides(['w=999'], pf)).toEqual({ w: 999 });
    } finally {
      if (existsSync(pf)) unlinkSync(pf);
    }
  });
});

describe('CLI integration — -D and --params-file', () => {
  const srcFile = join(tmpdir(), 'polyscript-cli-param-test.poly');
  const outFile = join(tmpdir(), 'polyscript-cli-param-test.stl');

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
    expect(stderr).toContain('warning param.unknown');
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
      '--params-file', join(tmpdir(), 'does-not-exist-xyz.json'),
      '-o', outFile,
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toContain('not found');
    unlinkSync(srcFile);
  });

  it('--params-file loads values', () => {
    const pf = join(tmpdir(), 'polyscript-cli-params-int.json');
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
    const pf = join(tmpdir(), 'polyscript-cli-params-pri.json');
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

describe('checkOverrideTypes: -D against the declared @param type', () => {
  const params = [
    { name: 'engrave', type: 'bool' as const },
    { name: 'size', type: 'int' as const },
    { name: 'name', type: 'string' as const },
  ];
  const check = (defs: string[]) => {
    const o = buildOverrides(defs, undefined);
    return { errors: checkOverrideTypes(defs, o, params), overrides: o };
  };

  it('a bool takes exactly true / false', () => {
    expect(check(['engrave=true']).errors).toEqual([]);
    expect(check(['engrave=false']).overrides.engrave).toBe(false);
    for (const v of ['no', 'off', '1', '0', 'yes']) {
      const [e] = check([`engrave=${v}`]).errors;
      expect(e.message, v).toBe(`engrave is a bool parameter; got ${v}`);
      expect(e.hint).toBe('use engrave=true or engrave=false');
    }
  });

  it('a number rejects text', () => {
    expect(check(['size=10']).errors).toEqual([]);
    expect(check(['size=big']).errors.map(e => e.name)).toEqual(['size']);
  });

  it('a string keeps the -D text verbatim', () => {
    expect(check(['name=007']).overrides.name).toBe('007');
    expect(check(['name=true']).overrides.name).toBe('true');
  });

  it('undeclared names are left to unknownParams', () => {
    expect(check(['other=no']).errors).toEqual([]);
  });
});

describe('commentedParamLines', () => {
  it('finds # @param above an assignment only', () => {
    const src = '# @param 1..10\nw = 5\n@param 1..3\nh = 2\n# mentions @param in prose\n# @param note\n\nbox w h 1';
    expect(commentedParamLines(src)).toEqual([1]);
  });
});

describe('checkOverrideTypes: choices', () => {
  const params = [{ name: 'bolt', type: 'string' as const, choices: ['M3', 'M4', 'M5'] }, { name: 'n', type: 'int' as const, choices: [1, 2] }];
  const check = (defs: string[]) => checkOverrideTypes(defs, buildOverrides(defs, undefined), params);
  it('accepts a listed value and rejects any other', () => {
    expect(check(['bolt=M3'])).toEqual([]);
    expect(check(['n=2'])).toEqual([]);
    const [e] = check(['bolt=M7']);
    expect(e.code).toBe('param.choice');
    expect(e.message).toBe('bolt must be one of "M3", "M4", "M5"; got M7');
    expect(check(['n=3']).map(e => e.name)).toEqual(['n']);
  });
});

describe('checkOverrideTypes: @param range', () => {
  const params = [
    { name: 'width', type: 'int' as const, min: 30, max: 120 },
    { name: 'low', type: 'float' as const, min: 1.2 },
  ];
  const check = (defs: string[]) => checkOverrideTypes(defs, buildOverrides(defs, undefined), params);
  it('passes the bounds themselves and flags values past them', () => {
    expect(check(['width=30'])).toEqual([]);
    expect(check(['width=120'])).toEqual([]);
    const [e] = check(['width=1000']);
    expect(e.code).toBe('param.range');
    expect(e.message).toBe('width is outside its @param range 30..120; got 1000');
    expect(check(['width=29.9']).map(e => e.code)).toEqual(['param.range']);
    expect(check(['low=1']).map(e => e.message)).toEqual(['low is outside its @param range 1.2..; got 1']);
    expect(check(['low=100'])).toEqual([]);
  });
  it('a type error is reported alone, not also as out of range', () => {
    expect(check(['width=wide']).map(e => e.code)).toEqual(['param.type']);
  });
});

describe('poly -D against choices and range', () => {
  const srcFile = join(tmpdir(), 'polyscript-cli-param-range.poly');
  const src = '@param choices:["M3", "M4"]\nbolt = "M4"\n@param 30..120\nwidth = 80\nbox width 10 (if bolt == "M3" then 3 else 4)\n';
  it('a value outside choices is an error', () => {
    writeFileSync(srcFile, src);
    const { code, stderr } = run(['verify', srcFile, '-D', 'bolt=M8']);
    expect(code).toBe(1);
    expect(stderr).toContain('error param.choice');
    unlinkSync(srcFile);
  });
  it('a value outside the range warns, and fails only under strict', () => {
    writeFileSync(srcFile, src);
    const strict = run(['verify', srcFile, '-D', 'width=1000']);
    expect(strict.code).toBe(3);
    expect(strict.stderr).toContain('warning param.range');
    const loose = run(['verify', srcFile, '--no-strict', '-D', 'width=1000']);
    expect(loose.code).toBe(0);
    unlinkSync(srcFile);
  });
});
