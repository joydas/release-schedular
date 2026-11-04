'use strict';

const assert = require('node:assert/strict');
const { allocateFeatureEffort } = require('../src/planning/featureAllocation');
const { TbcGenerationError, generateTbcReleases } = require('../src/planning/tbcReleaseGeneration');

function feature(featureId, priority, inputOrder, overrides = {}) {
  return {
    feature_id: featureId,
    release_id: 'R-1',
    team_id: 'T-1',
    priority,
    input_order: inputOrder,
    build_estimate_current: 4,
    build_original_estimate: 4,
    build_actual_spent: 0,
    st_estimate_current: 0,
    st_original_estimate: 0,
    st_actual_spent: 0,
    ...overrides,
  };
}

function release(releaseId, endDate = '2026-01-06') {
  return {
    release_id: releaseId,
    release_name: releaseId,
    status: 'Planned',
    start_date: '2025-12-10',
    end_date: endDate,
    target_date: null,
    priority_order: 1,
  };
}

function capacity(teamId, releaseId, build, st) {
  return { team_id: teamId, release_id: releaseId, build_capacity: build, st_capacity: st };
}

function dependency(predecessor, dependent, overrides = {}) {
  return {
    dependency_id: `D-${predecessor}-${dependent}`,
    predecessor_feature_id: predecessor,
    dependent_feature_id: dependent,
    dependency_type: 'Normal',
    dependency_status: 'Unresolved',
    affected_activity: null,
    blocking_pct: null,
    ...overrides,
  };
}

function allocateReal(features, dependencies, releases, capacities) {
  return allocateFeatureEffort({ features, dependencies, releases, capacities });
}

function generate(features, dependencies, releases, capacities, realAllocation) {
  return generateTbcReleases({ features, dependencies, releases, capacities, realAllocation });
}

