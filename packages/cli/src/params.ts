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
 * Override keys not seen in any top-level assignment — the -D flags that were
 * silently ignored, which is how a build comes out with the file's own
 * dimensions while the report claims the requested ones.
 *
 * Uses extractParams + a regex fallback. Returns the names; the caller decides
 * how to report them.
 */
export function unknownParams(
  source: string,
  overrides: Record<string, unknown>,
  extractParamsFn: (source: string) => { params: Array<{ name: string }> },
): string[] {
  if (Object.keys(overrides).length === 0) return [];
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
  return Object.keys(overrides).filter((name) => !known.has(name.replace(/^\$/, '')));
}

/** A -D / --params-file value that does not fit the declared parameter type. */
export interface ParamTypeError {
  name: string;
  message: string;
  hint: string;
}

/**
 * Check overrides against the declared (@param) types, and fix up string
 * parameters in place.
 *
 * parseCliValue guesses a type from the text alone, so `-D engrave=no` became
 * the string "no" -- truthy -- and a bool parameter meant as false was built
 * as true, silently; `-D name=007` became the number 7. With the declared
 * type known:
 *   - bool accepts exactly `true` / `false` (a JSON boolean from a file);
 *   - int / float accept numbers only;
 *   - string takes the -D text verbatim.
 * Undeclared names are left alone (unknownParams reports them).
 */
export function checkOverrideTypes(
  defines: string[],
  overrides: Record<string, unknown>,
  params: Array<{ name: string; type: 'int' | 'float' | 'string' | 'bool' }>,
): ParamTypeError[] {
  const raw = new Map<string, string>();
  for (const def of defines) {
    const eq = def.indexOf('=');
    if (eq > 0) raw.set(def.slice(0, eq).trim().replace(/^\$/, ''), def.slice(eq + 1));
  }
  const errors: ParamTypeError[] = [];
  for (const p of params) {
    const name = p.name.replace(/^\$/, '');
    if (!(name in overrides)) continue;
    const value = overrides[name];
    const shown = raw.get(name) ?? JSON.stringify(value);
    if (p.type === 'string') {
      if (raw.has(name)) overrides[name] = raw.get(name);
      else if (typeof value !== 'string') overrides[name] = String(value);
    } else if (p.type === 'bool') {
      if (typeof value !== 'boolean') {
        errors.push({ name, message: `${name} is a bool parameter; got ${shown}`, hint: `use ${name}=true or ${name}=false` });
      }
    } else if (typeof value !== 'number') {
      errors.push({ name, message: `${name} is a number parameter (${p.type}); got ${shown}`, hint: `give a number, e.g. ${name}=10` });
    }
  }
  return errors;
}

/**
 * Lines written `# @param ...` directly above an assignment. The `#` makes
 * the annotation a comment: the variable is not a declared parameter, so the
 * GUI shows no control for it and -D gets no type check -- silently. The
 * modeling skill itself used to teach this form.
 */
export function commentedParamLines(source: string): number[] {
  const lines = source.split('\n');
  const found: number[] = [];
  lines.forEach((line, i) => {
    if (!/^\s*#\s*@param\b/.test(line)) return;
    const next = lines.slice(i + 1).find(l => l.trim() !== '' && !/^\s*#\s*@param\b/.test(l));
    if (next !== undefined && /^\s*\$?[A-Za-z_][A-Za-z_0-9]*\s*=/.test(next)) found.push(i + 1);
  });
  return found;
}
