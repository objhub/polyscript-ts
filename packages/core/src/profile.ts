/**
 * @profile annotation parsing and extraction API.
 *
 * Parses @profile blocks from PolyScript source code using a hand-written
 * recursive descent parser operating on the source string directly (no
 * integration with the main Lexer/Parser).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProfileEntry {
  /** Preset name (e.g. "S", "M", "L") */
  name: string;
  /** Variable name to value mapping */
  values: Record<string, any>;
}

export interface Profile {
  /** Entries in source-declaration order */
  entries: ProfileEntry[];
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'STRING' | 'NUMBER' | 'IDENT' | 'LBRACE' | 'RBRACE' | 'COLON' | 'COMMA';

interface ProfileToken {
  type: TokenType;
  value: string;
}

const TOKEN_RE = /\s+|\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[a-zA-Z_]\w*|[{}:,]/g;

function tokenize(text: string): ProfileToken[] {
  const tokens: ProfileToken[] = [];
  let lastIndex = 0;

  TOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    // Check for unexpected characters between matches
    if (match.index > lastIndex) {
      const gap = text.substring(lastIndex, match.index);
      if (gap.trim()) {
        throw new ProfileError(
          `Unexpected character at position ${lastIndex}: '${gap.trim()[0]}'`
        );
      }
    }
    lastIndex = match.index + match[0].length;

    const val = match[0];

    // Skip whitespace and comments
    if (/^[\s]/.test(val) || val.startsWith('//') || val.startsWith('#')) {
      continue;
    }

    if (val.startsWith('"')) {
      tokens.push({ type: 'STRING', value: val });
    } else if (/^-?\d/.test(val)) {
      tokens.push({ type: 'NUMBER', value: val });
    } else if (/^[a-zA-Z_]/.test(val)) {
      tokens.push({ type: 'IDENT', value: val });
    } else if (val === '{') {
      tokens.push({ type: 'LBRACE', value: val });
    } else if (val === '}') {
      tokens.push({ type: 'RBRACE', value: val });
    } else if (val === ':') {
      tokens.push({ type: 'COLON', value: val });
    } else if (val === ',') {
      tokens.push({ type: 'COMMA', value: val });
    } else {
      throw new ProfileError(`Unexpected token: '${val}'`);
    }
  }

