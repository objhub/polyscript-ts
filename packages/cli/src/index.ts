#!/usr/bin/env node
/**
 * PolyScript CLI — poly command
 *
 * Every failure leaves through one channel: a `Diagnostic` with a stable code,
 * a source position when one is known, and a fix in `hint`. `--json` prints
 * them verbatim, the human path renders them one per line. Nothing is reported
 * as bare prose that a caller then has to pattern-match.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, resolve, extname, relative } from 'node:path';
import { Command } from 'commander';
import {
  parse, ParseError, validate, evaluate, resultShape, resultColorParts,
  extractParams, Trace, drainDiagnostics, makeDiagnostic, formatDiagnostic, explain,
  DIAGNOSTIC_CODES, asDiagnosticCode, fingerprint, runChecks,
} from '@polyscript/core';
import type { Value, Diagnostic, ValidationError, Program, EvalError } from '@polyscript/core';
import { buildOverrides, unknownParams } from './params.js';
// package.json is the single source of truth for the version. The import
// attribute is required by Node's and Deno's ESM loaders and permitted by
// tsconfig's `module: NodeNext`; bun build --compile inlines it, so the
// compiled binary reports the version without reading any file at runtime.
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;
export { parseCliValue, buildOverrides, unknownParams } from './params.js';

const EXIT_OK = 0;
const EXIT_IO = 1;
const EXIT_SYNTAX = 2;
const EXIT_SEMANTIC = 3;
const EXIT_EXPORT = 4;

// ---------------------------------------------------------------------------
// Diagnostics plumbing
// ---------------------------------------------------------------------------

function parseDiagnostic(e: ParseError): Diagnostic {
  return makeDiagnostic('syntax.parse', 'error', e.message, {
    loc: { line: e.line, column: e.column },
  });
}

function validationDiagnostics(errors: ValidationError[]): Diagnostic[] {
  return errors.map((e) => makeDiagnostic('context.invalid-op', 'error', e.message, {
    hint: e.hint,
    loc: e.line !== undefined ? { line: e.line, column: e.column ?? 0 } : undefined,
  })).map((d, i) => ({ ...d, code: errors[i].code }));
}

/** Kernel-level throws: the code and the fix ride along on the error. */
function evalDiagnostic(e: Error): Diagnostic {
  const c = e as EvalError;
  return makeDiagnostic(asDiagnosticCode(c.code) ?? 'eval.error', 'error', c.rawMessage ?? e.message, {
    hint: c.hint,
    loc: c.loc,
  });
}

function printDiagnostics(diags: Diagnostic[], file: string): void {
  for (const d of diags) console.error(formatDiagnostic(d, file));
}

/** Print the machine-readable payload (--json) or the human lines. Mirrors
 *  the Python CLI's _emit so the two implementations' output stays
 *  interchangeable for tooling. */
function emit(asJson: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const l of lines) console.log(l);
  }
}

// Several top-level shapes mean their union (see resultShape in core). This
// used to build a compound here instead, so `poly info`/`build -v` disagreed
// with both the regression harness and the browser bundle.
/** Extensions that already name each format, so `-o out.stp --format step`
 *  does not become `out.stp.step`. */
const FORMAT_EXTENSIONS: Record<string, string[]> = {
  stl: ['.stl'],
  step: ['.step', '.stp'],
  glb: ['.glb'],
  // Listed so `-o x.gltf` keeps its name and reaches exportShape, which
  // explains that OCCT writes the binary container and .glb is the extension.
  // Without this the unknown extension fell back to STL and silently produced
  // x.gltf.stl.
  gltf: ['.gltf'],
};

function formatFromExtension(file: string): string {
  const f = file.toLowerCase();
  for (const [fmt, exts] of Object.entries(FORMAT_EXTENSIONS)) {
    if (exts.some((e) => f.endsWith(e))) return fmt;
  }
  return 'stl';
}

