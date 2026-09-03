import { describe, it, expect, vi } from 'vitest';
import {
  ProfileError,
  parseProfileBlock,
  extractProfile,
} from '../src/profile.js';
import { extractParams } from '../src/params.js';

// ---------------------------------------------------------------------------
// parseProfileBlock: basic cases
// ---------------------------------------------------------------------------

describe('parseProfileBlock -- basic', () => {
  it('parses multiple variables (S/M/L with width, height, depth)', () => {
    const text = `{
      "S": { width: 10, height: 10, depth: 10 },
      "M": { width: 20, height: 20, depth: 20 },
      "L": { width: 30, height: 30, depth: 30 }
    }`;
    const profile = parseProfileBlock(text);
    expect(profile.entries).toHaveLength(3);
    expect(profile.entries[0].name).toBe('S');
    expect(profile.entries[0].values).toEqual({ width: 10, height: 10, depth: 10 });
    expect(profile.entries[1].name).toBe('M');
    expect(profile.entries[1].values).toEqual({ width: 20, height: 20, depth: 20 });
    expect(profile.entries[2].name).toBe('L');
    expect(profile.entries[2].values).toEqual({ width: 30, height: 30, depth: 30 });
  });

  it('parses simple single variable (size)', () => {
    const text = `{
      "S": { size: 10 },
      "M": { size: 20 },
      "L": { size: 30 }
    }`;
    const profile = parseProfileBlock(text);
    expect(profile.entries).toHaveLength(3);
    expect(profile.entries[0].values).toEqual({ size: 10 });
    expect(profile.entries[1].values).toEqual({ size: 20 });
    expect(profile.entries[2].values).toEqual({ size: 30 });
  });
});

// ---------------------------------------------------------------------------
// parseProfileBlock: empty entry
// ---------------------------------------------------------------------------

describe('parseProfileBlock -- empty entry', () => {
  it('allows empty entry "Default": {}', () => {
    const text = `{
      "Default": {},
      "Small":   { width: 30, height: 20 },
      "Large":   { width: 150, height: 80 }
    }`;
    const profile = parseProfileBlock(text);
    expect(profile.entries).toHaveLength(3);
    expect(profile.entries[0].name).toBe('Default');
    expect(profile.entries[0].values).toEqual({});
    expect(profile.entries[1].name).toBe('Small');
    expect(profile.entries[1].values).toEqual({ width: 30, height: 20 });
  });
});

// ---------------------------------------------------------------------------
// parseProfileBlock: value types
// ---------------------------------------------------------------------------

