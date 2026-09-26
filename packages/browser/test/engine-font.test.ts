/**
 * The browser has no system fonts, and nothing ever gave the engine one, so
 * every `text` in live / objhub came out as a rectangle the size of the text
 * -- silently. The engine now takes a font (the worker passes the bundled
 * Noto Sans JP) and loads it before the first build that draws text.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resetFontCache } from '@polyscript/core/ocp-kernel';
import { PolyScriptEngine, usesText } from '../src/index.js';

const FONT = new URL('../fonts/NotoSansJP-Regular.ttf', import.meta.url);

afterAll(() => resetFontCache());

describe('usesText', () => {
  it('spots `text` as a word only', () => {
    expect(usesText('box 10 10 10 | faces ">Z" | text "A" 5 | cut 1')).toBe(true);
    expect(usesText('context = 3\nbox context 1 1')).toBe(false);
  });
});

describe('engine font', () => {
  it('a source without text loads nothing', async () => {
    const engine = await PolyScriptEngine.init({ font: 'http://invalid.example/none.ttf' });
    await expect(engine.ensureFont('box 1 1 1')).resolves.toBeUndefined();
  }, 120_000);

  it('the bundled Noto Sans JP draws Japanese glyphs', async () => {
    const bytes = readFileSync(FONT);
    const engine = await PolyScriptEngine.init({
      font: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    const src = 'text "名入れ" 10 | extrude 1';
    await engine.ensureFont(src);
    const r = engine.build(src);
    expect(r.success).toBe(true);
    // Glyphs, not the 18 x 10 slab (12 triangles) the fallback used to draw.
    expect(engine.tessellate(r.shape as never).indices.length / 3).toBeGreaterThan(200);
  }, 120_000);

  it('a font that cannot be fetched is a build error, not a rectangle', async () => {
    resetFontCache();
    const engine = await PolyScriptEngine.init({ font: 'http://127.0.0.1:9/missing.ttf' });
    await expect(engine.ensureFont('text "A" 5')).rejects.toThrow(/could not load the font/);
  }, 120_000);
});
