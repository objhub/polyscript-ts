import { Evaluator } from './dist/index.js';
import { parse } from './dist/index.js';

// Create a mock OC for testing
const mockOC = {
  fuse: (s1, s2) => ({ fused: [s1, s2] }),
  makeCompound: (shapes) => ({ compound: shapes }),
  translate: (s, x, y, z) => ({ translated: s, x, y, z }),
  _calls: [],
};

Object.assign(mockOC, {
  makeWire: function(edges) { this._calls.push({ method: 'makeWire', edges }); return {}; },
  makeFace: function(wire) { this._calls.push({ method: 'makeFace', wire }); return {}; },
  box: function(x, y, z) { this._calls.push({ method: 'box', x, y, z }); return { shape: 'box' }; },
});

// Test 1: Variable as pipeline source
try {
  const ast = parse('$s = box 2 2 2\n$s | fillet 0.5');
  console.log('AST for $s = box ... | $s | fillet:', ast.statements[0]);
} catch(e) {
  console.log('Parse error:', e.message);
}

// Test 2: Parsing a group assignment
try {
  const ast = parse('$group = [rect 5 5, circle 2]');
  console.log('\nAST for group assignment:');
  console.log('Statement type:', ast.statements[0].type);
  console.log('Value type:', ast.statements[0].value.type);
  if(ast.statements[0].value.type === 'GroupExpr') {
    console.log('Group elements:', ast.statements[0].value.elements.length);
  }
} catch(e) {
  console.log('Parse error:', e.message);
}
