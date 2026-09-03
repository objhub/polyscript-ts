/**
 * PolyScript parameter extraction API.
 *
 * Parses @param annotations from source code and merges with JSON metadata.
 */

import { parse } from './parser.js';
import type { Profile } from './profile.js';
import { extractProfile } from './profile.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParamInfo {
  name: string;
  type: 'int' | 'float' | 'string' | 'bool';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  desc?: string;
  choices?: any[];
  group: string;
  hidden: boolean;
}

export interface ParamSet {
  params: ParamInfo[];
  parameterSets: Record<string, Record<string, any>>;
  profile?: Profile;
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

/**
 * Infer param type from the default value and annotation options.
 */
function inferType(defaultValue: any, annotation: Record<string, any>): 'int' | 'float' | 'string' | 'bool' {
  // Explicit type in annotation takes priority
  if (annotation.type) {
    const t = annotation.type;
    if (t === 'int' || t === 'float' || t === 'string' || t === 'bool') return t;
  }

  if (typeof defaultValue === 'boolean') return 'bool';
  if (typeof defaultValue === 'string') return 'string';
  if (typeof defaultValue === 'number') {
    // If it has a fractional part, it's float; otherwise check step
    if (!Number.isInteger(defaultValue)) return 'float';
    if (annotation.step !== undefined && !Number.isInteger(annotation.step)) return 'float';
    return 'int';
  }
  return 'float';
}

/**
 * Evaluate a simple expression to extract default value.
 * Only handles simple literals (number, string, boolean, negation).
 */
function evalDefaultValue(expr: any): any {
  if (!expr) return undefined;
  switch (expr.type) {
    case 'NumberLit': return expr.value;
    case 'StringLit': return expr.value;
    case 'BoolConst': return expr.value;
    case 'UnaryNeg':
      if (expr.operand?.type === 'NumberLit') return -expr.operand.value;
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract parameter information from PolyScript source code.
 *
 * @param source - PolyScript source code
 * @param jsonStr - Optional JSON string with additional metadata / parameter sets
 * @returns ParamSet with params and parameterSets
 */
export function extractParams(source: string, jsonStr?: string): ParamSet {
  const program = parse(source);
  const params: ParamInfo[] = [];

  // Collect annotated assignments
  for (const stmt of program.statements) {
    if (stmt.type === 'Assignment' && stmt.annotation) {
      const annotation = stmt.annotation.options;
      const defaultValue = evalDefaultValue(stmt.value);
      const paramType = inferType(defaultValue, annotation);

      const info: ParamInfo = {
        name: stmt.name,
        type: paramType,
        default: defaultValue,
        group: (annotation.group as string) ?? 'General',
        hidden: (annotation.hidden as boolean) ?? false,
      };

      if (annotation.min !== undefined) info.min = annotation.min;
      if (annotation.max !== undefined) info.max = annotation.max;
      if (annotation.step !== undefined) info.step = annotation.step;
      if (annotation.label !== undefined) info.label = annotation.label;
      if (annotation.desc !== undefined) info.desc = annotation.desc;
      if (annotation.choices !== undefined) info.choices = annotation.choices;

      params.push(info);
    }
  }

  // Extract @profile annotation from source
  const profile = extractProfile(source);

  // Merge with JSON if provided
  let parameterSets: Record<string, Record<string, any>> = {};

  if (jsonStr) {
    const json = JSON.parse(jsonStr);

    // Extract parameter sets (deprecated -- use @profile instead)
    if (json.parameterSets && typeof json.parameterSets === 'object' && Object.keys(json.parameterSets).length > 0) {
      console.warn('JSON parameterSets is deprecated, use @profile annotation instead');
      parameterSets = json.parameterSets;
    }

    // Merge JSON metadata into params (JSON overrides source for metadata)
    if (json.params) {
      const jsonParams: Record<string, any> = {};
      if (Array.isArray(json.params)) {
        for (const p of json.params) {
          if (p.name) jsonParams[p.name] = p;
        }
      } else {
        Object.assign(jsonParams, json.params);
      }

      for (const param of params) {
        const jp = jsonParams[param.name];
        if (!jp) continue;

        // JSON metadata overrides source metadata
        if (jp.min !== undefined) param.min = jp.min;
        if (jp.max !== undefined) param.max = jp.max;
        if (jp.step !== undefined) param.step = jp.step;
        if (jp.label !== undefined) param.label = jp.label;
        if (jp.desc !== undefined) param.desc = jp.desc;
        if (jp.choices !== undefined) param.choices = jp.choices;
        if (jp.group !== undefined) param.group = jp.group;
        if (jp.hidden !== undefined) param.hidden = jp.hidden;
        if (jp.type !== undefined) param.type = jp.type;

        // JSON default overrides source default
        if (jp.default !== undefined) param.default = jp.default;
      }
    }
  }

  // Apply parameterSets defaults (highest priority for default values)
  // If there's a "default" parameter set, use it
  if (parameterSets.default) {
    for (const param of params) {
      if (param.name in parameterSets.default) {
        param.default = parameterSets.default[param.name];
      }
    }
  }

  const result: ParamSet = { params, parameterSets };
  if (profile) {
    result.profile = profile;
  }
  return result;
}