function formatShapeInfo(info: ShapeInfoLike | null): string[] {
  if (!info) return [];
  return [
    `bbox: [${info.bbox.min.join(', ')}] - [${info.bbox.max.join(', ')}]`,
    `volume: ${info.volume.toFixed(2)}`,
    `area: ${info.area.toFixed(2)}`,
    `solids: ${info.solids}   valid: ${info.is_valid ? 'True' : 'False'}`,
    `topology: ${info.topology.faces} faces, ${info.topology.edges} edges, ${info.topology.vertices} vertices`,
  ];
}

interface ShapeInfoLike {
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volume: number;
  area: number;
  solids: number;
  is_valid: boolean;
  topology: { faces: number; edges: number; vertices: number };
}

function readInput(file: string): string {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    console.error(formatDiagnostic(
      makeDiagnostic('io.read', 'error', `cannot read file '${file}'`),
    ));
    return process.exit(EXIT_IO);
  }
}

/** Import resolver — loads .poly files relative to source directory. */
function makeImportResolver(sourceDir: string): (path: string) => string | null {
  const resolvedSourceDir = resolve(sourceDir);

  return (importPath: string) => {
    // Reject absolute paths
    if (importPath.startsWith('/') || importPath.startsWith('\\')) {
      throw new Error(`Absolute import path not allowed: "${importPath}"`);
    }
    // Reject parent directory traversal
    if (importPath.includes('..')) {
      throw new Error(`Parent directory traversal not allowed in import: "${importPath}"`);
    }

    const name = importPath.endsWith('.poly') ? importPath : `${importPath}.poly`;
    const fullPath = resolve(resolvedSourceDir, name);

    // Verify resolved path stays within source directory
    const rel = relative(resolvedSourceDir, fullPath);
    if (rel.startsWith('..') || rel.startsWith('/')) {
      throw new Error(`Import path escapes source directory: "${importPath}"`);
    }

    try {
      return readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// Shared load-and-evaluate path
// ---------------------------------------------------------------------------

interface LoadOptions {
  define?: string[];
  paramsFile?: string;
  trace?: boolean;
  timing?: boolean;
  json?: boolean;
}

interface LoadedModel {
  oc: any;
  result: Value;
  shape: any | null;
  info: ShapeInfoLike | null;
  fingerprint?: string;
  /** Warnings and infos gathered so far. Errors never come back here -- they
   *  leave through `fail`. */
  diagnostics: Diagnostic[];
  trace?: Trace;
  timing: Record<string, number>;
}

/**
 * Parse, validate, evaluate, and measure — the part every subcommand needs.
 *
 * On failure it emits the report and exits with the phase's code, so callers
 * only ever see a model that built.
 */
async function loadModel(file: string, opts: LoadOptions): Promise<LoadedModel> {
  const asJson = !!opts.json;
  const name = basename(file);
  const timing: Record<string, number> = {};
  let mark = performance.now();
  const lap = (stage: string) => {
    const now = performance.now();
    timing[stage] = Math.round((now - mark) * 10) / 10;
    mark = now;
  };

  const diagnostics: Diagnostic[] = [];
  const fail = (phase: string, errors: Diagnostic[], code: number): never => {
    const all = [...diagnostics, ...errors];
    printDiagnostics(all, name);
    emit(asJson, { ok: false, phase, file: name, diagnostics: all }, []);
    return process.exit(code) as never;
  };

  const source = readInput(file);
  const overrides = buildOverrides(opts.define ?? [], opts.paramsFile, (msg) => {
    console.error(msg);
    return process.exit(EXIT_IO) as never;
  });
  for (const p of unknownParams(source, overrides, extractParams)) {
    diagnostics.push(makeDiagnostic('param.unknown', 'warning',
      `-D ${p}: no top-level assignment found in input`,
      { hint: 'declare it as a parameter, or check the spelling against the file' }));
  }

  let ast: Program;
  try {
    ast = parse(source);
  } catch (e) {
    if (e instanceof ParseError) fail('parse', [parseDiagnostic(e)], EXIT_SYNTAX);
    throw e;
  }
  const errors = validate(ast);
  lap('parse');
  if (errors.length > 0) {
    fail('validate', validationDiagnostics(errors), EXIT_SEMANTIC);
  }

  const { initOC, shapeInfo } = await import('@polyscript/core/ocp-kernel');
  let oc: any;
  try {
    oc = await initOC();
    lap('init');
  } catch (err) {
    fail('evaluate', [makeDiagnostic('eval.error', 'error',
      `failed to initialize OpenCascade: ${err}`)], EXIT_EXPORT);
  }

  const trace = opts.trace ? new Trace({ timing: !!opts.timing }) : undefined;
  let result: Value;
  try {
    result = evaluate(ast, oc, {
      importResolver: makeImportResolver(dirname(resolve(file))),
      parseFn: parse,
      overrides,
      trace,
    });
    lap('evaluate');
  } catch (e) {
    diagnostics.push(...drainDiagnostics());
    if (e instanceof ParseError) fail('parse', [parseDiagnostic(e)], EXIT_SYNTAX);
    if (e instanceof Error) fail('evaluate', [evalDiagnostic(e)], EXIT_EXPORT);
    throw e;
  }
  diagnostics.push(...drainDiagnostics());

  const shape = resultShape(oc, result);
  let info: ShapeInfoLike | null = null;
  if (shape) {
    try { info = shapeInfo(oc, shape); } catch { /* best-effort */ }
  }

  return {
    oc, result, shape, info,
    fingerprint: info ? fingerprint(info) : undefined,
    diagnostics, trace, timing,
  };
}

/** `1 solid  bbox 80x60x25  volume 15552.0  faces 11  fp 3f2a91b0c4d1` */
function summaryLine(m: LoadedModel): string {
  if (!m.info) return 'evaluated (no shape)';
  const size = m.info.bbox.max.map((v, i) => round2(v - m.info!.bbox.min[i])).join('x');
  return [
    `${m.info.solids} solid${m.info.solids === 1 ? '' : 's'}`,
    `bbox ${size}`,
    `volume ${m.info.volume.toFixed(1)}`,
    `faces ${m.info.topology.faces}`,
    `valid ${m.info.is_valid}`,
    `fp ${m.fingerprint}`,
  ].join('  ');
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Warnings fail the build under --strict; infos never do. */
function strictFailure(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter((d) => d.severity === 'warning');
}

const program = new Command();

program
  .name('poly')
  .description('PolyScript — Parametric CAD DSL')
  .version(VERSION);

// check subcommand
program
  .command('check <file>')
  .description('Parse and validate a .poly file (no geometry kernel)')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action((file: string, opts: { json?: boolean }) => {
    const source = readInput(file);
    const name = basename(file);
    const asJson = !!opts.json;
    try {
      const ast = parse(source);
      const errors = validate(ast);
      if (errors.length > 0) {
        const diags = validationDiagnostics(errors);
        printDiagnostics(diags, name);
        console.error(`✗ ${name}: ${errors.length} validation error(s)`);
        emit(asJson, { ok: false, phase: 'validate', file: name, diagnostics: diags }, []);
        process.exit(EXIT_SEMANTIC);
      }
      emit(asJson, { ok: true, phase: 'validate', file: name, diagnostics: [] },
        [`✓ ${name}: OK`]);
      process.exit(EXIT_OK);
    } catch (e) {
      if (e instanceof ParseError) {
        const d = parseDiagnostic(e);
        printDiagnostics([d], name);
        emit(asJson, { ok: false, phase: 'parse', file: name, diagnostics: [d] }, []);
        process.exit(EXIT_SYNTAX);
      }
      throw e;
    }
  });

// dump-ast subcommand
program
  .command('dump-ast <file>')
  .description('Dump AST as JSON')
  .option('--pretty', 'Pretty-print JSON output')
  .action((file: string, opts: { pretty?: boolean }) => {
    const source = readInput(file);
    try {
      const ast = parse(source);
      const indent = opts.pretty ? 2 : undefined;
      console.log(JSON.stringify(ast, null, indent));
      process.exit(EXIT_OK);
    } catch (e) {
      if (e instanceof ParseError) {
        printDiagnostics([parseDiagnostic(e)], basename(file));
        process.exit(EXIT_SYNTAX);
      }
      throw e;
    }
  });

// build (default) subcommand
program
  .command('build <file>', { isDefault: true })
  .description('Build a .poly file to STL/STEP')
  .option('-o <output>', 'Output file path')
  .option('--format <fmt>', 'Output format (stl|step|glb)')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable: -D width=100 -D height=50)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides (merged with -D; -D takes precedence)')
  .option('--trace', 'Print per-step metrics (source line, selection, volume, solids)')
  .option('--timing', 'Print stage timings (init/parse/evaluate/export) to stderr; adds an ms column to --trace')
  .option('--strict', 'Treat warnings as errors (exit 3)')
  .option('--json', 'Machine-readable JSON report on stdout')
  .option('--mesh-deflection <value>', 'STL/glTF mesh precision (default 0.1; larger = coarser)', parseFloat)
  .option('--ascii-stl', 'Write ASCII STL instead of binary (about 6x larger; diff-friendly)')
  .option('-v, --verbose', 'Print B-Rep facts about the result')
  .action(async (file: string, opts: {
    o?: string; format?: string; define?: string[]; paramsFile?: string;
    trace?: boolean; timing?: boolean; strict?: boolean; json?: boolean; meshDeflection?: number; verbose?: boolean;
    asciiStl?: boolean;
  }) => {
    const name = basename(file);
    const m = await loadModel(file, opts);
    const { exportShape } = await import('@polyscript/core/ocp-kernel');

    // Determine output path
    const inputBase = basename(file, extname(file));
    const outputFile = opts.o ?? `${inputBase}.stl`;
    const fmt = opts.format ?? formatFromExtension(outputFile);
    const outputPath = FORMAT_EXTENSIONS[fmt]?.some((e) => outputFile.toLowerCase().endsWith(e))
      ? outputFile
      : `${outputFile}.${fmt}`;

    const lines: string[] = [];
    const payload: Record<string, unknown> = {
      ok: true, phase: 'export', file: name, diagnostics: m.diagnostics,
    };

    if (m.shape) {
      if (m.info) {
        payload.shape = m.info;
        payload.fingerprint = m.fingerprint;
      }
      if (opts.verbose) lines.push(...formatShapeInfo(m.info));
      const t0 = performance.now();
      // Colour only reaches glTF; collecting parts for STL/STEP would be
      // wasted kernel work on every build.
      const parts = fmt === 'glb' ? resultColorParts(m.oc, m.result) : undefined;
      try {
        await exportShape(m.oc, m.shape, outputPath, {
          linearDeflection: opts.meshDeflection,
          asciiStl: opts.asciiStl,
          parts,
        });
      } catch (e) {
        const d = evalDiagnostic(e as Error);
        printDiagnostics([d], name);
        emit(!!opts.json, { ok: false, phase: 'export', file: name, diagnostics: [...m.diagnostics, d] }, []);
        process.exit(EXIT_EXPORT);
      }
      m.timing.export = Math.round((performance.now() - t0) * 10) / 10;
      payload.artifacts = { [fmt]: outputPath };
      lines.push(`✓ ${name} → ${outputPath}`);
    } else {
      lines.push(`✓ ${name}: evaluated (no shape to export)`);
      payload.shape = null;
    }

    if (opts.timing) {
      // `evaluate` includes the trace's own per-step measuring when --trace
      // is on (volume and sub-shape counts are not free), so compare runs
      // with the same flags.
      m.timing.total = Math.round(Object.values(m.timing).reduce((a, b) => a + b, 0) * 10) / 10;
      payload.timing = m.timing;
      const order = ['parse', 'init', 'evaluate', 'export', 'total'];
      console.error(
        `timing: ${order.filter((k) => k in m.timing).map((k) => `${k}=${m.timing[k].toFixed(1)}ms`).join(' ')}`,
      );
    }

    if (m.trace) {
      payload.trace = m.trace.toList();
      if (!opts.json) {
        lines.push('');
        lines.push(m.trace.render());
      }
    }

    if (!opts.json) printDiagnostics(m.diagnostics, name);
    const warned = strictFailure(m.diagnostics);
    if (opts.strict && warned.length > 0) {
      payload.ok = false;
      emit(!!opts.json, payload, lines);
      console.error(`Error: ${warned.length} warning(s) with --strict`);
      process.exit(EXIT_SEMANTIC);
    }

    emit(!!opts.json, payload, lines);
    process.exit(EXIT_OK);
  });

// verify subcommand — the whole check in one call.
program
  .command('verify <file>')
  .description('Build and report everything needed to judge the result: diagnostics, per-step trace, B-Rep facts, fingerprint, checks')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides')
  .option('-o <output>', 'Also export the result (STL/STEP/GLB by extension)')
  .option('--no-strict', 'Report warnings without failing (default: any warning exits 3)')
  .option('--timing', 'Add stage and per-step timings')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (file: string, opts: {
    define?: string[]; paramsFile?: string; o?: string; strict?: boolean; timing?: boolean; json?: boolean;
  }) => {
    const name = basename(file);
    const m = await loadModel(file, { ...opts, trace: true });
    const checks = runChecks(m.trace?.toList() as never, m.info as never);

    const lines: string[] = [];
    const payload: Record<string, unknown> = {
      ok: true, phase: 'verify', file: name,
      diagnostics: m.diagnostics,
      checks,
      shape: m.info,
      fingerprint: m.fingerprint,
      trace: m.trace?.toList(),
    };

    if (opts.o && !m.shape) {
      // A library-only file (defs and no geometry) has nothing to write; that
      // is not a failure, so say it rather than letting the exporter throw.
      lines.push(`- ${name}: no shape to export`);
    } else if (opts.o) {
      const { exportShape } = await import('@polyscript/core/ocp-kernel');
      const fmt = formatFromExtension(opts.o);
      try {
        await exportShape(m.oc, m.shape, opts.o, {
          parts: fmt === 'glb' ? resultColorParts(m.oc, m.result) : undefined,
        });
        payload.artifacts = { [fmt]: opts.o };
        lines.push(`✓ ${name} → ${opts.o}`);
      } catch (e) {
        const d = evalDiagnostic(e as Error);
        printDiagnostics([d], name);
        emit(!!opts.json, { ...payload, ok: false, phase: 'export', diagnostics: [...m.diagnostics, d] }, []);
        process.exit(EXIT_EXPORT);
      }
    }

    if (opts.timing) payload.timing = m.timing;

    if (m.trace) {
      lines.push(m.trace.render());
      lines.push('');
    }
    if (!opts.json) {
      printDiagnostics(m.diagnostics, name);
      printDiagnostics(checks, name);
    }
    lines.push(`${strictFailure(m.diagnostics).length && opts.strict ? '✗' : '✓'} ${name}: ${summaryLine(m)}`);

    const warned = strictFailure(m.diagnostics);
    if (opts.strict && warned.length > 0) {
      payload.ok = false;
      emit(!!opts.json, payload, lines);
      console.error(`Error: ${warned.length} warning(s) -- verify is strict by default (--no-strict to allow)`);
      process.exit(EXIT_SEMANTIC);
    }
    emit(!!opts.json, payload, lines);
    process.exit(EXIT_OK);
  });

// diff subcommand — did the edit change the geometry?
program
  .command('diff <a> <b>')
  .description('Compare the B-Rep facts of two .poly files (fingerprint, volume, bbox, topology)')
  .option(
    '-D, --define <value>',
    'Override parameter in both files (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (a: string, b: string, opts: { define?: string[]; json?: boolean }) => {
    const [ma, mb] = [
      await loadModel(a, { define: opts.define, json: opts.json }),
      await loadModel(b, { define: opts.define, json: opts.json }),
    ];
    const same = ma.fingerprint === mb.fingerprint;
    const changes = compareShapes(ma.info, mb.info);
    const lines = same
      ? [`= identical  ${basename(a)} ${basename(b)}  fp ${ma.fingerprint}`]
      : [
        `≠ changed  ${basename(a)} → ${basename(b)}`,
        ...changes.map((c) => `  ${c.field}: ${c.from} → ${c.to}${c.delta ? `  (${c.delta})` : ''}`),
      ];
    emit(!!opts.json, {
      ok: true, phase: 'diff', same,
      a: { file: basename(a), shape: ma.info, fingerprint: ma.fingerprint },
      b: { file: basename(b), shape: mb.info, fingerprint: mb.fingerprint },
      changes,
      diagnostics: [...ma.diagnostics, ...mb.diagnostics],
    }, lines);
    process.exit(EXIT_OK);
  });

interface ShapeChange { field: string; from: string | number; to: string | number; delta?: string }

/** Field-by-field comparison, changed fields only. */
function compareShapes(a: ShapeInfoLike | null, b: ShapeInfoLike | null): ShapeChange[] {
  if (!a || !b) {
    return a === b ? [] : [{ field: 'shape', from: a ? 'shape' : 'none', to: b ? 'shape' : 'none' }];
  }
  const out: ShapeChange[] = [];
  const num = (field: string, x: number, y: number, digits = 4) => {
    if (Number(x.toPrecision(7)) === Number(y.toPrecision(7))) return;
    const pct = x !== 0 ? ((y - x) / Math.abs(x)) * 100 : Number.NaN;
    out.push({
      field,
      from: Number(x.toFixed(digits)),
      to: Number(y.toFixed(digits)),
      delta: Number.isNaN(pct)
        ? `${y - x > 0 ? '+' : ''}${Number((y - x).toFixed(digits))}`
        : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
    });
  };
  num('volume', a.volume, b.volume);
  num('area', a.area, b.area);
  for (const [i, axis] of ['x', 'y', 'z'].entries()) {
    num(`bbox.min.${axis}`, a.bbox.min[i], b.bbox.min[i]);
    num(`bbox.max.${axis}`, a.bbox.max[i], b.bbox.max[i]);
  }
  const count = (field: string, x: number, y: number) => {
    if (x !== y) out.push({ field, from: x, to: y, delta: `${y - x > 0 ? '+' : ''}${y - x}` });
  };
  count('solids', a.solids, b.solids);
  count('faces', a.topology.faces, b.topology.faces);
  count('edges', a.topology.edges, b.topology.edges);
  count('vertices', a.topology.vertices, b.topology.vertices);
  if (a.is_valid !== b.is_valid) {
    out.push({ field: 'is_valid', from: String(a.is_valid), to: String(b.is_valid) });
  }
  return out;
}

// explain subcommand — the long form of a diagnostic code.
program
  .command('explain [code]')
  .description('Explain a diagnostic code: why it happens and how to fix it')
  .action((code?: string) => {
    if (!code) {
      console.log('Diagnostic codes:');
      for (const c of DIAGNOSTIC_CODES) console.log(`  ${c}`);
      console.log('\nRun `poly explain <code>` for the long form.');
      process.exit(EXIT_OK);
    }
    const text = explain(code);
    if (!text) {
      console.error(`Unknown diagnostic code: ${code}`);
      console.error(`Known codes: ${DIAGNOSTIC_CODES.join(', ')}`);
      process.exit(EXIT_IO);
    }
    console.log(text);
    process.exit(EXIT_OK);
  });

// info subcommand — B-Rep facts without exporting. Mirrors the Python CLI.
program
  .command('info <file>')
  .description('Report B-Rep facts about the result (bbox, volume, solids, validity)')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides')
  .option('--json', 'Machine-readable JSON report on stdout')
  .action(async (file: string, opts: { define?: string[]; paramsFile?: string; json?: boolean }) => {
    const m = await loadModel(file, opts);
    if (!m.info) {
      emit(!!opts.json, {
        ok: true, phase: 'evaluate', file: basename(file), diagnostics: m.diagnostics, shape: null,
      }, ['No geometry (library-only file)']);
      process.exit(EXIT_OK);
    }
    if (!opts.json) printDiagnostics(m.diagnostics, basename(file));
    emit(!!opts.json, {
      ok: true, phase: 'evaluate', file: basename(file), diagnostics: m.diagnostics,
      shape: m.info, fingerprint: m.fingerprint,
    }, formatShapeInfo(m.info));
    process.exit(EXIT_OK);
  });

program.parse();
