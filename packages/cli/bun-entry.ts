// Entry point for `bun build --compile`. Bun-only: the import attribute below
// is not valid in Node or Deno, so this file must never be imported by shared
// code -- those runtimes keep using dist/index.js directly.
//
// `deno compile` embeds every file of an npm package into its virtual FS, so
// the Emscripten loader's import.meta.url-relative read just works. Bun's
// bundler only embeds what it can see statically, so the 22 MB kernel has to
// be named here. Handing initOC the path rather than an initialised kernel
// keeps startup lazy: eager init costs ~0.26s on every `poly --version`.
import wasmPath from 'occt-wasm/dist/occt-wasm.wasm' with { type: 'file' };

(globalThis as Record<string, unknown>).__POLY_OCCT_WASM__ = wasmPath;

await import('./dist/index.js');
