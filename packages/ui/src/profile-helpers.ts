/**
 * Helpers for @profile preset matching in the UI.
 */

import type { Profile } from '@polyscript/core';

// Re-export core types for convenience
export type { Profile, ProfileEntry } from '@polyscript/core';

/**
 * Custom sentinel value displayed in the dropdown when no preset matches.
 */
export const CUSTOM_PRESET = '__custom__';

/**
 * Find a profile entry whose values match the current variable values.
 *
 * Only keys declared in each entry's `values` are compared.
 * Returns the matching entry name, or undefined if none matches.
 */
export function findMatchingPreset(
  profile: Profile,
  currentValues: Record<string, any>,
): string | undefined {
  for (const entry of profile.entries) {
    const keys = Object.keys(entry.values);
    // An empty-values entry matches if and only if currentValues has no
    // overrides for any profile-relevant key.  But per spec, empty entry
    // means "use source defaults" -- treat as always-matching-if-no-override.
    // We still check all keys for value equality.
    const allMatch = keys.every((k) => {
      const expected = entry.values[k];
      const actual = currentValues[k];
      // Loose equality handles int/float coercion (e.g. 10 === 10.0)
      // but for strings/booleans we need strict equality.
      if (typeof expected === 'number' && typeof actual === 'number') {
        return expected === actual;
      }
      return expected === actual;
    });
    if (allMatch) return entry.name;
  }
  return undefined;
}
