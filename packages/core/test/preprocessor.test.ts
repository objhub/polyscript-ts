import { describe, it, expect } from 'vitest';
import { preprocess } from '../src/preprocessor.js';

describe('preprocessor', () => {
  it('joins lines ending with |', () => {
    expect(preprocess('box 10|\nfillet 2').source).toBe('box 10| fillet 2');
  });

  it('joins lines starting with |', () => {
    expect(preprocess('box 10\n | fillet 2').source).toBe('box 10 | fillet 2');
  });

  it('joins lines ending with = (but not == != <= >=)', () => {
    expect(preprocess('x =\n10').source).toBe('x = 10');
    expect(preprocess('x ==\n10').source).toBe('x ==\n10');
    expect(preprocess('x !=\n10').source).toBe('x !=\n10');
    expect(preprocess('x <=\n10').source).toBe('x <=\n10');
    expect(preprocess('x >=\n10').source).toBe('x >=\n10');
  });

  it('joins lines ending with ,', () => {
    expect(preprocess('a,\nb').source).toBe('a, b');
  });

  it('joins lines starting with else', () => {
    expect(preprocess('if x\n  else y').source).toBe('if x else y');
  });

  it('joins lines starting with +', () => {
    expect(preprocess('x\n+ y').source).toBe('x + y');
  });

  it('joins lines starting with for', () => {
    expect(preprocess('[i\n  for i in range(6)]').source).toBe('[i for i in range(6)]');
  });

  it('strips comments before line joining', () => {
    const result = preprocess('box 10 # comment\n | fillet 2');
    expect(result.source).toBe('box 10  | fillet 2');
  });

  it('comment ending with | does not join next line', () => {
    const result = preprocess('# |\nbox 10 10 3 | grid 4 3 20');
    expect(result.source).toBe('\nbox 10 10 3 | grid 4 3 20');
  });

  it('preserves strings containing #', () => {
    const result = preprocess('"hello # world"');
    expect(result.source).toBe('"hello # world"');
  });

  it('charLineMap maps characters to original lines', () => {
    // Line 1: box 10
    // Line 2:  | fillet 2
    // After join: "box 10 | fillet 2"
    // "| fillet 2" part should map to original line 2
    const result = preprocess('box 10\n | fillet 2');
    // '|' in the output should map to line 2
    const pipeIdx = result.source.indexOf('|');
    expect(result.charLineMap[pipeIdx]).toBe(2);
    // 'b' of 'box' should map to line 1
    expect(result.charLineMap[0]).toBe(1);
  });

  it('charLineMap preserves lines for non-joined source', () => {
    const result = preprocess('x = 1\ny = 2\nz = 3');
    // 'y' starts on original line 2
    const yIdx = result.source.indexOf('y');
    expect(result.charLineMap[yIdx]).toBe(2);
    // 'z' starts on original line 3
    const zIdx = result.source.indexOf('z');
    expect(result.charLineMap[zIdx]).toBe(3);
  });
});
