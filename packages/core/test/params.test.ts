import { describe, it, expect } from 'vitest';
import { Lexer, TokenType } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { evaluateExpressions } from '../src/evaluator.js';
import { extractParams } from '../src/params.js';
import type { Assignment, } from '../src/ast.js';

// ---------------------------------------------------------------------------
// Lexer tests for @param and ..
// ---------------------------------------------------------------------------

describe('lexer -- @param token', () => {
  it('tokenizes @param as AtParam', () => {
    const tokens = new Lexer('@param').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.AtParam, value: '@param' });
  });

  it('tokenizes @param followed by options', () => {
    const tokens = new Lexer('@param min:1 max:100').tokenize();
    expect(tokens[0].type).toBe(TokenType.AtParam);
    expect(tokens[1]).toMatchObject({ type: TokenType.Identifier, value: 'min' });
    expect(tokens[2].type).toBe(TokenType.Colon);
    expect(tokens[3]).toMatchObject({ type: TokenType.Number, value: '1' });
  });

  it('does not tokenize @parameter as AtParam', () => {
    // @parameter is not @param -- the lexer should reject @
    expect(() => new Lexer('@parameter').tokenize()).toThrow(/Unexpected character '@'/);
  });
});

describe('lexer -- DotDot token', () => {
  it('tokenizes .. as DotDot', () => {
    const tokens = new Lexer('1..100').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '1' });
    expect(tokens[1]).toMatchObject({ type: TokenType.DotDot, value: '..' });
    expect(tokens[2]).toMatchObject({ type: TokenType.Number, value: '100' });
  });

  it('tokenizes triple range 1..100..0.5', () => {
    const tokens = new Lexer('1..100..0.5').tokenize();
    const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
    expect(types).toEqual([
      TokenType.Number, TokenType.DotDot, TokenType.Number,
      TokenType.DotDot, TokenType.Number,
    ]);
    expect(tokens[4]).toMatchObject({ type: TokenType.Number, value: '0.5' });
  });

  it('tokenizes negative range -10..10', () => {
    const tokens = new Lexer('-10..10').tokenize();
    expect(tokens[0].type).toBe(TokenType.Minus);
    expect(tokens[1]).toMatchObject({ type: TokenType.Number, value: '10' });
    expect(tokens[2]).toMatchObject({ type: TokenType.DotDot, value: '..' });
    expect(tokens[3]).toMatchObject({ type: TokenType.Number, value: '10' });
  });
});

// ---------------------------------------------------------------------------
// Parser tests for @param annotation
// ---------------------------------------------------------------------------

