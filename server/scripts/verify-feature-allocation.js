'use strict';

const assert = require('node:assert/strict');
const { DependencyGraphError } = require('../src/planning/dependencyGraph');
const { allocateFeatureEffort } = require('../src/planning/featureAllocation');

function feature(featureId, priority, inputOrder, overrides = {}) {
  return {
    feature_id: featureId,
    release_id: 'R-1',
    team_id: 'T-1',
    priority,
    input_order: inputOrder,
    build_estimate_current: 10,
    build_original_estimate: 12,
    build_actual_spent: 0,
    st_estimate_current: 5,
    st_original_estimate: 6,
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

function capacity(teamId = 'T-1', releaseId = 'R-1', build = 100, st = 100) {
  return { team_id: teamId, release_id: releaseId, build_capacity: build, st_capacity: st };
}

function allocate(
  features,
  dependencies = [],
  capacities = [capacity()],
  releases = [{ release_id: 'R-1' }]
) {
  const preparedReleases = releases.map((release) =>
    release.start_date && release.end_date
      ? release
      : { ...release, start_date: '2026-01-01', end_date: '2026-12-31' }
  );
  return allocateFeatureEffort({ features, dependencies, releases: preparedReleases, capacities });
}

function allocationFor(result, featureId) {
  return result.allocations.find((allocation) => allocation.feature_id === featureId);
}

function assertNonNegativeCapacities(result) {
  for (const capacitySummary of result.capacity_summary) {
    assert.ok(capacitySummary.build.capacity_remaining >= 0);
    assert.ok(capacitySummary.st.capacity_remaining >= 0);
    assert.ok(capacitySummary.build.capacity_consumed <= capacitySummary.build.available_capacity);
    assert.ok(capacitySummary.st.capacity_consumed <= capacitySummary.st.available_capacity);
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const oneFeature = allocate(
  [
    feature('F-1', 1, 1, {
      build_estimate_current: 0,
      build_original_estimate: 0,
      st_estimate_current: 10,
      st_original_estimate: 10,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 8, 12)]
);
assert.equal(allocationFor(oneFeature, 'F-1').build.allocated_effort, 0);
assert.equal(allocationFor(oneFeature, 'F-1').st.allocated_effort, 10);
assert.equal(oneFeature.capacity_summary[0].st.capacity_remaining, 2);

const aggregateBuildCapacityExceedsReleaseDays = allocate(
  [
    feature('AGGREGATE-TEAM-CAPACITY', 1, 1, {
      build_estimate_current: 60,
      build_original_estimate: 60,
      st_estimate_current: 0,
      st_original_estimate: 0,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 60, 0)],
  [{ release_id: 'R-1', start_date: '2026-11-02', end_date: '2026-11-03' }]
);
assert.equal(
  allocationFor(aggregateBuildCapacityExceedsReleaseDays, 'AGGREGATE-TEAM-CAPACITY').build
    .allocated_effort,
  60,
  'aggregate team Build capacity is not capped by the two-day visual release window'
);
const aggregateStCapacityExceedsReleaseDays = allocate(
  [
    feature('AGGREGATE-ST-CAPACITY', 1, 1, {
      build_estimate_current: 0,
      build_original_estimate: 0,
      st_estimate_current: 40,
      st_original_estimate: 40,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 0, 40)],
  [{ release_id: 'R-1', start_date: '2026-11-02', end_date: '2026-11-03' }]
);
assert.equal(
  allocationFor(aggregateStCapacityExceedsReleaseDays, 'AGGREGATE-ST-CAPACITY').st.allocated_effort,
  40,
  'aggregate team ST capacity is not capped by the two-day visual release window'
);

const competing = allocate(
  [
    feature('LOW', 2, 1, { build_estimate_current: 10, st_estimate_current: 0 }),
    feature('HIGH', 1, 1, { build_estimate_current: 15, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 10, 0)]
);
assert.deepEqual(competing.feature_order, ['HIGH', 'LOW']);
assert.equal(allocationFor(competing, 'HIGH').build.allocated_effort, 10);
assert.equal(allocationFor(competing, 'HIGH').build.remaining_effort_after_allocation, 5);
assert.equal(allocationFor(competing, 'LOW').build.allocated_effort, 0);
assert.ok(
  allocationFor(competing, 'LOW').incomplete_reasons.includes('higher_priority_feature_incomplete')
);
assert.equal(competing.capacity_summary[0].build.capacity_remaining, 0);

const numericPriority = allocate(
  [
    feature('P-3', 3, 1, { build_estimate_current: 2, st_estimate_current: 0 }),
    feature('P-1', 1, 1, { build_estimate_current: 2, st_estimate_current: 0 }),
    feature('P-2', 2, 1, { build_estimate_current: 2, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 6, 0)]
);
assert.deepEqual(numericPriority.feature_order, ['P-1', 'P-2', 'P-3']);

const equalPriority = allocate(
  [
    feature('SECOND', 1, 2, { build_estimate_current: 4, st_estimate_current: 0 }),
    feature('FIRST', 1, 1, { build_estimate_current: 4, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 6, 0)]
);
assert.deepEqual(equalPriority.feature_order, ['FIRST', 'SECOND']);
assert.equal(allocationFor(equalPriority, 'FIRST').build.allocated_effort, 4);
assert.equal(allocationFor(equalPriority, 'SECOND').build.allocated_effort, 2);

const highConsumesBudget = allocate(
  [
    feature('HIGH', 1, 1, { build_estimate_current: 8, st_estimate_current: 0 }),
    feature('LOW', 2, 1, { build_estimate_current: 8, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 8, 0)]
);
assert.equal(allocationFor(highConsumesBudget, 'HIGH').build.allocated_effort, 8);
assert.equal(allocationFor(highConsumesBudget, 'LOW').build.allocated_effort, 0);

const partial = allocate(
  [feature('PARTIAL', 1, 1, { build_estimate_current: 12, st_estimate_current: 0 })],
  [],
  [capacity('T-1', 'R-1', 5, 0)]
);
assert.equal(allocationFor(partial, 'PARTIAL').build.requested_remaining_effort, 12);
assert.equal(allocationFor(partial, 'PARTIAL').build.allocated_effort, 5);
assert.equal(allocationFor(partial, 'PARTIAL').build.remaining_effort_after_allocation, 7);

const dependencyOrder = allocate(
  [
    feature('DEPENDENT', 2, 1, { build_estimate_current: 5, st_estimate_current: 0 }),
    feature('PREDECESSOR', 1, 1, { build_estimate_current: 5, st_estimate_current: 0 }),
  ],
  [dependency('NORMAL', 'PREDECESSOR', 'DEPENDENT')],
  [capacity('T-1', 'R-1', 5, 0)]
);
assert.deepEqual(dependencyOrder.feature_order, ['PREDECESSOR', 'DEPENDENT']);
assert.equal(allocationFor(dependencyOrder, 'PREDECESSOR').build.allocated_effort, 5);
assert.equal(allocationFor(dependencyOrder, 'DEPENDENT').build.allocated_effort, 0);

const normalDoesNotBlock = allocate(
  [
    feature('PREDECESSOR', 1, 1, { build_estimate_current: 0, st_estimate_current: 0 }),
    feature('DEPENDENT', 2, 1, { build_estimate_current: 8, st_estimate_current: 0 }),
  ],
  [dependency('NORMAL', 'PREDECESSOR', 'DEPENDENT')],
  [capacity('T-1', 'R-1', 8, 0)]
);
assert.equal(allocationFor(normalDoesNotBlock, 'DEPENDENT').build.blocked_effort, 0);
assert.equal(allocationFor(normalDoesNotBlock, 'DEPENDENT').build.allocated_effort, 8);

const hardBlocked = allocate(
  [
    feature('PRED', 1, 1, { build_estimate_current: 0, st_estimate_current: 0 }),
    feature('TARGET', 2, 1, { build_estimate_current: 100, st_estimate_current: 50 }),
  ],
  [
    dependency('HARD-UNRESOLVED', 'PRED', 'TARGET', {
      dependency_type: 'Hard',
      dependency_status: 'Unresolved',
      affected_activity: 'Build',
      blocking_pct: 25,
    }),
  ],
  [capacity('T-1', 'R-1', 100, 50)]
);
const hardTarget = allocationFor(hardBlocked, 'TARGET');
assert.equal(hardTarget.build.blocked_effort, 25);
assert.equal(hardTarget.build.allocatable_effort, 75);
assert.equal(hardTarget.build.allocated_effort, 75);
assert.equal(hardTarget.build.remaining_effort_after_allocation, 25);
assert.equal(hardTarget.st.allocated_effort, 50);

const hardResolved = allocate(
  [
    feature('PRED', 1, 1, { build_estimate_current: 0, st_estimate_current: 0 }),
    feature('TARGET', 2, 1),
  ],
  [
    dependency('HARD-RESOLVED', 'PRED', 'TARGET', {
      dependency_type: 'Hard',
      dependency_status: 'Resolved',
      affected_activity: 'Both',
      blocking_pct: 100,
    }),
  ],
  [capacity('T-1', 'R-1', 10, 5)]
);
assert.equal(allocationFor(hardResolved, 'TARGET').build.blocked_effort, 0);

const hardStBlocked = allocate(
  [
    feature('PRED', 1, 1, { build_estimate_current: 0, st_estimate_current: 0 }),
    feature('TARGET', 2, 1, {
      build_estimate_current: 10,
      build_actual_spent: 0,
      st_estimate_current: 10,
    }),
  ],
  [
    dependency('HARD-ST', 'PRED', 'TARGET', {
      dependency_type: 'Hard',
      dependency_status: 'Unresolved',
      affected_activity: 'ST',
      blocking_pct: 30,
    }),
  ],
  [capacity('T-1', 'R-1', 0, 10)]
);
assert.equal(allocationFor(hardStBlocked, 'TARGET').build.blocked_effort, 0);
assert.equal(allocationFor(hardStBlocked, 'TARGET').st.blocked_effort, 3);
assert.equal(allocationFor(hardStBlocked, 'TARGET').st.allocated_effort, 7);

const crossTeamHardDependency = allocate(
  [
    feature('CROSS-TEAM-PRED', 1, 1, {
      team_id: 'GLUE',
      build_estimate_current: 0,
      st_estimate_current: 0,
    }),
    feature('CROSS-TEAM-TARGET', 1, 2, {
      team_id: 'IA',
      build_estimate_current: 10,
      st_estimate_current: 0,
    }),
  ],
  [
    dependency('CROSS-TEAM-HARD', 'CROSS-TEAM-PRED', 'CROSS-TEAM-TARGET', {
      dependency_type: 'Hard',
      affected_activity: 'Build',
      blocking_pct: 50,
    }),
  ],
  [capacity('GLUE', 'R-1', 0, 0), capacity('IA', 'R-1', 5, 0)]
);
assert.deepEqual(crossTeamHardDependency.feature_order, ['CROSS-TEAM-PRED', 'CROSS-TEAM-TARGET']);
assert.equal(allocationFor(crossTeamHardDependency, 'CROSS-TEAM-TARGET').build.blocked_effort, 5);
assert.equal(allocationFor(crossTeamHardDependency, 'CROSS-TEAM-TARGET').build.allocated_effort, 5);
assert.ok(
  allocationFor(crossTeamHardDependency, 'CROSS-TEAM-TARGET').incomplete_reasons.includes(
    'hard_dependency_blocked_build'
  )
);

const crossTeamPriorityIsolation = allocate(
  [
    feature('GLUE-INCOMPLETE', 1, 1, {
      team_id: 'GLUE',
      build_estimate_current: 8,
      st_estimate_current: 0,
    }),
    feature('IA-AVAILABLE', 1, 2, {
      team_id: 'IA',
      build_estimate_current: 4,
      st_estimate_current: 3,
    }),
  ],
  [],
  [capacity('GLUE', 'R-1', 2, 0), capacity('IA', 'R-1', 4, 3)]
);
assert.equal(
  allocationFor(crossTeamPriorityIsolation, 'GLUE-INCOMPLETE').build.allocated_effort,
  2
);
assert.equal(allocationFor(crossTeamPriorityIsolation, 'IA-AVAILABLE').build.allocated_effort, 4);
assert.equal(allocationFor(crossTeamPriorityIsolation, 'IA-AVAILABLE').st.allocated_effort, 3);
assert.ok(
  !allocationFor(crossTeamPriorityIsolation, 'IA-AVAILABLE').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);
assert.deepEqual(
  crossTeamPriorityIsolation.capacity_summary.map(({ team_id, build, st }) => [
    team_id,
    build.capacity_consumed,
    st.capacity_consumed,
  ]),
  [
    ['GLUE', 2, 0],
    ['IA', 4, 3],
  ]
);

const independentCapacity = allocate(
  [
    feature('ST-READY', 1, 1, {
      build_estimate_current: 10,
      build_actual_spent: 10,
      st_estimate_current: 8,
    }),
    feature('BUILD-NEEDED', 2, 1, { build_estimate_current: 10, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 6, 5)]
);
assert.equal(allocationFor(independentCapacity, 'ST-READY').st.allocated_effort, 5);
assert.equal(allocationFor(independentCapacity, 'BUILD-NEEDED').build.allocated_effort, 0);
assert.ok(
  allocationFor(independentCapacity, 'BUILD-NEEDED').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);
assert.equal(independentCapacity.capacity_summary[0].build.capacity_remaining, 6);
assert.equal(independentCapacity.capacity_summary[0].st.capacity_remaining, 0);

const multipleCapacityPools = allocate(
  [
    feature('T1-R1', 1, 1, { build_estimate_current: 6, st_estimate_current: 0 }),
    feature('T2-R1', 1, 2, {
      team_id: 'T-2',
      build_estimate_current: 6,
      st_estimate_current: 0,
    }),
    feature('T1-R2', 1, 3, {
      release_id: 'R-2',
      build_estimate_current: 6,
      st_estimate_current: 0,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 6, 2), capacity('T-2', 'R-1', 3, 8), capacity('T-1', 'R-2', 7, 0)],
  [{ release_id: 'R-1' }, { release_id: 'R-2' }]
);
assert.equal(allocationFor(multipleCapacityPools, 'T1-R1').build.allocated_effort, 6);
assert.equal(allocationFor(multipleCapacityPools, 'T2-R1').build.allocated_effort, 3);
assert.equal(allocationFor(multipleCapacityPools, 'T1-R2').build.allocated_effort, 6);
assertNonNegativeCapacities(multipleCapacityPools);

const missingHigherCapacity = allocate(
  [
    feature('HIGH-NO-CAPACITY', 1, 1, {
      team_id: 'T-2',
      build_estimate_current: 4,
      st_estimate_current: 0,
    }),
    feature('LOW-HAS-CAPACITY', 2, 2, { build_estimate_current: 4, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 4, 0)]
);
assert.equal(allocationFor(missingHigherCapacity, 'HIGH-NO-CAPACITY').build.allocated_effort, 0);
assert.ok(
  allocationFor(missingHigherCapacity, 'HIGH-NO-CAPACITY').incomplete_reasons.includes(
    'capacity_record_missing'
  )
);
assert.equal(
  allocationFor(missingHigherCapacity, 'LOW-HAS-CAPACITY').build.allocated_effort,
  4,
  'a missing-capacity GLUE feature does not block IA work in the same release'
);
assert.ok(
  !allocationFor(missingHigherCapacity, 'LOW-HAS-CAPACITY').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);
assert.equal(missingHigherCapacity.capacity_summary[0].build.capacity_remaining, 0);

const unassignedHigher = allocate(
  [
    feature('HIGH-UNASSIGNED', 1, 1, {
      team_id: null,
      build_estimate_current: 4,
      st_estimate_current: 0,
    }),
    feature('LOW-ASSIGNED', 2, 2, { build_estimate_current: 4, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 4, 0)]
);
assert.equal(allocationFor(unassignedHigher, 'HIGH-UNASSIGNED').build.allocated_effort, 0);
assert.ok(
  allocationFor(unassignedHigher, 'HIGH-UNASSIGNED').incomplete_reasons.includes('team_unassigned')
);
assert.equal(
  allocationFor(unassignedHigher, 'LOW-ASSIGNED').build.allocated_effort,
  4,
  'an unassigned feature does not join a team strict-priority pool'
);
assert.ok(
  !allocationFor(unassignedHigher, 'LOW-ASSIGNED').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);

const hardBlockedPriority = allocate(
  [
    feature('HIGH-HARD-BLOCKED', 1, 1, { build_estimate_current: 10, st_estimate_current: 0 }),
    feature('LOW-AFTER-HARD-BLOCK', 2, 2, { build_estimate_current: 4, st_estimate_current: 0 }),
    feature('HARD-PREDECESSOR', 0, 3, {
      build_estimate_current: 0,
      st_estimate_current: 0,
    }),
  ],
  [
    dependency('HARD-BLOCK-PRIORITY', 'HARD-PREDECESSOR', 'HIGH-HARD-BLOCKED', {
      dependency_type: 'Hard',
      affected_activity: 'Build',
      blocking_pct: 100,
    }),
  ],
  [capacity('T-1', 'R-1', 10, 0)]
);
assert.equal(allocationFor(hardBlockedPriority, 'HIGH-HARD-BLOCKED').build.allocated_effort, 0);
assert.ok(
  allocationFor(hardBlockedPriority, 'HIGH-HARD-BLOCKED').incomplete_reasons.includes(
    'hard_dependency_blocked_build'
  )
);
assert.equal(allocationFor(hardBlockedPriority, 'LOW-AFTER-HARD-BLOCK').build.allocated_effort, 0);
assert.ok(
  allocationFor(hardBlockedPriority, 'LOW-AFTER-HARD-BLOCK').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);

const incompleteReleaseIndependent = allocate(
  [
    feature('R1-HIGH', 1, 1, { build_estimate_current: 5, st_estimate_current: 0 }),
    feature('R1-LOW', 2, 2, { build_estimate_current: 5, st_estimate_current: 0 }),
    feature('R2-ONLY', 1, 3, {
      release_id: 'R-2',
      build_estimate_current: 5,
      st_estimate_current: 0,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 2, 0), capacity('T-1', 'R-2', 5, 0)],
  [{ release_id: 'R-1' }, { release_id: 'R-2' }]
);
assert.equal(allocationFor(incompleteReleaseIndependent, 'R1-HIGH').build.allocated_effort, 5);
assert.equal(
  allocationFor(incompleteReleaseIndependent, 'R1-HIGH').release_allocations[0].build
    .allocated_effort,
  2
);
assert.equal(
  allocationFor(incompleteReleaseIndependent, 'R1-HIGH').release_allocations[1].build
    .allocated_effort,
  3
);
assert.equal(allocationFor(incompleteReleaseIndependent, 'R2-ONLY').build.allocated_effort, 2);
assert.equal(allocationFor(incompleteReleaseIndependent, 'R1-LOW').build.allocated_effort, 0);
assert.ok(
  allocationFor(incompleteReleaseIndependent, 'R1-LOW').incomplete_reasons.includes(
    'higher_priority_feature_incomplete'
  )
);

const carriedAcrossReleases = allocate(
  [
    feature('HIGH-CARRY', 1, 1, {
      release_id: '',
      build_estimate_current: 12,
      st_estimate_current: 0,
    }),
    feature('LOW-CARRY', 2, 2, {
      release_id: '',
      build_estimate_current: 4,
      st_estimate_current: 0,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 5, 0), capacity('T-1', 'R-2', 10, 0)],
  [
    { release_id: 'R-2', priority_order: 2, start_date: '2027-01-01' },
    { release_id: 'R-1', priority_order: 1, start_date: '2026-01-01' },
  ]
);
assert.equal(allocationFor(carriedAcrossReleases, 'HIGH-CARRY').build.allocated_effort, 12);
assert.deepEqual(
  allocationFor(carriedAcrossReleases, 'HIGH-CARRY').release_allocations.map((item) => [
    item.release_id,
    item.build.allocated_effort,
  ]),
  [
    ['R-1', 5],
    ['R-2', 7],
  ],
  'release priority_order determines sequence and a feature carries into the next release'
);
assert.deepEqual(
  allocationFor(carriedAcrossReleases, 'LOW-CARRY').release_allocations.map((item) => [
    item.release_id,
    item.build.allocated_effort,
  ]),
  [
    ['R-1', 0],
    ['R-2', 3],
  ],
  'lower-priority work starts only after higher-priority work completes across releases'
);

const configuredReleaseCapacityCompletesBothFeatures = allocate(
  [
    feature('GLUE-HIGH', 1, 1, {
      build_estimate_current: 70,
      st_estimate_current: 40,
    }),
    feature('GLUE-SAMPLE', 2, 2, {
      build_estimate_current: 8,
      st_estimate_current: 3,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 40, 30), capacity('T-1', 'R-2', 40, 30)],
  [
    {
      release_id: 'R-1',
      priority_order: 1,
      start_date: '2026-11-04',
      end_date: '2026-12-18',
    },
    {
      release_id: 'R-2',
      priority_order: 2,
      start_date: '2027-01-06',
      end_date: '2027-02-16',
    },
  ]
);
assert.deepEqual(
  allocationFor(
    configuredReleaseCapacityCompletesBothFeatures,
    'GLUE-HIGH'
  ).release_allocations.map((entry) => [
    entry.release_id,
    entry.build.allocated_effort,
    entry.st.allocated_effort,
  ]),
  [
    ['R-1', 40, 30],
    ['R-2', 30, 10],
  ]
);
assert.deepEqual(
  allocationFor(
    configuredReleaseCapacityCompletesBothFeatures,
    'GLUE-SAMPLE'
  ).release_allocations.map((entry) => [
    entry.release_id,
    entry.build.allocated_effort,
    entry.st.allocated_effort,
  ]),
  [
    ['R-1', 0, 0],
    ['R-2', 8, 3],
  ],
  'remaining aggregate Release 2 Build/ST capacity completes Sample after higher priority work'
);
assert.equal(
  allocationFor(configuredReleaseCapacityCompletesBothFeatures, 'GLUE-SAMPLE').build
    .remaining_effort_after_allocation,
  0
);
assert.equal(
  allocationFor(configuredReleaseCapacityCompletesBothFeatures, 'GLUE-SAMPLE').st
    .remaining_effort_after_allocation,
  0
);

for (const dependencyType of ['Hard', 'Normal']) {
  assert.throws(
    () =>
      allocate(
        [feature('PRED', 2, 1), feature('DEPENDENT', 2, 2)],
        [
          dependency(`EQUAL-${dependencyType}`, 'PRED', 'DEPENDENT', {
            dependency_type: dependencyType,
          }),
        ]
      ),
    (error) =>
      error.name === 'FeatureOrderingError' &&
      error.code === 'INVALID_DEPENDENCY_PRIORITY' &&
      error.message.includes('PRED (team T-1, priority 2)') &&
      error.message.includes('DEPENDENT (team T-1, priority 2)')
  );
  assert.throws(
    () =>
      allocate(
        [feature('PRED', 3, 1), feature('DEPENDENT', 1, 2)],
        [
          dependency(`LOWER-${dependencyType}`, 'PRED', 'DEPENDENT', {
            dependency_type: dependencyType,
          }),
        ]
      ),
    (error) =>
      error.code === 'INVALID_DEPENDENCY_PRIORITY' &&
      error.message.includes('PRED (team T-1, priority 3)') &&
      error.message.includes('DEPENDENT (team T-1, priority 1)')
  );
}

const forecastBuildIncomplete = feature('BUILD-INCOMPLETE', 1, 1, {
  build_estimate_current: 10,
  st_estimate_current: 8,
});
const buildIncompleteForecast = allocate(
  [forecastBuildIncomplete],
  [],
  [capacity('T-1', 'R-1', 10, 8)]
);
assert.equal(allocationFor(buildIncompleteForecast, 'BUILD-INCOMPLETE').build.allocated_effort, 10);
assert.equal(allocationFor(buildIncompleteForecast, 'BUILD-INCOMPLETE').st.allocated_effort, 8);
assert.equal(
  allocationFor(buildIncompleteForecast, 'BUILD-INCOMPLETE').incomplete_reasons.includes(
    'build_incomplete_for_st'
  ),
  false
);
assert.equal(
  allocationFor(buildIncompleteForecast, 'BUILD-INCOMPLETE').build_actual_spent,
  undefined
);
assert.equal(forecastBuildIncomplete.build_actual_spent, 0);
assert.equal(forecastBuildIncomplete.st_actual_spent, 0);

const limitedStCapacityForecast = allocate(
  [
    feature('BUILD-COMPLETE', 1, 1, {
      build_estimate_current: 10,
      build_actual_spent: 0,
      st_estimate_current: 8,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 4, 5)]
);
assert.equal(allocationFor(limitedStCapacityForecast, 'BUILD-COMPLETE').st.allocated_effort, 5);
assert.equal(
  allocationFor(limitedStCapacityForecast, 'BUILD-COMPLETE').st.remaining_effort_after_allocation,
  3
);
assert.ok(
  allocationFor(limitedStCapacityForecast, 'BUILD-COMPLETE').incomplete_reasons.includes(
    'st_capacity_exhausted'
  )
);

const stagedBuildAllocation = allocate(
  [feature('STAGED', 1, 1, { build_estimate_current: 10, st_estimate_current: 8 })],
  [],
  [capacity('T-1', 'R-1', 10, 8)]
);
assert.equal(allocationFor(stagedBuildAllocation, 'STAGED').build.allocated_effort, 10);
assert.equal(allocationFor(stagedBuildAllocation, 'STAGED').st.allocated_effort, 8);
const stagedStAllocation = allocate(
  [
    feature('STAGED', 1, 1, {
      build_estimate_current: 10,
      build_actual_spent: 10,
      st_estimate_current: 8,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 0, 8)]
);
assert.equal(allocationFor(stagedStAllocation, 'STAGED').build.allocated_effort, 0);
assert.equal(allocationFor(stagedStAllocation, 'STAGED').st.allocated_effort, 8);

const zeroCapacity = allocate(
  [feature('NO-CAPACITY', 1, 1, { build_estimate_current: 10, st_estimate_current: 0 })],
  [],
  [capacity('T-1', 'R-1', 0, 0)]
);
assert.equal(allocationFor(zeroCapacity, 'NO-CAPACITY').build.allocated_effort, 0);
assert.equal(zeroCapacity.capacity_summary[0].build.capacity_remaining, 0);

const fractionalCapacity = allocate(
  [
    feature('DECIMAL-A', 1, 1, { build_estimate_current: 0.1, st_estimate_current: 0 }),
    feature('DECIMAL-B', 2, 1, { build_estimate_current: 0.2, st_estimate_current: 0 }),
  ],
  [],
  [capacity('T-1', 'R-1', 0.3, 0)]
);
assertNonNegativeCapacities(fractionalCapacity);
assert.equal(fractionalCapacity.capacity_summary[0].build.capacity_remaining, 0);

const zeroRemaining = allocate(
  [
    feature('DONE', 1, 1, {
      build_estimate_current: 10,
      build_actual_spent: 10,
      st_estimate_current: 5,
      st_actual_spent: 5,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 20, 20)]
);
assert.equal(allocationFor(zeroRemaining, 'DONE').build.allocated_effort, 0);
assert.equal(allocationFor(zeroRemaining, 'DONE').st.allocated_effort, 0);

const unassigned = allocate(
  [
    feature('UNASSIGNED', 1, 1, {
      team_id: null,
      build_estimate_current: 10,
      st_estimate_current: 0,
    }),
  ],
  [],
  [capacity('T-1', 'R-1', 10, 0)]
);
assert.equal(allocationFor(unassigned, 'UNASSIGNED').build.allocated_effort, 0);
assert.ok(allocationFor(unassigned, 'UNASSIGNED').incomplete_reasons.includes('team_unassigned'));

const missingCapacity = allocate(
  [feature('MISSING-CAPACITY', 1, 1, { build_estimate_current: 10, st_estimate_current: 0 })],
  [],
  []
);
assert.ok(
  allocationFor(missingCapacity, 'MISSING-CAPACITY').incomplete_reasons.includes(
    'capacity_record_missing'
  )
);

const immutabilityFeatures = deepFreeze([
  feature('IMMUTABLE', 1, 1, {
    build_estimate_current: 10,
    build_original_estimate: 7,
    build_actual_spent: 2,
    st_estimate_current: 4,
    st_original_estimate: 3,
    st_actual_spent: 1,
  }),
]);
const immutabilityReleases = deepFreeze([
  { release_id: 'R-1', start_date: '2026-01-01', end_date: '2026-12-31' },
]);
const immutabilityCapacities = deepFreeze([capacity('T-1', 'R-1', 5, 2)]);
const immutableResult = allocateFeatureEffort({
  features: immutabilityFeatures,
  dependencies: deepFreeze([]),
  releases: immutabilityReleases,
  capacities: immutabilityCapacities,
});
assert.equal(allocationFor(immutableResult, 'IMMUTABLE').build.allocated_effort, 5);
assert.equal(immutabilityFeatures[0].build_original_estimate, 7);
assert.equal(immutabilityFeatures[0].build_actual_spent, 2);
assert.equal(immutabilityCapacities[0].build_capacity, 5);
assertNonNegativeCapacities(immutableResult);

assert.deepEqual(
  allocate(immutabilityFeatures, [], immutabilityCapacities, immutabilityReleases),
  allocate(immutabilityFeatures, [], immutabilityCapacities, immutabilityReleases)
);

assert.throws(
  () =>
    allocate(
      [feature('A', 1, 1)],
      [dependency('D-CYCLE-1', 'A', 'B'), dependency('D-CYCLE-2', 'B', 'A')]
    ),
  (error) => error instanceof DependencyGraphError && error.code === 'MISSING_FEATURE_REFERENCE'
);
assert.throws(
  () =>
    allocate(
      [feature('A', 1, 1), feature('B', 1, 2)],
      [dependency('D-CYCLE-1', 'A', 'B'), dependency('D-CYCLE-2', 'B', 'A')]
    ),
  (error) => error instanceof DependencyGraphError && error.code === 'DEPENDENCY_CYCLE'
);
assert.equal(
  allocationFor(
    allocate([feature('NO-INPUT-RELEASE', 1, 1, { release_id: '' })]),
    'NO-INPUT-RELEASE'
  ).build.allocated_effort,
  10,
  'feature allocation does not require a release_id input'
);

console.log('Feature allocation verification passed.');
