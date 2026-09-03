import { parse } from './dist/index.js';

// Test 1: Variable as pipeline source
try {
  const ast1 = parse('$s | fillet 0.5');
  console.log('✓ Parse $s | fillet succeeded');
  console.log(JSON.stringify(ast1.statements[0], null, 2));
} catch(e) {
  console.log('✗ Parse $s | fillet failed:', e.message);
}

// Test 2: Variable in faces selection context  
try {
  const ast2 = parse('box 5 5 5 | faces >Z | $s');
  console.log('\n✓ Parse box ... | faces >Z | $s succeeded');
  console.log(JSON.stringify(ast2.statements[0].ops, null, 2));
} catch(e) {
  console.log('\n✗ Parse box ... | faces >Z | $s failed:', e.message);
}

// Test 3: Group assignment and usage
try {
  const ast3 = parse('$group = [rect 5 5, circle 2]\n$group | extrude 3');
  console.log('\n✓ Parse group assignment and pipe succeeded');
} catch(e) {
  console.log('\n✗ Parse group assignment failed:', e.message);
}