describe('parseProfileBlock -- value types', () => {
  it('parses mixed types (number, string, boolean)', () => {
    const text = `{
      "Config1": { count: 5, label: "hello", enabled: true },
      "Config2": { count: 10, label: "world", enabled: false }
    }`;
    const profile = parseProfileBlock(text);
    const e0 = profile.entries[0];
    expect(e0.values.count).toBe(5);
    expect(e0.values.label).toBe('hello');
    expect(e0.values.enabled).toBe(true);
    const e1 = profile.entries[1];
    expect(e1.values.count).toBe(10);
    expect(e1.values.label).toBe('world');
    expect(e1.values.enabled).toBe(false);
  });

  it('parses float values', () => {
    const text = '{ "A": { radius: 3.14, height: 2.0 } }';
    const profile = parseProfileBlock(text);
    expect(profile.entries[0].values.radius).toBeCloseTo(3.14);
    expect(profile.entries[0].values.height).toBeCloseTo(2.0);
  });

  it('parses negative number', () => {
    const text = '{ "A": { offset: -5 } }';
    const profile = parseProfileBlock(text);
    expect(profile.entries[0].values.offset).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// parseProfileBlock: source order
// ---------------------------------------------------------------------------

describe('parseProfileBlock -- source order', () => {
  it('preserves source order of entries', () => {
    const text = `{
      "First": { a: 1 },
      "Second": { a: 2 },
      "Third": { a: 3 },
      "Fourth": { a: 4 }
    }`;
    const profile = parseProfileBlock(text);
    const names = profile.entries.map(e => e.name);
    expect(names).toEqual(['First', 'Second', 'Third', 'Fourth']);
  });
});

// ---------------------------------------------------------------------------
// parseProfileBlock: trailing commas
// ---------------------------------------------------------------------------

describe('parseProfileBlock -- trailing commas', () => {
  it('allows trailing comma in outer object', () => {
    const text = `{
      "S": { width: 10 },
      "M": { width: 20 },
    }`;
    const profile = parseProfileBlock(text);
    expect(profile.entries).toHaveLength(2);
  });

  it('allows trailing comma in inner object', () => {
    const text = '{ "S": { width: 10, height: 20, } }';
    const profile = parseProfileBlock(text);
    expect(profile.entries[0].values).toEqual({ width: 10, height: 20 });
  });
});

// ---------------------------------------------------------------------------
// parseProfileBlock: error cases
// ---------------------------------------------------------------------------

describe('parseProfileBlock -- errors', () => {
  it('rejects empty body @profile {}', () => {
    expect(() => parseProfileBlock('{}')).toThrow(ProfileError);
    expect(() => parseProfileBlock('{}')).toThrow(/[Ee]mpty/);
  });

  it('rejects duplicate preset name', () => {
    const text = `{
      "S": { width: 10 },
      "S": { width: 20 }
    }`;
    expect(() => parseProfileBlock(text)).toThrow(ProfileError);
    expect(() => parseProfileBlock(text)).toThrow(/[Dd]uplicate/);
  });

  it('rejects syntax error: missing closing brace', () => {
    const text = '{ "S": { width: 10 }';
    expect(() => parseProfileBlock(text)).toThrow(ProfileError);
  });

  it('rejects syntax error: missing colon', () => {
    const text = '{ "S" { width: 10 } }';
    expect(() => parseProfileBlock(text)).toThrow(ProfileError);
  });

  it('rejects null value', () => {
    const text = '{ "S": { width: null } }';
    expect(() => parseProfileBlock(text)).toThrow(ProfileError);
    expect(() => parseProfileBlock(text)).toThrow(/null/);
  });

  it('rejects null as identifier', () => {
    const text = '{ "S": { null: 10 } }';
    expect(() => parseProfileBlock(text)).toThrow(ProfileError);
    expect(() => parseProfileBlock(text)).toThrow(/null/);
  });
});

// ---------------------------------------------------------------------------
// extractProfile: source-level extraction
// ---------------------------------------------------------------------------

describe('extractProfile', () => {
  it('returns undefined when no @profile is present', () => {
    const source = 'width = 10\nbox width 20 30';
    expect(extractProfile(source)).toBeUndefined();
  });

  it('rejects multiple @profile annotations', () => {
    const source = `\
@profile {
  "S": { size: 10 }
}

@profile {
  "M": { size: 20 }
}
`;
    expect(() => extractProfile(source)).toThrow(ProfileError);
    expect(() => extractProfile(source)).toThrow(/[Mm]ultiple/);
  });

  it('parses SPEC.md basic example (S/M/L with width/height/depth)', () => {
    const source = `\
@profile {
  "S": { width: 10, height: 10, depth: 10 },
  "M": { width: 20, height: 20, depth: 20 },
  "L": { width: 30, height: 30, depth: 30 }
}

width  = 10
height = 10
depth  = 10

box width height depth
`;
    const profile = extractProfile(source);
    expect(profile).toBeDefined();
    expect(profile!.entries).toHaveLength(3);
    expect(profile!.entries[0].name).toBe('S');
    expect(profile!.entries[0].values.width).toBe(10);
    expect(profile!.entries[2].name).toBe('L');
    expect(profile!.entries[2].values.depth).toBe(30);
  });

  it('parses SPEC.md simple example (1 variable)', () => {
    const source = `\
@profile {
  "S": { size: 10 },
  "M": { size: 20 },
  "L": { size: 30 }
}

size = 20

sphere size
`;
    const profile = extractProfile(source);
    expect(profile).toBeDefined();
    expect(profile!.entries).toHaveLength(3);
    expect(profile!.entries[1].name).toBe('M');
    expect(profile!.entries[1].values.size).toBe(20);
  });

  it('parses SPEC.md @param coexistence example', () => {
    const source = `\
@profile {
  "S": { width: 30, height: 20, depth: 15 },
  "M": { width: 60, height: 40, depth: 30 },
  "L": { width: 120, height: 80, depth: 60 }
}

@param 10..200 step:5 desc:"Box width" group:"Dimensions"
width = 60

@param 10..150 desc:"Box height" group:"Dimensions"
height = 40

@param 10..100 desc:"Box depth" group:"Dimensions"
depth = 30

@param choices:["PLA", "ABS", "PETG"] desc:"Material"
material = "PLA"

box width height depth
`;
    const profile = extractProfile(source);
    expect(profile).toBeDefined();
    expect(profile!.entries).toHaveLength(3);
    expect(profile!.entries[0].name).toBe('S');
    expect(profile!.entries[0].values).toEqual({
      width: 30, height: 20, depth: 15,
    });
    expect(profile!.entries[2].name).toBe('L');
    expect(profile!.entries[2].values).toEqual({
      width: 120, height: 80, depth: 60,
    });
  });
});

// ---------------------------------------------------------------------------
// extractParams integration
// ---------------------------------------------------------------------------

describe('extractParams -- @profile integration', () => {
  it('populates ParamSet.profile', () => {
    const source = `\
@profile {
  "S": { width: 10, height: 10 },
  "M": { width: 20, height: 20 }
}

@param 1..100
width = 10

@param 1..100
height = 10
`;
    const result = extractParams(source);
    expect(result.profile).toBeDefined();
    expect(result.profile!.entries).toHaveLength(2);
    expect(result.profile!.entries[0].name).toBe('S');
    // @param still works alongside @profile
    expect(result.params).toHaveLength(2);
    expect(result.params[0].name).toBe('width');
  });

  it('ParamSet.profile is undefined when no @profile', () => {
    const source = '@param 1..100\nwidth = 10';
    const result = extractParams(source);
    expect(result.profile).toBeUndefined();
  });

  it('warns on JSON parameterSets (deprecated)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = '@param 1..100\nval = 10';
      const jsonData = JSON.stringify({
        parameterSets: {
          small: { val: 5 },
          large: { val: 95 },
        },
      });
      const result = extractParams(source, jsonData);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'JSON parameterSets is deprecated, use @profile annotation instead'
      );
      // parameterSets should still be populated (backward compat)
      expect(result.parameterSets).toHaveProperty('small');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn on empty JSON parameterSets', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = '@param 1..100\nval = 10';
      const jsonData = JSON.stringify({ parameterSets: {} });
      extractParams(source, jsonData);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
