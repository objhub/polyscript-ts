#!/usr/bin/env node
/**
 * PolyScript CLI — poly command
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, resolve, extname, relative } from 'node:path';
import { Command } from 'commander';
import { parse, ParseError, validate, evaluate, resultShape, EvalError, extractParams, Trace, drainWarnings } from '@polyscript/core';
import type { Value } from '@polyscript/core';
import { buildOverrides, warnUnknownParams } from './params.js';
// package.json is the single source of truth for the version. The import
// attribute is required by Node's and Deno's ESM loaders and permitted by
// tsconfig's `module: NodeNext`; bun build --compile inlines it, so the
// compiled binary reports the version without reading any file at runtime.
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;
export { parseCliValue, buildOverrides, warnUnknownParams } from './params.js';

const EXIT_OK = 0;
const EXIT_IO = 1;
const EXIT_SYNTAX = 2;
const EXIT_SEMANTIC = 3;
const EXIT_EXPORT = 4;


type Diagnostic = { severity: 'warning' | 'error'; message: string; code?: string };

function warningDiagnostics(): Diagnostic[] {
  return drainWarnings().map((m: string) => ({ severity: 'warning' as const, message: m }));
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
function extractShape(result: Value, oc: any): any {
  return resultShape(oc, result);
}

function formatShapeInfo(info: any): string[] {
  if (!info) return [];
  return [
    `bbox: [${info.bbox.min.join(', ')}] - [${info.bbox.max.join(', ')}]`,
    `volume: ${info.volume.toFixed(2)}`,
    `area: ${info.area.toFixed(2)}`,
    `solids: ${info.solids}   valid: ${info.is_valid ? 'True' : 'False'}`,
    `topology: ${info.topology.faces} faces, ${info.topology.edges} edges, ${info.topology.vertices} vertices`,
  ];
}

function readInput(file: string): string {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    console.error(`Error: Cannot read file '${file}'`);
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

const program = new Command();

program
  .name('poly')
  .description('PolyScript — Parametric CAD DSL')
  .version(VERSION);

// check subcommand
program
  .command('check <file>')
  .description('Parse and validate a .poly file')
  .action((file: string) => {
    const source = readInput(file);
    try {
      const ast = parse(source);
      const errors = validate(ast);
      if (errors.length > 0) {
        for (const err of errors) {
          console.error(`  ⚠ ${err.message}`);
        }
        console.error(`✗ ${basename(file)}: ${errors.length} validation error(s)`);
        process.exit(EXIT_SEMANTIC);
      }
      console.log(`✓ ${basename(file)}: OK`);
      process.exit(EXIT_OK);
    } catch (e) {
      if (e instanceof ParseError) {
        console.error(`✗ ${basename(file)}: ${(e as ParseError).message}`);
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
        console.error(`Parse error: ${(e as ParseError).message}`);
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
  .option('--format <fmt>', 'Output format (stl|step)')
  .option(
    '-D, --define <value>',
    'Override parameter (repeatable: -D width=100 -D height=50)',
    (v: string, prev: string[] = []) => [...prev, v],
    [] as string[],
  )
  .option('--params-file <path>', 'JSON file with parameter overrides (merged with -D; -D takes precedence)')
  .option('--trace', 'Print per-step metrics (selection counts, volume, solids)')
  .option('--strict', 'Treat warnings as errors (exit 3)')
  .option('--json', 'Machine-readable JSON report on stdout')
  .option('--mesh-deflection <value>', 'STL/glTF mesh precision (default 0.1; larger = coarser)', parseFloat)
  .option('-v, --verbose', 'Print B-Rep facts about the result')
  .action(async (file: string, opts: {
    o?: string; format?: string; define?: string[]; paramsFile?: string;
    trace?: boolean; strict?: boolean; json?: boolean; meshDeflection?: number; verbose?: boolean;
  }) => {
    const source = readInput(file);
    const overrides = buildOverrides(opts.define ?? [], opts.paramsFile, (msg) => {
      console.error(msg);
      return process.exit(EXIT_IO) as never;
    });
    const diagnostics: Diagnostic[] = [];
    warnUnknownParams(source, overrides, extractParams);
    try {
      const ast = parse(source);
      const errors = validate(ast);
      if (errors.length > 0) {
        for (const err of errors) {
          console.error(`  ! ${err.message}`);
        }
        console.error(`✗ ${basename(file)}: ${errors.length} validation error(s)`);
        emit(!!opts.json, {
          ok: false, phase: 'validate',
          diagnostics: [...diagnostics, ...errors.map((e) => ({ severity: 'error', message: e.message }))],
        }, []);
        process.exit(EXIT_SEMANTIC);
      }

      // Initialize OpenCascade
      const { initOC, exportShape, shapeInfo } = await import('@polyscript/core/ocp-kernel');
      let oc: any;
      try {
        oc = await initOC();
      } catch (err) {
        console.error(`Error: Failed to initialize OpenCascade: ${err}`);
        process.exit(EXIT_EXPORT);
        return;
      }

      // Evaluate
      const sourceDir = dirname(resolve(file));
      const trace = opts.trace ? new Trace() : undefined;
      const result: Value = evaluate(ast, oc, {
        importResolver: makeImportResolver(sourceDir),
        parseFn: parse,
        overrides,
        trace,
      });
      diagnostics.push(...warningDiagnostics());

      // Determine output path
      const inputBase = basename(file, extname(file));
      const outputFile = opts.o ?? `${inputBase}.stl`;
      const fmt = opts.format ?? (outputFile.endsWith('.step') || outputFile.endsWith('.stp') ? 'step' : 'stl');
      const outputPath = outputFile.endsWith(`.${fmt}`) ? outputFile : `${outputFile}.${fmt}`;

      const lines: string[] = [];
      const payload: Record<string, unknown> = { ok: true, phase: 'export', diagnostics };

      const shape = extractShape(result, oc);
      if (shape) {
        let info: any = null;
        try { info = shapeInfo(oc, shape); } catch { /* best-effort */ }
        if (info) payload.shape = info;
        if (opts.verbose) lines.push(...formatShapeInfo(info));
        await exportShape(oc, shape, outputPath, opts.meshDeflection);
        payload.artifacts = { [fmt]: outputPath };
        lines.push(`✓ ${basename(file)} → ${outputPath}`);
      } else {
        lines.push(`✓ ${basename(file)}: evaluated (no shape to export)`);
        payload.shape = null;
      }

      if (trace) {
        payload.trace = trace.toList();
        if (!opts.json) {
          lines.push('');
          lines.push(trace.render());
        }
      }

      const warned = diagnostics.filter((d) => d.severity === 'warning');
      if (!opts.json) {
        for (const w of warned) console.error(`Warning: ${w.message}`);
      }
      if (opts.strict && warned.length > 0) {
        payload.ok = false;
        emit(!!opts.json, payload, lines);
        console.error(`Error: ${warned.length} warning(s) with --strict`);
        process.exit(EXIT_SEMANTIC);
      }

      emit(!!opts.json, payload, lines);
      process.exit(EXIT_OK);
    } catch (e) {
      diagnostics.push(...warningDiagnostics());
      if (e instanceof ParseError) {
        console.error(`Parse error: ${(e as ParseError).message}`);
        emit(!!opts.json, { ok: false, phase: 'parse', diagnostics: [...diagnostics, { severity: 'error', message: String((e as ParseError).message) }] }, []);
        process.exit(EXIT_SYNTAX);
      }
      if (e instanceof EvalError || e instanceof Error) {
        // Kernel-level failures (an empty selector, a degenerate radius, an
        // OCCT refusal) arrive as plain Errors.
        console.error(`Evaluation error: ${(e as Error).message}`);
        emit(!!opts.json, { ok: false, phase: 'evaluate', diagnostics: [...diagnostics, { severity: 'error', message: String((e as Error).message) }] }, []);
        process.exit(EXIT_EXPORT);
      }
      throw e;
    }
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
    const source = readInput(file);
    const overrides = buildOverrides(opts.define ?? [], opts.paramsFile, (msg) => {
      console.error(msg);
      return process.exit(EXIT_IO) as never;
    });
    try {
      const ast = parse(source);
      const { initOC, shapeInfo } = await import('@polyscript/core/ocp-kernel');
      const oc: any = await initOC();
      const result: Value = evaluate(ast, oc, {
        importResolver: makeImportResolver(dirname(resolve(file))),
        parseFn: parse,
        overrides,
      });
      const diagnostics = warningDiagnostics();
      const shape = extractShape(result, oc);
      if (!shape) {
        emit(!!opts.json, { ok: true, phase: 'evaluate', diagnostics, shape: null },
          ['No geometry (library-only file)']);
        process.exit(EXIT_OK);
      }
      const info = shapeInfo(oc, shape);
      emit(!!opts.json, { ok: true, phase: 'evaluate', diagnostics, shape: info }, formatShapeInfo(info));
      process.exit(EXIT_OK);
    } catch (e) {
      if (e instanceof ParseError) {
        console.error(`Parse error: ${(e as ParseError).message}`);
        process.exit(EXIT_SYNTAX);
      }
      console.error(`Evaluation error: ${(e as Error).message}`);
      process.exit(EXIT_EXPORT);
    }
  });

program.parse();
