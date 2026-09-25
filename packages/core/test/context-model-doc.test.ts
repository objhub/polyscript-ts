/**
 * The polyscript-modeling skill's context model is generated from the
 * validator (tests/gen_context_model.ts). Its hand-copied predecessor drifted
 * -- no `rotate` / `mirror` for Face / Wire -- and taught an AI to stand a
 * path up with `rotate 90 0 0`. This fails when the tables are stale.
 *
 * The skill lives outside this repository (../.claude/skills), so the test
 * is skipped where it is absent, as in CI.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { renderContextModel, currentBlock, DEFAULT_FILE } from '../../../tests/gen_context_model.ts';

describe('skill context model', () => {
  it('lists rotate and mirror for Face and Wire', () => {
    const doc = renderContextModel();
    for (const ctx of ['Face', 'Wire']) {
      const line = doc.split(`**${ctx}**`)[1].split('\n\n')[1];
      expect(line).toContain('`rotate`');
      expect(line).toContain('`mirror`');
    }
  });

  it.skipIf(!existsSync(DEFAULT_FILE))('the skill file matches the validator', () => {
    expect(currentBlock(readFileSync(DEFAULT_FILE, 'utf8')), 'run: bun tests/gen_context_model.ts')
      .toBe(renderContextModel());
  });
});
