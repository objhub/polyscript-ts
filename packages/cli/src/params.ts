/**
 * CLI parameter helpers: -D key=value parsing and --params-file loading.
 */

import { readFileSync, existsSync } from 'node:fs';

/**
 * Parse a CLI string into a typed value.
 * Priority: bool > int > float > string.
 */
export function parseCliValue(s: string): unknown {
  const lower = s.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (s.trim() === '') return s;
  const num = Number(s);
  if (!Number.isNaN(num) && Number.isFinite(num)) return num;
  return s;
}

/**
 * Combine --params-file JSON and -D defines into a single overrides record.
 * CLI -D flags take precedence over the JSON file.
 *
 * Exits the process with non-zero code on malformed input.
 */
export function buildOverrides(
  defines: string[],
  paramsFile: string | undefined,
  onError: (msg: string) => never = (msg) => {
    console.error(msg);
    return process.exit(1) as never;
  },
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (paramsFile !== undefined) {
    if (!existsSync(paramsFile)) {
      onError(`Error: params file not found: ${paramsFile}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(paramsFile, 'utf-8'));
    } catch (e) {
      onError(`Error: failed to parse ${paramsFile}: ${(e as Error).message}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      onError(`Error: ${paramsFile} must contain a JSON object`);
    }
    Object.assign(overrides, data as Record<string, unknown>);
  }

  for (const def of defines) {
    const eq = def.indexOf('=');
    if (eq < 0) {
      onError(`Error: -D expects NAME=VALUE (got: ${JSON.stringify(def)})`);
    }
    const name = def.slice(0, eq).trim();
    const raw = def.slice(eq + 1);
    if (!name) {
      onError(`Error: -D expects NAME=VALUE (got: ${JSON.stringify(def)})`);
    }
    overrides[name] = parseCliValue(raw);
  }

  return overrides;
}

/**
 * Warn on override keys not seen in top-level assignments.
 * Uses extractParams + a regex fallback.
 */
export function warnUnknownParams(
  source: string,
  overrides: Record<string, unknown>,
  extractParamsFn: (source: string) => { params: Array<{ name: string }> },
): void {
  if (Object.keys(overrides).length === 0) return;
  const known = new Set<string>();
  try {
    const paramSet = extractParamsFn(source);
    for (const p of paramSet.params) known.add(p.name.replace(/^\$/, ''));
  } catch {
    // fall through
  }
  const re = /^\s*(\$?[A-Za-z_][A-Za-z_0-9]*)\s*=/gm;
  let m: RegExpExecArray | null = re.exec(source);
  while (m !== null) {
    known.add(m[1].replace(/^\$/, ''));
    m = re.exec(source);
  }
  for (const name of Object.keys(overrides)) {
    if (!known.has(name.replace(/^\$/, ''))) {
      console.error(`Warning: -D ${name}: no top-level assignment found in input`);
    }
  }
}
