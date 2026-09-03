import { parse } from './dist/index.js';

// Test: Group in pipe position
try {
  const ast = parse('box 5 5 5 | faces >Z | [rect 3 3, circle 1]');
  console.log('✓ Parse box ... | faces >Z | [rect, circle] succeeded');
  console.log('Ops:', ast.statements[0].ops.map(op => op.type));
} catch(e) {
  console.log('✗ Parse box ... | faces >Z | [rect, circle] failed:', e.message);
}

// Test: Single 2D primitive in pipe position (should work)
try {
  const ast = parse('box 5 5 5 | faces >Z | rect 3 3');
  console.log('\n✓ Parse box ... | faces >Z | rect 3 3 succeeded');
  console.log('Last op type:', ast.statements[0].ops[ast.statements[0].ops.length-1].type);
} catch(e) {
  console.log('\n✗ Parse box ... | faces >Z | rect 3 3 failed:', e.message);
}
