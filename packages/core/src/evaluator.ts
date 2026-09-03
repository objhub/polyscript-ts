/**
 * Barrel re-export — delegates to eval/ directory modules.
 *
 * This file exists so that existing imports like:
 *   import { ... } from './evaluator.js'
 * continue to resolve correctly under Node16 ESM module resolution,
 * which does not auto-resolve directory index files from .js imports.
 */
export * from './eval/index.js';
