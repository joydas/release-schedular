'use strict';

const assert = require('node:assert/strict');
const {
  HardDependencyBlockingError,
  calculateHardDependencyBlocking,
} = require('../src/planning/hardDependencyBlocking');

function feature(featureId, overrides = {}) {
  return {
    feature_id: featureId,
    build_estimate_current: 100,
    build_actual_spent: 0,
    st_estimate_current: 50,
    st_actual_spent: 0,
    ...overrides,
  };
}

function hardDependency(dependencyId, dependentFeatureId, overrides = {}) {
  return {
    dependency_id: dependencyId,
    predecessor_feature_id: 'PRED',
    dependent_feature_id: dependentFeatureId,
    dependency_type: 'Hard',
    affected_activity: 'Build',
    blocking_pct: 20,
    dependency_status: 'Unresolved',
    ...overrides,
  };
}

function resultFor(features, dependencies, featureId) {
  return calculateHardDependencyBlocking(features, dependencies).find(
    (result) => result.feature_id === featureId
  );
}

function expectBlockingError(features, dependencies, code) {
  assert.throws(
    () => calculateHardDependencyBlocking(features, dependencies),
    (error) => {
      assert.ok(error instanceof HardDependencyBlockingError);
      assert.equal(error.code, code);
      return true;
    }
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const unblocked = calculateHardDependencyBlocking([feature('F-1')], []);
assert.equal(unblocked.length, 1);
assert.deepEqual(unblocked[0].build, {
  remaining_effort: 100,
  blocking_percentage_total: 0,
  uncapped_blocked_effort: 0,
  blocked_effort: 0,
  allocatable_effort: 100,
  contributions: [],
});
assert.equal(unblocked[0].st.allocatable_effort, 50);

const normalResult = resultFor(
  [feature('PRED'), feature('F-1')],
  [hardDependency('D-NORMAL', 'F-1', { dependency_type: 'Normal' })],
  'F-1'
);
assert.equal(normalResult.build.blocked_effort, 0);
assert.equal(normalResult.st.blocked_effort, 0);

const buildOnly = resultFor(
  [
    feature('PRED'),
    feature('F-1', {
      build_estimate_current: 100,
      build_actual_spent: 25,
      st_estimate_current: 40,
      st_actual_spent: 10,
    }),
  ],
  [hardDependency('D-BUILD', 'F-1', { blocking_pct: 20, affected_activity: 'Build' })],
  'F-1'
);
assert.equal(buildOnly.build.remaining_effort, 75);
assert.equal(buildOnly.build.blocked_effort, 15);
assert.equal(buildOnly.build.allocatable_effort, 60);
assert.equal(buildOnly.st.remaining_effort, 30);
assert.equal(buildOnly.st.blocked_effort, 0);
assert.equal(buildOnly.st.allocatable_effort, 30);

const stOnly = resultFor(
  [feature('PRED'), feature('F-1')],
  [hardDependency('D-ST', 'F-1', { blocking_pct: 30, affected_activity: 'ST' })],
  'F-1'
);
assert.equal(stOnly.build.blocked_effort, 0);
assert.equal(stOnly.build.allocatable_effort, 100);
assert.equal(stOnly.st.blocked_effort, 15);
assert.equal(stOnly.st.allocatable_effort, 35);

const both = resultFor(
  [feature('PRED'), feature('F-1', { build_actual_spent: 25, st_actual_spent: 10 })],
  [hardDependency('D-BOTH', 'F-1', { blocking_pct: 20, affected_activity: 'Both' })],
  'F-1'
);
assert.equal(both.build.blocked_effort, 15);
assert.equal(both.st.blocked_effort, 8);

const additive = resultFor(
  [feature('PRED'), feature('F-1', { build_estimate_current: 80, build_actual_spent: 40 })],
  [
    hardDependency('D-25', 'F-1', { blocking_pct: 25 }),
    hardDependency('D-50', 'F-1', { blocking_pct: 50 }),
  ],
  'F-1'
);
assert.equal(additive.build.remaining_effort, 40);
assert.equal(additive.build.blocking_percentage_total, 75);
assert.equal(additive.build.uncapped_blocked_effort, 30);
assert.equal(additive.build.blocked_effort, 30);
assert.equal(additive.build.allocatable_effort, 10);
assert.deepEqual(
  additive.build.contributions.map((contribution) => contribution.blocked_effort),
  [10, 20]
);

const capped = resultFor(
  [feature('PRED'), feature('F-1', { build_estimate_current: 80, build_actual_spent: 40 })],
  [
    hardDependency('D-80', 'F-1', { blocking_pct: 80 }),
    hardDependency('D-50', 'F-1', { blocking_pct: 50 }),
  ],
  'F-1'
);
assert.equal(capped.build.blocking_percentage_total, 130);
assert.equal(capped.build.uncapped_blocked_effort, 52);
assert.equal(capped.build.blocked_effort, 40);
assert.equal(capped.build.allocatable_effort, 0);

const zeroRemaining = resultFor(
  [
    feature('PRED'),
    feature('F-1', {
      build_estimate_current: 10,
      build_actual_spent: 10,
      st_estimate_current: 5,
      st_actual_spent: 5,
    }),
  ],
  [hardDependency('D-ZERO', 'F-1', { blocking_pct: 100, affected_activity: 'Both' })],
  'F-1'
);
assert.equal(zeroRemaining.build.remaining_effort, 0);
assert.equal(zeroRemaining.build.blocked_effort, 0);
assert.equal(zeroRemaining.st.remaining_effort, 0);
assert.equal(zeroRemaining.st.blocked_effort, 0);

const completionFeatures = [
  feature('PRED', {
    build_estimate_current: 10,
    build_actual_spent: 10,
    st_estimate_current: 5,
    st_actual_spent: 5,
  }),
  feature('F-1'),
];
assert.equal(
  completionFeatures[0].build_actual_spent,
  completionFeatures[0].build_estimate_current
);
assert.equal(completionFeatures[0].st_actual_spent, completionFeatures[0].st_estimate_current);
const completedPredecessorDependency = hardDependency('D-COMPLETE', 'F-1', {
  blocking_pct: 60,
  dependency_status: 'Resolved',
});
const resolvedDependencyWithCompletedPredecessor = resultFor(
  completionFeatures,
  [completedPredecessorDependency],
  'F-1'
);
assert.equal(resolvedDependencyWithCompletedPredecessor.build.blocked_effort, 0);
assert.equal(resolvedDependencyWithCompletedPredecessor.st.blocked_effort, 0);

const unresolvedDependencyWithCompletedPredecessor = resultFor(
  completionFeatures,
  [{ ...completedPredecessorDependency, dependency_status: 'Unresolved' }],
  'F-1'
);
assert.equal(unresolvedDependencyWithCompletedPredecessor.build.blocked_effort, 60);
assert.equal(unresolvedDependencyWithCompletedPredecessor.build.allocatable_effort, 40);

const allocatedPredecessor = feature('PRED', {
  build_scheduled_effort: 100,
  st_allocated_effort: 50,
});
assert.equal(allocatedPredecessor.build_actual_spent, 0);
assert.equal(
  allocatedPredecessor.build_scheduled_effort,
  allocatedPredecessor.build_estimate_current
);
assert.equal(allocatedPredecessor.st_actual_spent, 0);
assert.equal(allocatedPredecessor.st_allocated_effort, allocatedPredecessor.st_estimate_current);
const plannedButNotActual = resultFor(
  [allocatedPredecessor, feature('F-1')],
  [hardDependency('D-ACTUAL-ONLY', 'F-1', { blocking_pct: 25 })],
  'F-1'
);
assert.equal(plannedButNotActual.build.remaining_effort, 100);
assert.equal(plannedButNotActual.build.blocked_effort, 25);
assert.equal(plannedButNotActual.st.remaining_effort, 50);

expectBlockingError(
  [feature('F-1')],
  [hardDependency('D-MISSING-PRED', 'F-1', { predecessor_feature_id: 'MISSING' })],
  'MISSING_FEATURE_REFERENCE'
);
expectBlockingError(
  [feature('PRED')],
  [hardDependency('D-MISSING-DEPENDENT', 'MISSING')],
  'MISSING_FEATURE_REFERENCE'
);
expectBlockingError(
  [feature('PRED'), feature('F-1')],
  [hardDependency('D-BAD-PCT', 'F-1', { blocking_pct: 101 })],
  'INVALID_BLOCKING_PERCENTAGE'
);
expectBlockingError(
  [feature('PRED'), feature('F-1')],
  [hardDependency('D-NAN-PCT', 'F-1', { blocking_pct: 'NaN' })],
  'INVALID_BLOCKING_PERCENTAGE'
);

const actualSpentFeature = feature('F-1', {
  build_estimate_current: 100,
  build_actual_spent: 15,
});
const immutableFeatureInputs = deepFreeze([feature('PRED'), actualSpentFeature]);
const immutableDependencyInputs = deepFreeze([
  hardDependency('D-IMMUTABLE', 'F-1', { blocking_pct: 40 }),
]);
const immutableResult = calculateHardDependencyBlocking(
  immutableFeatureInputs,
  immutableDependencyInputs
);
const immutableTarget = immutableResult.find((entry) => entry.feature_id === 'F-1');
assert.equal(immutableTarget.build.remaining_effort, 85);
assert.equal(immutableTarget.build.blocked_effort, 34);
assert.equal(actualSpentFeature.build_actual_spent, 15);
assert.equal('build_actual_spent' in immutableTarget, false);
assert.doesNotThrow(() =>
  calculateHardDependencyBlocking(immutableFeatureInputs, immutableDependencyInputs)
);

assert.deepEqual(
  calculateHardDependencyBlocking(completionFeatures, [completedPredecessorDependency]),
  calculateHardDependencyBlocking(completionFeatures, [completedPredecessorDependency])
);

console.log('Hard dependency blocking verification passed.');