function resultFor(result, releaseIndex, featureId) {
  return result.allocations[releaseIndex].features.find(
    (allocation) => allocation.feature_id === featureId
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const exactRealFeatures = [feature('EXACT', 1, 1, { build_estimate_current: 4 })];
const exactRealReleases = [release('R-1')];
const exactRealCapacity = [capacity('T-1', 'R-1', 4, 0)];
const exactRealAllocation = allocateReal(
  exactRealFeatures,
  [],
  exactRealReleases,
  exactRealCapacity
);
const exactReal = generate(
  exactRealFeatures,
  [],
  exactRealReleases,
  exactRealCapacity,
  exactRealAllocation
);
assert.equal(exactReal.releases.length, 0);
assert.equal(exactReal.stop_reason, 'no_remaining_work');

const aggregateTbcFeatures = [feature('AGG-TBC', 1, 1, { build_estimate_current: 100 })];
const aggregateTbcReleases = [
  { ...release('R-1'), priority_order: 1 },
  { ...release('R-2', '2026-02-06'), priority_order: 2 },
];
const aggregateTbcCapacities = [capacity('T-1', 'R-1', 40, 0), capacity('T-1', 'R-2', 40, 0)];
const aggregateRealAllocation = allocateReal(
  aggregateTbcFeatures,
  [],
  aggregateTbcReleases,
  aggregateTbcCapacities
);
const aggregateTbc = generate(
  aggregateTbcFeatures,
  [],
  aggregateTbcReleases,
  aggregateTbcCapacities,
  aggregateRealAllocation
);
assert.equal(aggregateTbc.releases.length, 1);
assert.equal(aggregateTbc.capacities[0].build_capacity, 40);
assert.equal(resultFor(aggregateTbc, 0, 'AGG-TBC').build_allocated_effort, 20);
assert.equal(
  aggregateTbc.stop_reason,
  'all_schedulable_work_allocated',
  'TBC sprint workday cadence does not cap aggregate team SP capacity'
);

const noReleases = generate([], [], [], [], { allocations: [] });
assert.equal(noReleases.releases.length, 0);
assert.equal(noReleases.stop_reason, 'no_real_releases');

const noCapacityFeatures = [feature('NO-CAP', 1, 1)];
const noCapacityReleases = [release('R-1')];
const noCapacityAllocation = allocateReal(noCapacityFeatures, [], noCapacityReleases, []);
const noCapacity = generate(noCapacityFeatures, [], noCapacityReleases, [], noCapacityAllocation);
assert.equal(noCapacity.releases.length, 0);
assert.equal(noCapacity.stop_reason, 'no_usable_capacity');

const zeroCapacity = generate(
  noCapacityFeatures,
  [],
  noCapacityReleases,
  [capacity('T-1', 'R-1', 0, 0)],
  noCapacityAllocation
);
assert.equal(zeroCapacity.releases.length, 0);
assert.equal(zeroCapacity.stop_reason, 'no_usable_capacity');

const multiReleaseFeatures = [
  feature('BUILD', 1, 1, { build_estimate_current: 4, st_estimate_current: 0 }),
  feature('ST', 2, 2, {
    release_id: 'R-2',
    build_estimate_current: 2,
    build_actual_spent: 0,
    st_estimate_current: 8,
  }),
];
const multiRealReleases = [release('R-1'), release('R-2', '2026-01-06')];
const multiRealCapacities = [capacity('T-1', 'R-1', 2, 0), capacity('T-1', 'R-2', 0, 4)];
const multiRealAllocation = allocateReal(
  multiReleaseFeatures,
  [],
  multiRealReleases,
  multiRealCapacities
);
const independentAverages = generate(
  multiReleaseFeatures,
  [],
  multiRealReleases,
  multiRealCapacities,
  multiRealAllocation
);
assert.equal(independentAverages.releases.length, 6);
assert.equal(independentAverages.capacities[0].build_capacity, 1);
assert.equal(independentAverages.capacities[0].st_capacity, 2);
assert.equal(resultFor(independentAverages, 0, 'BUILD').build_allocated_effort, 1);
assert.equal(resultFor(independentAverages, 1, 'BUILD').build_allocated_effort, 1);
assert.equal(resultFor(independentAverages, 0, 'ST').st_allocated_effort, 0);
assert.ok(
  resultFor(independentAverages, 0, 'ST').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);
assert.equal(resultFor(independentAverages, 1, 'ST').st_allocated_effort, 0);
assert.equal(resultFor(independentAverages, 2, 'ST').st_allocated_effort, 2);
assert.equal(resultFor(independentAverages, 3, 'ST').st_allocated_effort, 2);
assert.equal(resultFor(independentAverages, 4, 'ST').st_allocated_effort, 2);
assert.equal(resultFor(independentAverages, 5, 'ST').st_allocated_effort, 2);

const fractionalFeatures = [feature('FRACTIONAL', 1, 1, { build_estimate_current: 2.25 })];
const fractionalReleases = [release('R-1'), release('R-2')];
const fractionalCapacities = [capacity('T-1', 'R-1', 0.5, 0), capacity('T-1', 'R-2', 1, 0)];
const fractionalAllocation = allocateReal(
  fractionalFeatures,
  [],
  fractionalReleases,
  fractionalCapacities
);
const fractional = generate(
  fractionalFeatures,
  [],
  fractionalReleases,
  fractionalCapacities,
  fractionalAllocation
);
assert.equal(fractional.capacities[0].build_capacity, 0.75);
assert.equal(fractional.releases.length, 1);
assert.deepEqual(
  fractional.releases.map((item) => item.release_name),
  ['TBC 1*']
);
assert.deepEqual(
  fractional.releases.map((item) => [item.start_date, item.end_date]),
  [['2026-01-07', '2026-01-27']]
);
assert.equal(resultFor(fractional, 0, 'FRACTIONAL').build_allocated_effort, 0.75);
assert.equal(fractional.remaining_work[0].build_effort, 0);
assert.equal(fractional.stop_reason, 'all_schedulable_work_allocated');

const missingCapacityReleaseRows = [release('R-1'), release('R-2')];
const missingCapacityFeatures = [feature('MISSING-ROW', 1, 1, { build_estimate_current: 5 })];
const missingCapacityRows = [capacity('T-1', 'R-1', 2, 0)];
const missingCapacityRowsAllocation = allocateReal(
  missingCapacityFeatures,
  [],
  missingCapacityReleaseRows,
  missingCapacityRows
);
const missingCapacityRowsResult = generate(
  missingCapacityFeatures,
  [],
  missingCapacityReleaseRows,
  missingCapacityRows,
  missingCapacityRowsAllocation
);
assert.equal(missingCapacityRowsResult.capacities[0].build_capacity, 1);
assert.equal(missingCapacityRowsResult.releases.length, 3);

const oneReleaseFeatures = [feature('ONE-TBC', 1, 1, { build_estimate_current: 3 })];
const oneReleaseAllocation = allocateReal(
  oneReleaseFeatures,
  [],
  [release('R-1')],
  [capacity('T-1', 'R-1', 1, 0)]
);
const oneTbc = generate(
  oneReleaseFeatures,
  [],
  [release('R-1')],
  [capacity('T-1', 'R-1', 1, 0)],
  oneReleaseAllocation
);
assert.equal(oneTbc.releases.length, 2);
assert.equal(resultFor(oneTbc, 0, 'ONE-TBC').build_allocated_effort, 1);
assert.equal(resultFor(oneTbc, 1, 'ONE-TBC').build_allocated_effort, 1);

const proportionalTbcFeatures = [
  feature('PROPORTIONAL-TBC', 1, 1, {
    build_estimate_current: 50,
    st_estimate_current: 20,
  }),
];
const proportionalTbcReleases = [release('R-1'), release('R-2', '2026-01-13')];
const proportionalTbcCapacities = [
  capacity('T-1', 'R-1', 30, 5),
  capacity('T-1', 'R-2', 0, 21),
];
const proportionalTbcRealAllocation = allocateReal(
  proportionalTbcFeatures,
  [],
  proportionalTbcReleases,
  proportionalTbcCapacities
);
assert.deepEqual(
  proportionalTbcRealAllocation.allocations[0].release_allocations.map((entry) => [
    entry.build.allocated_effort,
    entry.st.allocated_effort,
  ]),
  [
    [30, 5],
    [0, 7],
  ]
);
const proportionalTbc = generate(
  proportionalTbcFeatures,
  [],
  proportionalTbcReleases,
  proportionalTbcCapacities,
  proportionalTbcRealAllocation
);
assert.deepEqual(
  proportionalTbc.allocations.map((entry) => {
    const featureAllocation = entry.features.find((featureRow) => featureRow.feature_id === 'PROPORTIONAL-TBC');
    return [featureAllocation.build_allocated_effort, featureAllocation.st_allocated_effort];
  }),
  [
    [15, 6],
    [5, 2],
  ],
  'generated TBC releases apply proportional ST eligibility using cumulative Build allocations'
);
assert.equal(proportionalTbc.remaining_work[0].build_effort, 0);
assert.equal(proportionalTbc.remaining_work[0].st_effort, 0);

const dependencyFeatures = [
  feature('PREDECESSOR', 1, 1, { build_estimate_current: 2 }),
  feature('SUCCESSOR', 2, 2, { build_estimate_current: 2 }),
];
const dependencyEdge = dependency('PREDECESSOR', 'SUCCESSOR');
const dependencyReleases = [release('R-1')];
const dependencyCapacities = [capacity('T-1', 'R-1', 1, 0)];
const dependencyRealAllocation = allocateReal(
  dependencyFeatures,
  [dependencyEdge],
  dependencyReleases,
  dependencyCapacities
);
const dependencyTbc = generate(
  dependencyFeatures,
  [dependencyEdge],
  dependencyReleases,
  dependencyCapacities,
  dependencyRealAllocation
);
assert.equal(dependencyTbc.releases.length, 3);
assert.equal(resultFor(dependencyTbc, 0, 'PREDECESSOR').build_allocated_effort, 1);
assert.equal(resultFor(dependencyTbc, 0, 'SUCCESSOR').build_allocated_effort, 0);
assert.ok(
  resultFor(dependencyTbc, 0, 'SUCCESSOR').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);
assert.equal(resultFor(dependencyTbc, 1, 'PREDECESSOR').build_allocated_effort, 0);
assert.equal(resultFor(dependencyTbc, 1, 'SUCCESSOR').build_allocated_effort, 1);
assert.equal(resultFor(dependencyTbc, 2, 'SUCCESSOR').build_allocated_effort, 1);

const crossTeamFeatures = [
  feature('GLUE-OVERFLOW', 1, 1, {
    team_id: 'GLUE',
    build_estimate_current: 5,
  }),
  feature('IA-OVERFLOW', 1, 2, {
    team_id: 'IA',
    build_estimate_current: 4,
  }),
];
const crossTeamReleases = [release('R-1')];
const crossTeamCapacities = [capacity('GLUE', 'R-1', 2, 0), capacity('IA', 'R-1', 3, 0)];
const crossTeamRealAllocation = allocateReal(
  crossTeamFeatures,
  [],
  crossTeamReleases,
  crossTeamCapacities
);
const crossTeamTbc = generate(
  crossTeamFeatures,
  [],
  crossTeamReleases,
  crossTeamCapacities,
  crossTeamRealAllocation
);
assert.equal(resultFor(crossTeamTbc, 0, 'GLUE-OVERFLOW').build_allocated_effort, 2);
assert.equal(resultFor(crossTeamTbc, 0, 'IA-OVERFLOW').build_allocated_effort, 1);
assert.ok(
  !resultFor(crossTeamTbc, 0, 'IA-OVERFLOW').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  ),
  'incomplete TBC work on GLUE does not block IA capacity in the same generated release'
);
assert.equal(resultFor(crossTeamTbc, 1, 'GLUE-OVERFLOW').build_allocated_effort, 1);
assert.equal(crossTeamTbc.remaining_work[0].build_effort, 0);

const hardBlockFeatures = [
  feature('HARD-PREDECESSOR', 0, 1, { build_estimate_current: 0 }),
  feature('BLOCKED-HIGH', 1, 2, { build_estimate_current: 4 }),
  feature('LOWER', 2, 3, { build_estimate_current: 2 }),
];
const hardDependencies = [
  dependency('HARD-PREDECESSOR', 'BLOCKED-HIGH', {
    dependency_type: 'Hard',
    affected_activity: 'Build',
    blocking_pct: 100,
  }),
];
const hardReleases = [release('R-1')];
const hardCapacities = [capacity('T-1', 'R-1', 4, 0)];
const hardRealAllocation = allocateReal(
  hardBlockFeatures,
  hardDependencies,
  hardReleases,
  hardCapacities
);
const blockedTbc = generate(
  hardBlockFeatures,
  hardDependencies,
  hardReleases,
  hardCapacities,
  hardRealAllocation
);
assert.equal(blockedTbc.releases.length, 0);
assert.equal(blockedTbc.stop_reason, 'no_progress');
assert.equal(blockedTbc.unresolved_blockers[0].feature_id, 'BLOCKED-HIGH');
assert.equal(blockedTbc.unresolved_blockers[0].blocked_effort, 4);

const noDate = generate(
  oneReleaseFeatures,
  [],
  [{ release_id: 'R-1' }],
  [capacity('T-1', 'R-1', 1, 0)],
  oneReleaseAllocation
);
assert.equal(noDate.stop_reason, 'missing_real_release_end_date');
assert.equal(noDate.releases.length, 0);

const deterministicInput = deepFreeze({
  features: [feature('IMMUTABLE', 1, 1, { build_estimate_current: 2 })],
  dependencies: [],
  releases: [release('R-1')],
  capacities: [capacity('T-1', 'R-1', 1, 0)],
});
const deterministicAllocation = allocateReal(
  deterministicInput.features,
  deterministicInput.dependencies,
  deterministicInput.releases,
  deterministicInput.capacities
);
const deterministicFirst = generate(
  deterministicInput.features,
  deterministicInput.dependencies,
  deterministicInput.releases,
  deterministicInput.capacities,
  deterministicAllocation
);
const deterministicSecond = generate(
  deterministicInput.features,
  deterministicInput.dependencies,
  deterministicInput.releases,
  deterministicInput.capacities,
  deterministicAllocation
);
assert.deepEqual(deterministicFirst, deterministicSecond);
assert.equal(deterministicInput.features[0].build_estimate_current, 2);
assert.equal(deterministicInput.capacities[0].build_capacity, 1);

assert.throws(
  () =>
    generate(
      [feature('PRED', 1, 1), feature('DEPENDENT', 2, 2)],
      [dependency('PRED', 'DEPENDENT')],
      [release('R-1')],
      [capacity('T-1', 'R-1', 1, 0)],
      { allocations: [] }
    ),
  (error) => error instanceof Error && error.code === 'MISSING_FEATURE_ALLOCATION'
);

assert.throws(
  () =>
    generate(
      [feature('PRED', 2, 1), feature('DEPENDENT', 1, 2)],
      [dependency('PRED', 'DEPENDENT')],
      [release('R-1')],
      [capacity('T-1', 'R-1', 1, 0)],
      { allocations: [] }
    ),
  (error) => error.code === 'INVALID_DEPENDENCY_PRIORITY'
);

assert.throws(
  () =>
    generate(
      [feature('INVALID-CAP', 1, 1)],
      [],
      [release('R-1')],
      [capacity('T-1', 'R-1', -1, 0)],
      allocateReal(
        [feature('INVALID-CAP', 1, 1)],
        [],
        [release('R-1')],
        [capacity('T-1', 'R-1', 0, 0)]
      )
    ),
  (error) => error instanceof TbcGenerationError && error.code === 'INVALID_CAPACITY'
);

console.log('TBC release generation verification passed.');
