'use strict';

const assert = require('node:assert/strict');
const { DependencyGraphError } = require('../src/planning/dependencyGraph');
const { calculateHardDependencyBlocking } = require('../src/planning/hardDependencyBlocking');
const {
  FeatureOrderingError,
  getFeatureConsiderationOrder,
} = require('../src/planning/featureOrdering');

function feature(featureId, priority, inputOrder, overrides = {}) {
  return {
    feature_id: featureId,
    team_id: 'TEAM-1',
    priority,
    input_order: inputOrder,
    build_estimate_current: 10,
    build_actual_spent: 0,
    st_estimate_current: 5,
    st_actual_spent: 0,
    ...overrides,
  };
}

function dependency(dependencyId, predecessor, dependent, overrides = {}) {
  return {
    dependency_id: dependencyId,
    predecessor_feature_id: predecessor,
    dependent_feature_id: dependent,
    dependency_type: 'Normal',
    dependency_status: 'Unresolved',
    affected_activity: null,
    blocking_pct: null,
    ...overrides,
  };
}

function assertPrecedes(order, predecessorId, dependentId) {
  assert.ok(
    order.indexOf(predecessorId) < order.indexOf(dependentId),
    `${predecessorId} must be considered before ${dependentId}`
  );
}

function expectGraphError(features, dependencies) {
  assert.throws(
    () => getFeatureConsiderationOrder(features, dependencies),
    (error) => error instanceof DependencyGraphError && error.code === 'DEPENDENCY_CYCLE'
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const noDependencies = getFeatureConsiderationOrder(
  [feature('F-3', 2, 1), feature('F-2', 1, 2), feature('F-1', 1, 1), feature('F-4', 3, 1)],
  []
);
assert.deepEqual(noDependencies, ['F-1', 'F-2', 'F-3', 'F-4']);

const crossTeamEqualPriorities = getFeatureConsiderationOrder(
  [
    feature('CROSS-PRED', 1, 2, { team_id: 'GLUE' }),
    feature('CROSS-DEPENDENT', 1, 1, { team_id: 'IA' }),
  ],
  [dependency('D-CROSS-EQUAL', 'CROSS-PRED', 'CROSS-DEPENDENT')]
);
assert.deepEqual(crossTeamEqualPriorities, ['CROSS-PRED', 'CROSS-DEPENDENT']);

const crossTeamPriorityDifference = getFeatureConsiderationOrder(
  [
    feature('CROSS-LOWER-PRED', 9, 2, { team_id: 'GLUE' }),
    feature('CROSS-HIGHER-DEPENDENT', 1, 1, { team_id: 'IA' }),
  ],
  [dependency('D-CROSS-DIFFERENT', 'CROSS-LOWER-PRED', 'CROSS-HIGHER-DEPENDENT')]
);
assert.deepEqual(crossTeamPriorityDifference, ['CROSS-LOWER-PRED', 'CROSS-HIGHER-DEPENDENT']);

const crossTeamReadyTieBreaker = getFeatureConsiderationOrder(
  [
    feature('GLUE-FIRST', 99, 1, { team_id: 'GLUE' }),
    feature('IA-SECOND', 1, 2, { team_id: 'IA' }),
  ],
  []
);
assert.deepEqual(crossTeamReadyTieBreaker, ['GLUE-FIRST', 'IA-SECOND']);

const missingTeamPriority = getFeatureConsiderationOrder(
  [feature('NO-TEAM-PRED', 5, 1, { team_id: null }), feature('TEAM-DEPENDENT', 1, 2)],
  [dependency('D-MISSING-TEAM', 'NO-TEAM-PRED', 'TEAM-DEPENDENT')]
);
assert.deepEqual(missingTeamPriority, ['NO-TEAM-PRED', 'TEAM-DEPENDENT']);

const equalPriorityWithConstraint = getFeatureConsiderationOrder(
  [feature('A', 2, 1), feature('B', 1, 2), feature('C', 1, 3), feature('D', 3, 4)],
  [dependency('D-CA', 'C', 'A')]
);
assertPrecedes(equalPriorityWithConstraint, 'B', 'C');
assertPrecedes(equalPriorityWithConstraint, 'C', 'A');
assertPrecedes(equalPriorityWithConstraint, 'A', 'D');

const higherPriorityDependent = getFeatureConsiderationOrder(
  [feature('PRED', 1, 1), feature('DEPENDENT', 9, 1), feature('OTHER', 5, 1)],
  [dependency('D-PRED', 'PRED', 'DEPENDENT')]
);
assertPrecedes(higherPriorityDependent, 'PRED', 'DEPENDENT');
assert.ok(higherPriorityDependent.indexOf('PRED') < higherPriorityDependent.indexOf('OTHER'));
assert.ok(higherPriorityDependent.indexOf('OTHER') < higherPriorityDependent.indexOf('DEPENDENT'));

const multipleDependencies = getFeatureConsiderationOrder(
  [feature('A', 3, 1), feature('B', 4, 1), feature('C', 5, 1), feature('ISOLATED', 2, 1)],
  [dependency('D-AC', 'A', 'C'), dependency('D-BC', 'B', 'C')]
);
assertPrecedes(multipleDependencies, 'A', 'C');
assertPrecedes(multipleDependencies, 'B', 'C');
assert.ok(multipleDependencies.includes('ISOLATED'));

const longFeatures = Array.from({ length: 5000 }, (_, index) =>
  feature(`F-${String(index).padStart(5, '0')}`, index + 1, index)
);
const longDependencies = Array.from({ length: 4999 }, (_, index) =>
  dependency(
    `D-${index}`,
    `F-${String(index).padStart(5, '0')}`,
    `F-${String(index + 1).padStart(5, '0')}`
  )
);
const longOrder = getFeatureConsiderationOrder(longFeatures, longDependencies);
assert.equal(longOrder.length, 5000);
for (let index = 0; index < 4999; index += 1) {
  assert.ok(
    longOrder.indexOf(`F-${String(index).padStart(5, '0')}`) <
      longOrder.indexOf(`F-${String(index + 1).padStart(5, '0')}`)
  );
}

const branchesFeatures = [
  feature('A', 2, 1),
  feature('B', 1, 1),
  feature('C', 3, 1),
  feature('D', 2, 2),
  feature('ISOLATED', 1, 2),
];
const branchesDependencies = [dependency('D-AC', 'A', 'C'), dependency('D-BD', 'B', 'D')];
const branchOrder = getFeatureConsiderationOrder(branchesFeatures, branchesDependencies);
assertPrecedes(branchOrder, 'A', 'C');
assertPrecedes(branchOrder, 'B', 'D');
assert.deepEqual(branchOrder, getFeatureConsiderationOrder(branchesFeatures, branchesDependencies));

const hardFeatures = [feature('PRED', 1, 1), feature('DEPENDENT', 4, 1)];
const hardEdge = dependency('D-HARD', 'PRED', 'DEPENDENT', {
  dependency_type: 'Hard',
  affected_activity: 'Build',
  blocking_pct: 40,
});
const hardOrder = getFeatureConsiderationOrder(hardFeatures, [hardEdge]);
assertPrecedes(hardOrder, 'PRED', 'DEPENDENT');
const hardResults = calculateHardDependencyBlocking(hardFeatures, [hardEdge]);
assert.equal(hardResults.find((entry) => entry.feature_id === 'DEPENDENT').build.blocked_effort, 4);

const normalForBlocking = dependency('D-NORMAL-NO-BLOCK', 'PRED', 'DEPENDENT');
const normalResults = calculateHardDependencyBlocking(hardFeatures, [normalForBlocking]);
assert.equal(
  normalResults.find((entry) => entry.feature_id === 'DEPENDENT').build.blocked_effort,
  0
);
assert.equal(normalResults.find((entry) => entry.feature_id === 'DEPENDENT').st.blocked_effort, 0);

const resolvedNormalOrder = getFeatureConsiderationOrder(
  [feature('PRED', 1, 1), feature('DEPENDENT', 5, 1)],
  [dependency('D-RESOLVED', 'PRED', 'DEPENDENT', { dependency_status: 'Resolved' })]
);
const unresolvedNormalOrder = getFeatureConsiderationOrder(
  [feature('PRED', 1, 1), feature('DEPENDENT', 5, 1)],
  [dependency('D-UNRESOLVED', 'PRED', 'DEPENDENT', { dependency_status: 'Unresolved' })]
);
assertPrecedes(resolvedNormalOrder, 'PRED', 'DEPENDENT');
assertPrecedes(unresolvedNormalOrder, 'PRED', 'DEPENDENT');

expectGraphError(
  [feature('A', 1, 1), feature('B', 1, 2)],
  [dependency('D-AB', 'A', 'B'), dependency('D-BA', 'B', 'A')]
);
expectGraphError(
  [feature('A', 1, 1), feature('B', 1, 2), feature('C', 1, 3)],
  [dependency('D-AB', 'A', 'B'), dependency('D-BC', 'B', 'C'), dependency('D-CA', 'C', 'A')]
);
assert.throws(
  () =>
    getFeatureConsiderationOrder([feature('A', 1, 1)], [dependency('D-MISSING', 'MISSING', 'A')]),
  (error) => error instanceof DependencyGraphError && error.code === 'MISSING_FEATURE_REFERENCE'
);
assert.throws(
  () => getFeatureConsiderationOrder([feature('A', 'bad', 1)], []),
  (error) => error instanceof FeatureOrderingError && error.code === 'INVALID_PRIORITY'
);

const frozenFeatures = deepFreeze([feature('A', 1, 1), feature('B', 2, 1)]);
const frozenDependencies = deepFreeze([dependency('D-AB', 'A', 'B')]);
assert.doesNotThrow(() => getFeatureConsiderationOrder(frozenFeatures, frozenDependencies));

for (const dependencyType of ['Hard', 'Normal']) {
  assert.throws(
    () =>
      getFeatureConsiderationOrder(
        [feature('PRED', 2, 1), feature('DEPENDENT', 2, 2)],
        [
          dependency(`D-EQUAL-${dependencyType}`, 'PRED', 'DEPENDENT', {
            dependency_type: dependencyType,
          }),
        ]
      ),
    (error) =>
      error instanceof FeatureOrderingError &&
      error.code === 'INVALID_DEPENDENCY_PRIORITY' &&
      error.message.includes('PRED (team TEAM-1, priority 2)') &&
      error.message.includes('DEPENDENT (team TEAM-1, priority 2)')
  );
  assert.throws(
    () =>
      getFeatureConsiderationOrder(
        [feature('PRED', 3, 1), feature('DEPENDENT', 1, 2)],
        [
          dependency(`D-LOWER-${dependencyType}`, 'PRED', 'DEPENDENT', {
            dependency_type: dependencyType,
          }),
        ]
      ),
    (error) => error.code === 'INVALID_DEPENDENCY_PRIORITY'
  );
}
assert.throws(
  () =>
    getFeatureConsiderationOrder(
      [feature('PRED', 'bad', 1), feature('DEPENDENT', 2, 2)],
      [dependency('D-INVALID-PRIORITY', 'PRED', 'DEPENDENT')]
    ),
  (error) => error instanceof FeatureOrderingError && error.code === 'INVALID_PRIORITY'
);

console.log('Feature ordering verification passed.');