describe('parser -- @param annotation', () => {
  it('parses basic key:value annotation', () => {
    const program = parse('@param min:1 max:100 step:0.5 desc:"Wall thickness"\n$thickness = 2.0');
    expect(program.statements).toHaveLength(1);
    const stmt = program.statements[0] as Assignment;
    expect(stmt.type).toBe('Assignment');
    expect(stmt.name).toBe('thickness');
    expect(stmt.annotation).toBeDefined();
    const ann = stmt.annotation!;
    expect(ann.type).toBe('ParamAnnotation');
    expect(ann.options.min).toBe(1);
    expect(ann.options.max).toBe(100);
    expect(ann.options.step).toBe(0.5);
    expect(ann.options.desc).toBe('Wall thickness');
  });

  it('parses range shorthand', () => {
    const program = parse('@param 1..100\n$thickness = 2.0');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.min).toBe(1);
    expect(stmt.annotation!.options.max).toBe(100);
  });

  it('parses range shorthand with step', () => {
    const program = parse('@param 1..100..0.5\n$thickness = 2.0');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.min).toBe(1);
    expect(stmt.annotation!.options.max).toBe(100);
    expect(stmt.annotation!.options.step).toBe(0.5);
  });

  it('parses negative range', () => {
    const program = parse('@param -10..10..1\n$offset = 0');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.min).toBe(-10);
    expect(stmt.annotation!.options.max).toBe(10);
    expect(stmt.annotation!.options.step).toBe(1);
  });

  it('parses range shorthand mixed with options', () => {
    const program = parse('@param 1..100 desc:"Height" group:"Dimensions"\n$height = 50');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.min).toBe(1);
    expect(stmt.annotation!.options.max).toBe(100);
    expect(stmt.annotation!.options.desc).toBe('Height');
    expect(stmt.annotation!.options.group).toBe('Dimensions');
  });

  it('parses choices option', () => {
    const program = parse('@param choices:["M3","M4","M5"]\n$screw = "M3"');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.choices).toEqual(['M3', 'M4', 'M5']);
  });

  it('parses hidden option', () => {
    const program = parse('@param hidden:true\n$internal = 42');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.hidden).toBe(true);
  });

  it('parses type option', () => {
    const program = parse('@param type:"int"\n$count = 10');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation!.options.type).toBe('int');
  });

  it('throws if @param not followed by assignment', () => {
    expect(() => parse('@param min:1\nbox 10 10 10')).toThrow(/@param annotation must be followed/);
  });

  it('assignment without @param has no annotation', () => {
    const program = parse('$x = 42');
    const stmt = program.statements[0] as Assignment;
    expect(stmt.annotation).toBeUndefined();
  });

  it('multiple @param annotations', () => {
    const source = `@param 0..100\n$width = 50\n@param 0..200\n$height = 100`;
    const program = parse(source);
    expect(program.statements).toHaveLength(2);
    const s1 = program.statements[0] as Assignment;
    const s2 = program.statements[1] as Assignment;
    expect(s1.name).toBe('width');
    expect(s1.annotation!.options.min).toBe(0);
    expect(s1.annotation!.options.max).toBe(100);
    expect(s2.name).toBe('height');
    expect(s2.annotation!.options.min).toBe(0);
    expect(s2.annotation!.options.max).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// extractParams tests
// ---------------------------------------------------------------------------

describe('extractParams', () => {
  it('extracts basic params from source', () => {
    const source = `@param min:1 max:100 step:0.5 desc:"Wall thickness"\n$thickness = 2.0`;
    const result = extractParams(source);
    expect(result.params).toHaveLength(1);
    const p = result.params[0];
    expect(p.name).toBe('thickness');
    expect(p.type).toBe('float');
    expect(p.default).toBe(2.0);
    expect(p.min).toBe(1);
    expect(p.max).toBe(100);
    expect(p.step).toBe(0.5);
    expect(p.desc).toBe('Wall thickness');
    expect(p.group).toBe('General');
    expect(p.hidden).toBe(false);
  });

  it('extracts params with range shorthand', () => {
    const source = `@param 1..100..0.5\n$thickness = 2.0`;
    const result = extractParams(source);
    const p = result.params[0];
    expect(p.min).toBe(1);
    expect(p.max).toBe(100);
    expect(p.step).toBe(0.5);
  });

  it('infers int type', () => {
    const source = `@param 0..100\n$count = 10`;
    const result = extractParams(source);
    expect(result.params[0].type).toBe('int');
  });

  it('infers float type from decimal default', () => {
    const source = `@param 0..100\n$size = 10.5`;
    const result = extractParams(source);
    expect(result.params[0].type).toBe('float');
  });

  it('infers float type from step', () => {
    const source = `@param 0..100..0.1\n$count = 10`;
    const result = extractParams(source);
    expect(result.params[0].type).toBe('float');
  });

  it('infers string type', () => {
    const source = `@param choices:["M3","M4"]\n$screw = "M3"`;
    const result = extractParams(source);
    expect(result.params[0].type).toBe('string');
  });

  it('infers bool type', () => {
    const source = `@param desc:"Enable feature"\n$flag = true`;
    const result = extractParams(source);
    expect(result.params[0].type).toBe('bool');
  });

  it('respects explicit type option', () => {
    const source = `@param type:"float"\n$count = 10`;
    const result = extractParams(source);
    expect(result.params[0].type).toBe('float');
  });

  it('extracts group option', () => {
    const source = `@param group:"Dimensions"\n$width = 50`;
    const result = extractParams(source);
    expect(result.params[0].group).toBe('Dimensions');
  });

  it('extracts multiple params', () => {
    const source = [
      '@param 0..100 desc:"Width"',
      '$width = 50',
      '@param 0..200 desc:"Height"',
      '$height = 100',
    ].join('\n');
    const result = extractParams(source);
    expect(result.params).toHaveLength(2);
    expect(result.params[0].name).toBe('width');
    expect(result.params[1].name).toBe('height');
  });

  it('ignores assignments without @param', () => {
    const source = `$x = 42\n@param 0..100\n$width = 50\n$y = 10`;
    const result = extractParams(source);
    expect(result.params).toHaveLength(1);
    expect(result.params[0].name).toBe('width');
  });

  it('handles negative default', () => {
    const source = `@param -100..100\n$offset = -5`;
    const result = extractParams(source);
    expect(result.params[0].default).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// JSON merge tests
// ---------------------------------------------------------------------------

describe('extractParams -- JSON merge', () => {
  it('merges JSON metadata (overrides source)', () => {
    const source = `@param min:1 max:100 desc:"Thickness"\n$thickness = 2.0`;
    const json = JSON.stringify({
      params: [
        { name: 'thickness', desc: 'Override desc', max: 200 },
      ],
    });
    const result = extractParams(source, json);
    expect(result.params[0].desc).toBe('Override desc');
    expect(result.params[0].max).toBe(200);
    expect(result.params[0].min).toBe(1); // not overridden
  });

  it('ignores JSON params not in source', () => {
    const source = `@param 0..100\n$width = 50`;
    const json = JSON.stringify({
      params: [
        { name: 'width', desc: 'Width' },
        { name: 'nonexistent', desc: 'Should be ignored' },
      ],
    });
    const result = extractParams(source, json);
    expect(result.params).toHaveLength(1);
    expect(result.params[0].name).toBe('width');
  });

  it('extracts parameterSets', () => {
    const source = `@param 0..100\n$width = 50`;
    const json = JSON.stringify({
      parameterSets: {
        small: { width: 20 },
        large: { width: 80 },
      },
    });
    const result = extractParams(source, json);
    expect(result.parameterSets).toEqual({
      small: { width: 20 },
      large: { width: 80 },
    });
  });

  it('applies default parameterSet to defaults', () => {
    const source = `@param 0..100\n$width = 50`;
    const json = JSON.stringify({
      parameterSets: {
        default: { width: 75 },
      },
    });
    const result = extractParams(source, json);
    expect(result.params[0].default).toBe(75);
  });

  it('JSON default overrides source default', () => {
    const source = `@param 0..100\n$width = 50`;
    const json = JSON.stringify({
      params: [{ name: 'width', default: 60 }],
    });
    const result = extractParams(source, json);
    expect(result.params[0].default).toBe(60);
  });

  it('parameterSets default > JSON default > source default', () => {
    const source = `@param 0..100\n$width = 50`;
    const json = JSON.stringify({
      params: [{ name: 'width', default: 60 }],
      parameterSets: {
        default: { width: 75 },
      },
    });
    const result = extractParams(source, json);
    expect(result.params[0].default).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Evaluator overrides tests
// ---------------------------------------------------------------------------

describe('evaluator -- overrides', () => {
  it('uses override value for top-level variable', () => {
    const ast = parse('@param 0..100\n$width = 50\n$result = $width * 2');
    const result = evaluateExpressions(ast, { width: 30 });
    expect(result).toBe(60);
  });

  it('uses original value when no override', () => {
    const ast = parse('@param 0..100\n$width = 50\n$result = $width * 2');
    const result = evaluateExpressions(ast);
    expect(result).toBe(100);
  });

  it('overrides only specified variables', () => {
    const ast = parse('$width = 50\n$height = 100\n$result = $width + $height');
    const result = evaluateExpressions(ast, { width: 30 });
    expect(result).toBe(130);
  });
});
