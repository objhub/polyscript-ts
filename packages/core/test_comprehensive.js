import { parse } from './dist/index.js';
import { Evaluator } from './dist/index.js';

console.log('=== PARSING TESTS ===\n');

// Test 1: VarRef as pipeline source
console.log('Test 1: $s | fillet 0.5');
try {
  const ast = parse('$s | fillet 0.5');
  const pipeline = ast.statements[0];
  console.log('✓ Parses successfully');
  console.log('  Source type:', pipeline.source.type);
  console.log('  Ops:', pipeline.ops.map(op => op.type));
} catch(e) {
  console.log('✗ Failed:', e.message);
}

// Test 2: VarRef as pipe operation (should fail)
console.log('\nTest 2: box 5 5 5 | faces >Z | $s');
try {
  const ast = parse('box 5 5 5 | faces >Z | $s');
  console.log('✓ Parses successfully');
} catch(e) {
  console.log('✗ Failed (expected):', e.message);
}

// Test 3: GroupExpr in pipe (should fail)
console.log('\nTest 3: box 5 5 5 | faces >Z | [rect 3 3]');
try {
  const ast = parse('box 5 5 5 | faces >Z | [rect 3 3]');
  console.log('✓ Parses successfully');
} catch(e) {
  console.log('✗ Failed (expected):', e.message);
}

// Test 4: Group as source (should work)
console.log('\nTest 4: [rect 5 5, circle 2] | extrude 3');
try {
  const ast = parse('[rect 5 5, circle 2] | extrude 3');
  const pipeline = ast.statements[0];
  console.log('✓ Parses successfully');
  console.log('  Source type:', pipeline.source.type);
  console.log('  Elements:', pipeline.source.elements.length);
  console.log('  Ops:', pipeline.ops.map(op => op.type));
} catch(e) {
  console.log('✗ Failed:', e.message);
}

// Test 5: Variable holding group (should parse)
console.log('\nTest 5: $g = [rect 5 5, circle 2]');
try {
  const ast = parse('$g = [rect 5 5, circle 2]');
  const assignment = ast.statements[0];
  console.log('✓ Parses successfully');
  console.log('  Var name:', assignment.name);
  console.log('  Value type:', assignment.value.type);
  if (assignment.value.type === 'GroupExpr') {
    console.log('  Elements:', assignment.value.elements.length);
  }
} catch(e) {
  console.log('✗ Failed:', e.message);
}

// Test 6: Using variable with group as source (should work)
console.log('\nTest 6: $g = [rect 5 5, circle 2] | extrude 3');
try {
  const ast = parse('$g = [rect 5 5, circle 2]\n$g | extrude 3');
  console.log('✓ Parses successfully');
  const stmt2 = ast.statements[1];
  console.log('  Statement 2 type:', stmt2.type);
  if (stmt2.type === 'Pipeline') {
    console.log('  Source type:', stmt2.source.type);
  }
} catch(e) {
  console.log('✗ Failed:', e.message);
}

console.log('\n=== VALIDATOR TESTS ===\n');

const { validate } = await import('./dist/index.js');

// Test 7: Validate variable as pipe source
console.log('Test 7: Validating $s | fillet 0.5');
try {
  const ast = parse('$s | fillet 0.5');
  const errors = validate(ast);
  console.log('✓ Validation result:', errors.length === 0 ? 'no errors' : errors.length + ' error(s)');
  if (errors.length > 0) console.log('  Errors:', errors.map(e => e.message));
} catch(e) {
  console.log('✗ Error:', e.message);
}

// Test 8: Validate group source
console.log('\nTest 8: Validating [rect 5 5] | extrude 3');
try {
  const ast = parse('[rect 5 5] | extrude 3');
  const errors = validate(ast);
  console.log('✓ Validation result:', errors.length === 0 ? 'no errors' : errors.length + ' error(s)');
  if (errors.length > 0) console.log('  Errors:', errors.map(e => e.message));
} catch(e) {
  console.log('✗ Error:', e.message);
}