  // Check for trailing unexpected characters
  if (lastIndex < text.length) {
    const rest = text.substring(lastIndex);
    if (rest.trim()) {
      throw new ProfileError(
        `Unexpected character at position ${lastIndex}: '${rest.trim()[0]}'`
      );
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function parseNumber(s: string): number {
  const n = Number(s);
  if (Number.isInteger(n)) return n;
  return n;
}

function unquote(s: string): string {
  const inner = s.slice(1, -1);
  return inner
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

// ---------------------------------------------------------------------------
// Recursive descent parser
// ---------------------------------------------------------------------------

class ProfileParser {
  private tokens: ProfileToken[];
  private pos = 0;

  constructor(tokens: ProfileToken[]) {
    this.tokens = tokens;
  }

  private peek(): ProfileToken | undefined {
    return this.tokens[this.pos];
  }

  private advance(): ProfileToken {
    if (this.pos >= this.tokens.length) {
      throw new ProfileError('Unexpected end of input');
    }
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): ProfileToken {
    const tok = this.advance();
    if (tok.type !== type) {
      throw new ProfileError(
        `Expected ${type}, got ${tok.type} ('${tok.value}')`
      );
    }
    return tok;
  }

  parseProfile(): Profile {
    this.expect('LBRACE');

    const entries: ProfileEntry[] = [];
    const seenNames = new Set<string>();

    // Check for empty body
    const peek = this.peek();
    if (peek && peek.type === 'RBRACE') {
      this.advance();
      throw new ProfileError('Empty @profile body (at least one entry required)');
    }

    // Parse first entry
    let entry = this.parseEntry();
    if (seenNames.has(entry.name)) {
      throw new ProfileError(`Duplicate preset name: '${entry.name}'`);
    }
    seenNames.add(entry.name);
    entries.push(entry);

    // Parse remaining entries
    while (true) {
      const p = this.peek();
      if (p === undefined) {
        throw new ProfileError("Unexpected end of input (missing closing '}')");
      }
      if (p.type === 'RBRACE') {
        this.advance();
        break;
      }
      if (p.type === 'COMMA') {
        this.advance();
        // Allow trailing comma before closing brace
        const next = this.peek();
        if (next && next.type === 'RBRACE') {
          this.advance();
          break;
        }
        entry = this.parseEntry();
        if (seenNames.has(entry.name)) {
          throw new ProfileError(`Duplicate preset name: '${entry.name}'`);
        }
        seenNames.add(entry.name);
        entries.push(entry);
      } else {
        throw new ProfileError(
          `Expected ',' or '}', got ${p.type} ('${p.value}')`
        );
      }
    }

    // Check for trailing tokens
    if (this.pos < this.tokens.length) {
      const tok = this.tokens[this.pos];
      throw new ProfileError(
        `Unexpected token after profile body: ${tok.type} ('${tok.value}')`
      );
    }

    return { entries };
  }

  private parseEntry(): ProfileEntry {
    const nameTok = this.expect('STRING');
    const name = unquote(nameTok.value);
    this.expect('COLON');
    const values = this.parseValues();
    return { name, values };
  }

  private parseValues(): Record<string, any> {
    this.expect('LBRACE');
    const values: Record<string, any> = {};

    const peek = this.peek();
    if (peek && peek.type === 'RBRACE') {
      this.advance();
      return values; // empty entry is allowed
    }

    // Parse first var assignment
    const [k, v] = this.parseVarAssignment();
    values[k] = v;

    // Parse remaining
    while (true) {
      const p = this.peek();
      if (p === undefined) {
        throw new ProfileError(
          "Unexpected end of input (missing closing '}' in entry)"
        );
      }
      if (p.type === 'RBRACE') {
        this.advance();
        break;
      }
      if (p.type === 'COMMA') {
        this.advance();
        // Allow trailing comma
        const next = this.peek();
        if (next && next.type === 'RBRACE') {
          this.advance();
          break;
        }
        const [k2, v2] = this.parseVarAssignment();
        values[k2] = v2;
      } else {
        throw new ProfileError(
          `Expected ',' or '}', got ${p.type} ('${p.value}')`
        );
      }
    }

    return values;
  }

  private parseVarAssignment(): [string, any] {
    const identTok = this.expect('IDENT');
    const ident = identTok.value;

    // Reject null as identifier
    if (ident === 'null') {
      throw new ProfileError('null is not allowed as an identifier in @profile');
    }

    this.expect('COLON');
    const value = this.parseValue();
    return [ident, value];
  }

  private parseValue(): any {
    const tok = this.advance();

    if (tok.type === 'NUMBER') {
      return parseNumber(tok.value);
    }
    if (tok.type === 'STRING') {
      return unquote(tok.value);
    }
    if (tok.type === 'IDENT') {
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'null') {
        throw new ProfileError('null value is not allowed in @profile');
      }
      throw new ProfileError(`Unexpected identifier as value: '${tok.value}'`);
    }

    throw new ProfileError(`Expected value, got ${tok.type} ('${tok.value}')`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the body of a @profile annotation (the `{...}` part).
 *
 * @param text - The `{...}` text including outer braces.
 * @returns Parsed Profile object.
 * @throws ProfileError on syntax or semantic errors.
 */
export function parseProfileBlock(text: string): Profile {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    throw new ProfileError('Empty @profile body');
  }
  const parser = new ProfileParser(tokens);
  return parser.parseProfile();
}

// ---------------------------------------------------------------------------
// Source-level extraction
// ---------------------------------------------------------------------------

const PROFILE_START_RE = /@profile\s*\{/g;

/**
 * Extract a brace-balanced block starting at `start` (which points to '{').
 * Returns the substring including the outer braces.
 */
function findBraceBlock(source: string, start: number): string {
  let depth = 0;
  let i = start;
  let inString = false;

  while (i < source.length) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return source.substring(start, i + 1);
        }
      }
    }
    i++;
  }

  throw new ProfileError('Unbalanced braces in @profile body');
}

/**
 * Extract a `@profile` annotation from PolyScript source.
 *
 * @param source - Full PolyScript source text.
 * @returns Parsed Profile, or undefined if no `@profile` is present.
 * @throws ProfileError if multiple `@profile` annotations are found,
 *   or if the body has syntax/semantic errors.
 */
export function extractProfile(source: string): Profile | undefined {
  PROFILE_START_RE.lastIndex = 0;
  const matches = [...source.matchAll(PROFILE_START_RE)];

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length > 1) {
    throw new ProfileError(
      'Multiple @profile annotations found (only one allowed per file)'
    );
  }

  const match = matches[0];
  // The '{' is the last character of the match
  const braceStart = match.index + match[0].length - 1;
  const block = findBraceBlock(source, braceStart);

  return parseProfileBlock(block);
}

/**
 * Strip the @profile block from source, replacing it with empty lines
 * to preserve line numbers for the downstream parser.
 *
 * @param source - Full PolyScript source text.
 * @returns Source with @profile block replaced by empty lines.
 */
export function stripProfileBlock(source: string): string {
  PROFILE_START_RE.lastIndex = 0;
  const match = PROFILE_START_RE.exec(source);
  if (!match) return source;

  const braceStart = match.index + match[0].length - 1;
  const block = findBraceBlock(source, braceStart);
  const blockEnd = braceStart + block.length;

  // Count newlines in the region to replace
  const region = source.substring(match.index, blockEnd);
  const newlineCount = (region.match(/\n/g) || []).length;

  // Replace with empty lines to preserve line numbering
  const replacement = '\n'.repeat(newlineCount);
  return source.substring(0, match.index) + replacement + source.substring(blockEnd);
}
