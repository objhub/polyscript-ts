/**
 * Guards that @polyscript/core stays bundleable for the browser.
 *
 * core is consumed by `live` and `objhub/www` through a `link:` dependency, and
 * both bundle it for the browser. Neither is covered by `make build`/`test`/
 * `lint` here, so a change that only breaks them lands silently.
 *
 * Regression: text-render.ts opened with
 * `import { createRequire } from 'node:module'`. Every call site was wrapped in
 * try/catch, but a static import is resolved by the bundler at build time, so no
 * runtime guard can save it — rollup failed with "createRequire is not exported
 * by __vite-browser-external" and both apps were unbuildable for four months
 * before anyone noticed.
 *
 * Node built-ins are still fine to use; they just have to be reached in a way
 * that survives bundling:
 *   - `await import('node:fs')`      — dynamic, resolved at runtime (export.ts)
 *   - `process.getBuiltinModule(..)` — runtime lookup   (text-render.ts)
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;

/** Static `import ... from 'node:x' | 'fs' | 'path' | 'module'`, but not `await import(...)`. */
const STATIC_NODE_IMPORT =
  /^\s*import\s(?![^;]*\bfrom\s*['"]\.)[^;]*?from\s*['"](?:node:\w+|fs|path|module|os|crypto)['"]/gm;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('browser bundling', () => {
  it('no source file statically imports a Node built-in', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const matches = readFileSync(file, 'utf8').match(STATIC_NODE_IMPORT);
      if (matches) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${matches.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('text-render reaches fs and path through process.getBuiltinModule', () => {
    // The runtime lookup is what keeps the Node system-font search working
    // while leaving the browser build resolvable.
    const source = readFileSync(join(SRC, 'ocp-kernel/text-render.ts'), 'utf8');
    expect(source).toContain('getBuiltinModule');
  });
});
