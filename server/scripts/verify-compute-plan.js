'use strict';

const assert = require('node:assert/strict');
const { PlanComputationError, computePlan } = require('../src/planning/computePlan');

function team(teamId = 'T-1') {
  return { team_id: teamId, team_name: teamId, status: 'Active' };
}

function release(releaseId = 'R-1', endDate = '2026-01-06') {
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

function feature(featureId, priority, inputOrder, overrides = {}) {
  return {
    feature_id: featureId,
    release_id: '',
    feature_name: featureId,
    priority,
    input_order: inputOrder,
    team_id: 'T-1',
    status: 'Planned',
    build_estimate_current: 4,
    build_original_estimate: 4,
    build_actual_spent: 0,
    st_estimate_current: 0,
    st_original_estimate: 0,
    st_actual_spent: 0,
    ...overrides,
  };
}

function story(storyId, featureId, overrides = {}) {
  return {
    story_id: storyId,
    feature_id: featureId,
    story_name: storyId,
    input_order: 1,
    status: 'Planned',
    build_estimate_current: 1,
    build_original_estimate: 1,
    build_actual_spent: 0,
    st_estimate_current: 0,
    st_original_estimate: 0,
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

function capacity(teamId, releaseId, build, st) {
  return { team_id: teamId, release_id: releaseId, build_capacity: build, st_capacity: st };
}

function state(overrides = {}) {
  return {
    teams: [team()],
    releases: [release()],
    features: [feature('F-1', 1, 1)],
    stories: [story('S-1', 'F-1')],
    dependencies: [],
    capacities: [capacity('T-1', 'R-1', 4, 0)],
    config: { SPRINT_CADENCE: '2x15+5' },
    ...overrides,
  };
}

function expectPlanError(input, code, stage = undefined) {
  assert.throws(
    () => computePlan(input),
    (error) =>
      error instanceof PlanComputationError &&
      error.code === code &&
      (!stage || error.stage === stage)
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const minimal = computePlan(state());
assert.deepEqual(minimal.feature_order, ['F-1']);
assert.equal(minimal.schedule[0].feature_name, 'F-1');
assert.equal(minimal.schedule[0].team_id, 'T-1');
assert.equal(minimal.schedule[0].team_name, 'T-1');
assert.equal(minimal.schedule[0].allocations[0].release_id, 'R-1');
assert.equal(minimal.schedule[0].allocations[0].release_name, 'R-1');
assert.equal(minimal.schedule[0].stories[0].story_id, 'S-1');
assert.equal(minimal.real_allocation.allocations[0].build.allocated_effort, 4);
assert.equal(minimal.tbc_generation.stop_reason, 'no_remaining_work');
assert.deepEqual(minimal.unresolvable_blockers, []);
assert.deepEqual(minimal.no_progress_reasons, []);

const teamAwarePlan = computePlan(
  state({
    teams: [
      { team_id: 'GLUE-ID', team_name: 'GLUE', status: 'Active' },
      { team_id: 'IA-ID', team_name: 'IA', status: 'Active' },
    ],
    releases: [release('R-GLUE'), release('R-IA', '2026-02-03')],
    features: [
      feature('FEATURE-GLUE', 1, 1, {
        feature_name: 'Feature 1',
        release_id: 'R-GLUE',
        team_id: 'GLUE-ID',
        build_estimate_current: 20,
        st_estimate_current: 15,
      }),
      feature('FEATURE-IA', 1, 2, {
        feature_name: 'Feature 2',
        release_id: 'R-IA',
        team_id: 'IA-ID',
        build_estimate_current: 20,
        st_estimate_current: 15,
      }),
    ],
    stories: [],
    capacities: [capacity('GLUE-ID', 'R-GLUE', 20, 15), capacity('IA-ID', 'R-IA', 10, 5)],
  })
);
const glueSchedule = teamAwarePlan.schedule.find((item) => item.feature_id === 'FEATURE-GLUE');
const iaSchedule = teamAwarePlan.schedule.find((item) => item.feature_id === 'FEATURE-IA');
assert.equal(glueSchedule.feature_name, 'Feature 1');
assert.equal(glueSchedule.team_id, 'GLUE-ID');
assert.equal(glueSchedule.team_name, 'GLUE');
assert.equal(iaSchedule.feature_name, 'Feature 2');
assert.equal(iaSchedule.team_id, 'IA-ID');
assert.equal(iaSchedule.team_name, 'IA');
assert.equal(glueSchedule.allocations[0].build.allocated_effort, 20);
assert.equal(glueSchedule.allocations[0].st.allocated_effort, 15);
assert.equal(iaSchedule.allocations[1].build.allocated_effort, 10);
assert.equal(iaSchedule.allocations[1].st.allocated_effort, 5);
assert.deepEqual(
  teamAwarePlan.real_allocation.capacity_summary.map((item) => [
    item.team_id,
    item.release_id,
    item.build.capacity_consumed,
    item.st.capacity_consumed,
  ]),
  [
    ['GLUE-ID', 'R-GLUE', 20, 15],
    ['IA-ID', 'R-IA', 10, 5],
  ]
);
const firstTbcCapacities = teamAwarePlan.tbc_generation.capacities.filter(
  (item) => item.release_id === 'TBC-GEN-001'
);
assert.deepEqual(
  firstTbcCapacities.map((item) => [item.team_id, item.build_capacity, item.st_capacity]),
  [
    ['GLUE-ID', 10, 7.5],
    ['IA-ID', 5, 2.5],
  ]
);
const iaTbcAllocations = teamAwarePlan.tbc_generation.allocations.map((sprint) =>
  sprint.features.find((item) => item.feature_id === 'FEATURE-IA')
);
assert.ok(iaTbcAllocations.every((item) => item.team_id === 'IA-ID'));
assert.equal(
  iaTbcAllocations.reduce((sum, item) => sum + item.build_allocated_effort, 0),
  10
);
assert.equal(
  iaTbcAllocations.reduce((sum, item) => sum + item.st_allocated_effort, 0),
  10
);

const glueReleaseCapacityPlan = computePlan(
  state({
    teams: [team('GLUE')],
    releases: [
      {
        ...release('R-1', '2026-12-18'),
        start_date: '2026-11-04',
        priority_order: 1,
      },
      {
        ...release('R-2', '2027-02-16'),
        start_date: '2027-01-06',
        priority_order: 2,
      },
    ],
    features: [
      feature('GLUE-HIGH', 1, 1, {
        team_id: 'GLUE',
        build_estimate_current: 70,
        st_estimate_current: 40,
      }),
      feature('GLUE-SAMPLE', 2, 2, {
        team_id: 'GLUE',
        build_estimate_current: 8,
        st_estimate_current: 3,
      }),
    ],
    stories: [],
    capacities: [capacity('GLUE', 'R-1', 40, 30), capacity('GLUE', 'R-2', 40, 30)],
  })
);
const samplePlan = glueReleaseCapacityPlan.schedule.find(
  (item) => item.feature_id === 'GLUE-SAMPLE'
);
assert.deepEqual(
  samplePlan.allocations.map((item) => [
    item.release_id,
    item.build.allocated_effort,
    item.st.allocated_effort,
  ]),
  [
    ['R-1', 0, 0],
    ['R-2', 8, 3],
  ]
);
assert.equal(glueReleaseCapacityPlan.tbc_generation.releases.length, 0);

const missingTeamCapacityPlan = computePlan(
  state({
    teams: [
      { team_id: 'GLUE-ID', team_name: 'GLUE', status: 'Active' },
      { team_id: 'IA-ID', team_name: 'IA', status: 'Active' },
    ],
    features: [
      feature('IA-MISSING-CAPACITY', 1, 1, {
        team_id: 'IA-ID',
        build_estimate_current: 4,
      }),
    ],
    stories: [],
    capacities: [capacity('GLUE-ID', 'R-1', 20, 20)],
  })
);
const missingTeamAllocation = missingTeamCapacityPlan.real_allocation.allocations[0];
assert.equal(missingTeamAllocation.team_id, 'IA-ID');
assert.equal(missingTeamAllocation.build.allocated_effort, 0);
assert.ok(missingTeamAllocation.incomplete_reasons.includes('capacity_record_missing'));
assert.ok(
  missingTeamCapacityPlan.tbc_generation.capacities.every((item) => item.team_id !== 'IA-ID')
);

const multipleReleases = computePlan(
  state({
    releases: [
      { ...release('R-2', '2026-02-03'), priority_order: 2 },
      { ...release('R-1'), priority_order: 1 },
    ],
    features: [
      feature('R1-HIGH', 1, 1, { build_estimate_current: 5 }),
      feature('R1-LOW', 2, 2, { build_estimate_current: 1 }),
      feature('R2-ONLY', 1, 3, { release_id: '', build_estimate_current: 2 }),
    ],
    stories: [story('S-R1', 'R1-HIGH'), story('S-R2', 'R2-ONLY')],
    capacities: [capacity('T-1', 'R-1', 2, 0), capacity('T-1', 'R-2', 2, 0)],
  })
);
const multiReleaseHigh = multipleReleases.real_allocation.allocations.find(
  (item) => item.feature_id === 'R1-HIGH'
);
assert.equal(multiReleaseHigh.build.allocated_effort, 4);
assert.deepEqual(
  multiReleaseHigh.release_allocations.map((item) => [
    item.release_id,
    item.build.allocated_effort,
  ]),
  [
    ['R-1', 2],
    ['R-2', 2],
  ]
);
assert.equal(
  multipleReleases.real_allocation.allocations.find((item) => item.feature_id === 'R1-LOW').build
    .allocated_effort,
  0
);
assert.ok(
  multipleReleases.real_allocation.allocations
    .find((item) => item.feature_id === 'R1-LOW')
    .incomplete_reasons.includes('higher_priority_feature_incomplete')
);
assert.equal(
  multipleReleases.real_allocation.allocations.find((item) => item.feature_id === 'R2-ONLY').build
    .allocated_effort,
  0
);

const validDependency = computePlan(
  state({
    features: [
      feature('SUCCESSOR', 2, 2, { build_estimate_current: 2 }),
      feature('PREDECESSOR', 1, 1, { build_estimate_current: 2 }),
    ],
    stories: [],
    dependencies: [dependency('D-VALID', 'PREDECESSOR', 'SUCCESSOR')],
    capacities: [capacity('T-1', 'R-1', 2, 0)],
  })
);
assert.deepEqual(validDependency.feature_order, ['PREDECESSOR', 'SUCCESSOR']);
assert.equal(validDependency.real_allocation.allocations[0].feature_id, 'PREDECESSOR');
assert.equal(validDependency.real_allocation.allocations[0].build.allocated_effort, 2);
assert.equal(validDependency.real_allocation.allocations[1].build.allocated_effort, 0);

for (const dependencyType of ['Hard', 'Normal']) {
  for (const [predPriority, dependentPriority] of [
    [2, 2],
    [3, 1],
  ]) {
    expectPlanError(
      state({
        features: [
          feature('PREDECESSOR', predPriority, 1),
          feature('SUCCESSOR', dependentPriority, 2),
        ],
        stories: [],
        dependencies: [
          dependency('D-INVALID-PRIORITY', 'PREDECESSOR', 'SUCCESSOR', {
            dependency_type: dependencyType,
            affected_activity: dependencyType === 'Hard' ? 'Build' : null,
            blocking_pct: dependencyType === 'Hard' ? 10 : null,
          }),
        ],
      }),
      'INVALID_DEPENDENCY_PRIORITY',
      'dependency ordering validation'
    );
  }
}

const hardDependencyPlan = computePlan(
  state({
    features: [
      feature('HARD-PRED', 0, 1, { build_estimate_current: 0 }),
      feature('HARD-TARGET', 1, 2, { build_estimate_current: 4 }),
      feature('LOWER', 2, 3, { build_estimate_current: 2 }),
    ],
    stories: [],
    dependencies: [
      dependency('D-HARD', 'HARD-PRED', 'HARD-TARGET', {
        dependency_type: 'Hard',
        affected_activity: 'Build',
        blocking_pct: 50,
      }),
    ],
    capacities: [capacity('T-1', 'R-1', 8, 0)],
  })
);
const hardTargetAllocation = hardDependencyPlan.real_allocation.allocations.find(
  (item) => item.feature_id === 'HARD-TARGET'
);
assert.equal(hardTargetAllocation.build.blocked_effort, 2);
assert.equal(hardTargetAllocation.build.allocated_effort, 2);
assert.equal(
  hardDependencyPlan.real_allocation.allocations.find((item) => item.feature_id === 'LOWER').build
    .allocated_effort,
  0
);
assert.equal(hardDependencyPlan.unresolvable_blockers[0].blocked_effort, 2);

const normalDependencyPlan = computePlan(
  state({
    features: [
      feature('NORMAL-PRED', 1, 1, { build_estimate_current: 2 }),
      feature('NORMAL-TARGET', 2, 2, { build_estimate_current: 2 }),
    ],
    stories: [],
    dependencies: [dependency('D-NORMAL', 'NORMAL-PRED', 'NORMAL-TARGET')],
    capacities: [capacity('T-1', 'R-1', 4, 0)],
  })
);
assert.equal(
  normalDependencyPlan.real_allocation.allocations.find(
    (item) => item.feature_id === 'NORMAL-TARGET'
  ).build.blocked_effort,
  0
);
assert.equal(
  normalDependencyPlan.real_allocation.allocations.find(
    (item) => item.feature_id === 'NORMAL-TARGET'
  ).build.allocated_effort,
  2
);

const stForecast = computePlan(
  state({
    features: [feature('ST-FORECAST', 1, 1, { build_estimate_current: 5, st_estimate_current: 3 })],
    stories: [],
    capacities: [capacity('T-1', 'R-1', 5, 3)],
  })
);
const stForecastAllocation = stForecast.real_allocation.allocations.find(
  (item) => item.feature_id === 'ST-FORECAST'
);
assert.equal(stForecastAllocation.build.allocated_effort, 5);
assert.equal(stForecastAllocation.st.allocated_effort, 3);
assert.equal(stForecastAllocation.incomplete_reasons.includes('build_incomplete_for_st'), false);

const tbcPlan = computePlan(
  state({
    features: [feature('TBC-WORK', 1, 1, { build_estimate_current: 3 })],
    stories: [],
    capacities: [capacity('T-1', 'R-1', 1, 0)],
  })
);
assert.equal(tbcPlan.tbc_generation.releases.length, 2);
assert.equal(
  tbcPlan.schedule[0].allocations.filter((item) => item.release_type === 'TBC').length,
  2
);
assert.equal(tbcPlan.schedule[0].allocations[1].release_name, 'TBC 1*');
assert.equal(tbcPlan.tbc_generation.stop_reason, 'all_schedulable_work_allocated');

const blockedNoProgress = computePlan(
  state({
    features: [
      feature('BLOCKER-PRED', 0, 1, { build_estimate_current: 0 }),
      feature('BLOCKED', 1, 2, { build_estimate_current: 4 }),
      feature('LOWER', 2, 3, { build_estimate_current: 1 }),
    ],
    stories: [],
    dependencies: [
      dependency('D-BLOCKER', 'BLOCKER-PRED', 'BLOCKED', {
        dependency_type: 'Hard',
        affected_activity: 'Build',
        blocking_pct: 100,
      }),
    ],
    capacities: [capacity('T-1', 'R-1', 4, 0)],
  })
);
assert.equal(blockedNoProgress.tbc_generation.releases.length, 0);
assert.equal(blockedNoProgress.tbc_generation.stop_reason, 'no_progress');
assert.equal(blockedNoProgress.unresolvable_blockers[0].feature_id, 'BLOCKED');
assert.equal(blockedNoProgress.no_progress_reasons[0].code, 'no_progress');

expectPlanError(
  state({
    dependencies: [dependency('D-MISSING', 'MISSING', 'F-1')],
  }),
  'MISSING_FEATURE_REFERENCE',
  'dependency graph validation'
);
expectPlanError(
  state({
    features: [feature('A', 1, 1), feature('B', 2, 2), feature('C', 3, 3)],
    stories: [],
    dependencies: [
      dependency('D-AB', 'A', 'B'),
      dependency('D-BC', 'B', 'C'),
      dependency('D-CA', 'C', 'A'),
    ],
  }),
  'DEPENDENCY_CYCLE',
  'dependency graph validation'
);
expectPlanError(
  state({ features: [feature('BAD-TEAM', 1, 1, { team_id: 'MISSING' })] }),
  'MISSING_TEAM_REFERENCE'
);
expectPlanError(state({ stories: [story('BAD-STORY', 'MISSING')] }), 'MISSING_FEATURE_REFERENCE');
expectPlanError(
  state({ capacities: [capacity('MISSING', 'R-1', 1, 1)] }),
  'MISSING_TEAM_REFERENCE'
);
expectPlanError({ ...state(), config: null }, 'INVALID_STATE_FIELD');
expectPlanError({ ...state(), capacities: undefined }, 'INVALID_STATE_FIELD');

const repeatInput = state({
  features: [feature('IMMUTABLE', 1, 1, { build_estimate_current: 3 })],
  stories: [story('IMMUTABLE-STORY', 'IMMUTABLE')],
  capacities: [capacity('T-1', 'R-1', 1, 0)],
});
deepFreeze(repeatInput);
const firstPlan = computePlan(repeatInput);
const secondPlan = computePlan(repeatInput);
assert.deepEqual(firstPlan, secondPlan);
assert.equal(repeatInput.features[0].build_estimate_current, 3);
assert.equal(repeatInput.features[0].build_actual_spent, 0);
assert.equal(repeatInput.stories[0].build_actual_spent, 0);
assert.equal(repeatInput.capacities[0].build_capacity, 1);

console.log('computePlan verification passed.');
