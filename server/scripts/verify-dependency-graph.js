'use strict';

const assert = require('node:assert/strict');
const { DependencyGraphError, buildDependencyGraph } = require('../src/planning/dependencyGraph');

function feature(featureId, inputOrder = 0) {
  return { feature_id: featureId, input_order: inputOrder };
}

function dependency(dependencyId, predecessor, dependent, dependencyType = 'Normal') {
  return {
    dependency_id: dependencyId,
    predecessor_feature_id: predecessor,
    dependent_feature_id: dependent,
    dependency_type: dependencyType,
    dependency_status: 'Unresolved',
  };
}

function assertTopologicalOrder(graph) {
  const positions = new Map(graph.topologicalOrder.map((featureId, index) => [featureId, index]));
  assert.equal(graph.topologicalOrder.length, graph.nodes.length);
  for (const edge of graph.edges) {
    assert.ok(
      positions.get(edge.predecessor_feature_id) < positions.get(edge.dependent_feature_id),
      `${edge.predecessor_feature_id} must precede ${edge.dependent_feature_id}`
    );
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function expectGraphError(features, dependencies, code, messagePart) {
  assert.throws(
    () => buildDependencyGraph(features, dependencies),
    (error) => {
      assert.ok(error instanceof DependencyGraphError);
      assert.equal(error.code, code);
      assert.match(error.message, new RegExp(messagePart));
      return true;
    }
  );
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('Expected an error to be thrown.');
}

const empty = buildDependencyGraph([], []);
assert.deepEqual(empty, { nodes: [], edges: [], topologicalOrder: [] });

const isolated = buildDependencyGraph([feature('F-2', 2), feature('F-1', 1)], []);
assert.deepEqual(isolated.nodes, ['F-1', 'F-2']);
assert.deepEqual(isolated.topologicalOrder, ['F-1', 'F-2']);

const chain = buildDependencyGraph(
  [feature('A', 1), feature('B', 2), feature('C', 3)],
  [dependency('D-AB', 'A', 'B'), dependency('D-BC', 'B', 'C')]
);
assert.deepEqual(chain.topologicalOrder, ['A', 'B', 'C']);
assertTopologicalOrder(chain);

const branches = buildDependencyGraph(
  [feature('A', 1), feature('B', 2), feature('C', 3), feature('D', 4), feature('E', 5)],
  [dependency('D-AC', 'A', 'C'), dependency('D-BD', 'B', 'D')]
);
assertTopologicalOrder(branches);
assert.ok(branches.nodes.includes('E'));

const multipleOrders = buildDependencyGraph(
  [feature('A', 1), feature('B', 2), feature('C', 3), feature('D', 4)],
  [dependency('D-AC', 'A', 'C'), dependency('D-AD', 'A', 'D')]
);
assertTopologicalOrder(multipleOrders);
assert.ok(
  multipleOrders.topologicalOrder.indexOf('A') < multipleOrders.topologicalOrder.indexOf('C')
);
assert.ok(
  multipleOrders.topologicalOrder.indexOf('A') < multipleOrders.topologicalOrder.indexOf('D')
);

expectGraphError(
  [feature('A'), feature('B')],
  [dependency('D-AB', 'A', 'B'), dependency('D-BA', 'B', 'A')],
  'DEPENDENCY_CYCLE',
  'A.*B.*A'
);
const indirectCycleError = captureError(() =>
  buildDependencyGraph(
    [feature('A'), feature('B'), feature('C')],
    [dependency('D-AB', 'A', 'B'), dependency('D-BC', 'B', 'C'), dependency('D-CA', 'C', 'A')]
  )
);
assert.equal(indirectCycleError.code, 'DEPENDENCY_CYCLE');
assert.deepEqual(indirectCycleError.cycle[0], indirectCycleError.cycle.at(-1));

const disconnectedCycleError = captureError(() =>
  buildDependencyGraph(
    [feature('A'), feature('B'), feature('X'), feature('Y')],
    [dependency('D-AB', 'A', 'B'), dependency('D-XY', 'X', 'Y'), dependency('D-YX', 'Y', 'X')]
  )
);
assert.equal(disconnectedCycleError.code, 'DEPENDENCY_CYCLE');
assert.ok(disconnectedCycleError.featureIds.includes('X'));
assert.ok(disconnectedCycleError.featureIds.includes('Y'));

expectGraphError(
  [feature('A')],
  [dependency('D-MISSING-PRED', 'Missing', 'A')],
  'MISSING_FEATURE_REFERENCE',
  'D-MISSING-PRED.*Missing'
);
expectGraphError(
  [feature('A')],
  [dependency('D-MISSING-DEP', 'A', 'Missing')],
  'MISSING_FEATURE_REFERENCE',
  'D-MISSING-DEP.*Missing'
);

const mixedTypes = buildDependencyGraph(
  [feature('A'), feature('B'), feature('C')],
  [dependency('D-HARD', 'A', 'B', 'Hard'), dependency('D-NORMAL', 'B', 'C', 'Normal')]
);
assert.deepEqual(mixedTypes.topologicalOrder, ['A', 'B', 'C']);
assert.equal(
  mixedTypes.edges.find((edge) => edge.dependency_id === 'D-HARD').dependency_type,
  'Hard'
);
assert.equal(
  mixedTypes.edges.find((edge) => edge.dependency_id === 'D-NORMAL').dependency_type,
  'Normal'
);
assert.equal(
  mixedTypes.edges.find((edge) => edge.dependency_id === 'D-HARD').dependency_status,
  'Unresolved'
);

const deterministicFeatures = [feature('B', 2), feature('A', 1), feature('C', 3)];
const deterministicDependencies = [dependency('D-BC', 'B', 'C'), dependency('D-AC', 'A', 'C')];
const firstRun = buildDependencyGraph(deterministicFeatures, deterministicDependencies);
const secondRun = buildDependencyGraph(deterministicFeatures, deterministicDependencies);
assert.deepEqual(firstRun, secondRun);

const immutableFeatures = deepFreeze([feature('A', 1), feature('B', 2)]);
const immutableDependencies = deepFreeze([dependency('D-AB', 'A', 'B')]);
assert.doesNotThrow(() => buildDependencyGraph(immutableFeatures, immutableDependencies));

const longChainFeatures = Array.from({ length: 5000 }, (_, index) =>
  feature(`F-${String(index).padStart(5, '0')}`, index)
);
const longChainDependencies = Array.from({ length: 4999 }, (_, index) =>
  dependency(
    `D-${index}`,
    `F-${String(index).padStart(5, '0')}`,
    `F-${String(index + 1).padStart(5, '0')}`
  )
);
const longChain = buildDependencyGraph(longChainFeatures, longChainDependencies);
assert.equal(longChain.topologicalOrder.length, 5000);
assertTopologicalOrder(longChain);

const longCycleError = captureError(() =>
  buildDependencyGraph(longChainFeatures, [
    ...longChainDependencies,
    dependency('D-CLOSE', 'F-04999', 'F-00000'),
  ])
);
assert.equal(longCycleError.code, 'DEPENDENCY_CYCLE');
assert.equal(longCycleError.cycle.length, 5001);

console.log('Dependency graph verification passed.');
