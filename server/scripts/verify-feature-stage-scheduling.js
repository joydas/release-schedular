'use strict';

const assert = require('node:assert/strict');
const {
  STORY_POINTS_PER_WORKDAY,
  scheduleFeatureStages,
} = require('../src/planning/featureStageScheduling');

function stage(allocated, remaining = 0, blocked = 0) {
  return {
    requested_remaining_effort: allocated + remaining,
    allocated_effort: allocated,
    remaining_effort_after_allocation: remaining,
    blocked_effort: blocked,
  };
}

function feature(featureId, priority, inputOrder, allocation, overrides = {}) {
  return {
    feature_id: featureId,
    feature_name: `Feature ${featureId}`,
    team_id: 'T-1',
    priority,
    input_order: inputOrder,
    allocations: [allocation],
    ...overrides,
  };
}

function realAllocation(releaseId, build, st, extras = {}) {
  return {
    release_id: releaseId,
    release_name: releaseId,
    release_type: 'Real',
    build: stage(build, extras.buildRemaining || 0, extras.buildBlocked || 0),
    st: stage(st, extras.stRemaining || 0, extras.stBlocked || 0),
    incomplete_reasons: extras.reasons || [],
  };
}

function plan(schedule, tbcReleases = [], tbcCapacities = []) {
  return {
    schedule,
    tbc_generation: { releases: tbcReleases, capacities: tbcCapacities },
  };
}

function capacity(releaseId, build, st) {
  return { team_id: 'T-1', release_id: releaseId, build_capacity: build, st_capacity: st };
}

function schedule(inputPlan, releases, capacities) {
  return scheduleFeatureStages(inputPlan, { releases, capacities });
}

const release = (id, start = '2026-11-02', end = '2026-12-04') => ({
  release_id: id,
  release_name: `Release ${id}`,
  start_date: start,
  end_date: end,
});

assert.equal(STORY_POINTS_PER_WORKDAY, 1);

const fourteenAndSeven = plan([feature('F-14-7', 1, 1, realAllocation('R-1', 14, 7))]);
const fourteenSnapshot = JSON.stringify(fourteenAndSeven);
const fourteenCapacities = [capacity('R-1', 14, 7)];
const fourteenCapacitySnapshot = JSON.stringify(fourteenCapacities);
const fourteenResult = schedule(fourteenAndSeven, [release('R-1')], fourteenCapacities);
const fourteenFeature = fourteenResult.releases[0].features[0];
assert.equal(fourteenFeature.build.allocated_sp, 14);
assert.equal(fourteenFeature.build.scheduled_sp, 14);
assert.equal(fourteenFeature.build.unscheduled_sp, 0);
assert.equal(fourteenFeature.build.effort_duration_workdays, 14);
assert.equal(fourteenFeature.st.allocated_sp, 7);
assert.equal(fourteenFeature.st.effort_duration_workdays, 7);
assert.equal(fourteenFeature.st.visual_duration_workdays, 14);
assert.equal(fourteenFeature.st.start_date, fourteenFeature.build.start_date);
assert.equal(fourteenFeature.st.end_date, fourteenFeature.build.end_date);
assert.equal(fourteenFeature.status, 'scheduled');
assert.equal(fourteenFeature.required_effort_sp.total, 21);
assert.deepEqual(fourteenFeature.overall_required_effort_sp, { build: 14, st: 7, total: 21 });
assert.equal(fourteenFeature.allocation_percent, 100);
assert.equal(JSON.stringify(fourteenAndSeven), fourteenSnapshot);
assert.equal(JSON.stringify(fourteenCapacities), fourteenCapacitySnapshot);

const crossTeamDependencyOrder = schedule(
  plan([
    feature('CROSS-PRED', 9, 2, realAllocation('R-1', 1, 0), { team_id: 'GLUE' }),
    feature('CROSS-DEPENDENT', 1, 1, realAllocation('R-1', 1, 0), { team_id: 'IA' }),
  ]),
  [release('R-1')],
  [
    { team_id: 'GLUE', release_id: 'R-1', build_capacity: 1, st_capacity: 0 },
    { team_id: 'IA', release_id: 'R-1', build_capacity: 1, st_capacity: 0 },
  ]
).releases[0];
assert.deepEqual(
  crossTeamDependencyOrder.features.map((featureRow) => featureRow.feature_id),
  ['CROSS-PRED', 'CROSS-DEPENDENT'],
  'timeline projection preserves the dependency-aware PlanResult order across teams'
);

const independentTeamTimelines = schedule(
  plan([
    feature('TEAM-GLUE', 1, 1, realAllocation('R-1', 10, 0), { team_id: 'GLUE' }),
    feature('TEAM-IA', 2, 2, realAllocation('R-1', 2, 1), { team_id: 'IA' }),
  ]),
  [release('R-1', '2026-11-02', '2026-11-13')],
  [
    { team_id: 'GLUE', release_id: 'R-1', build_capacity: 10, st_capacity: 0 },
    { team_id: 'IA', release_id: 'R-1', build_capacity: 2, st_capacity: 1 },
  ]
).releases[0].features;
const glueTimeline = independentTeamTimelines.find((featureRow) => featureRow.team_id === 'GLUE');
const iaTimeline = independentTeamTimelines.find((featureRow) => featureRow.team_id === 'IA');
assert.equal(glueTimeline.build.end_date, '2026-11-13');
assert.equal(iaTimeline.build.start_date, '2026-11-02');
assert.equal(iaTimeline.st.start_date, '2026-11-02');
assert.equal(iaTimeline.status, 'scheduled');

const aggregateTeamCapacitySchedule = schedule(
  plan([
    feature(
      'GLUE-HIGH-R2',
      1,
      1,
      realAllocation('R-2', 30, 10, { buildRemaining: 40, stRemaining: 30 })
    ),
    feature('GLUE-SAMPLE-R2', 2, 2, realAllocation('R-2', 8, 3)),
  ]),
  [release('R-2', '2027-01-06', '2027-02-16')],
  [capacity('R-2', 40, 30)]
).releases[0];
const sampleRelease2Schedule = aggregateTeamCapacitySchedule.features.find(
  (row) => row.feature_id === 'GLUE-SAMPLE-R2'
);
assert.equal(sampleRelease2Schedule.allocated_effort_sp.build, 8);
assert.equal(sampleRelease2Schedule.allocated_effort_sp.st, 3);
assert.equal(sampleRelease2Schedule.status, 'scheduled');
assert.equal(sampleRelease2Schedule.build.scheduled_sp, 8);
assert.equal(sampleRelease2Schedule.st.scheduled_sp, 3);
assert.ok(sampleRelease2Schedule.finish_date <= '2027-02-16');
const highRelease2Schedule = aggregateTeamCapacitySchedule.features.find(
  (row) => row.feature_id === 'GLUE-HIGH-R2'
);
assert.equal(highRelease2Schedule.start_date, sampleRelease2Schedule.start_date);
assert.equal(
  sampleRelease2Schedule.start_date,
  '2027-01-06',
  'same-release features share the release anchor and may run in parallel'
);

const fractional = schedule(
  plan([feature('F-FRACTIONAL', 1, 1, realAllocation('R-1', 0.5, 0.25))]),
  [release('R-1')],
  [capacity('R-1', 0.5, 0.25)]
).releases[0].features[0];
assert.equal(fractional.build.effort_duration_workdays, 0.5);
assert.equal(fractional.st.allocated_sp, 0.25);
assert.equal(fractional.st.visual_duration_workdays, 0.5);
assert.equal(fractional.build.end_date, fractional.st.end_date);

const stLonger = schedule(
  plan([feature('F-ST-LONG', 1, 1, realAllocation('R-1', 3, 5))]),
  [release('R-1')],
  [capacity('R-1', 10, 10)]
).releases[0].features[0];
assert.equal(stLonger.build.end_date, '2026-11-04');
assert.equal(stLonger.st.start_date, stLonger.build.start_date);
assert.equal(stLonger.st.end_date, '2026-11-06');
assert.equal(stLonger.finish_date, stLonger.st.end_date);

const zeroStage = schedule(
  plan([feature('F-ZERO', 1, 1, realAllocation('R-1', 2, 0))]),
  [release('R-1')],
  [capacity('R-1', 2, 0)]
).releases[0].features[0];
assert.equal(zeroStage.st.status, 'not_allocated');
assert.equal(zeroStage.st.start_date, null);
assert.equal(zeroStage.build.allocated_sp, 2);

const partial = schedule(
  plan([
    feature(
      'F-PARTIAL',
      1,
      1,
      realAllocation('R-1', 2, 1, {
        buildRemaining: 3,
        stBlocked: 1,
        reasons: ['build_capacity_exhausted', 'hard_dependency_blocked_st'],
      })
    ),
  ]),
  [release('R-1')],
  [capacity('R-1', 2, 1)]
).releases[0].features[0];
assert.equal(partial.status, 'partial');
assert.equal(partial.build.allocated_sp, 2);
assert.equal(partial.st.allocated_sp, 1);
assert.deepEqual(partial.incomplete_reasons, [
  'build_capacity_exhausted',
  'hard_dependency_blocked_st',
]);

const missingWindow = schedule(
  plan([feature('F-NO-DATE', 1, 1, realAllocation('R-1', 2, 1))]),
  [release('R-1', null, '2026-11-12')],
  [capacity('R-1', 2, 1)]
).releases[0];
assert.equal(missingWindow.window_status, 'invalid');
assert.equal(missingWindow.features[0].status, 'unscheduled');
assert.equal(missingWindow.features[0].build.start_date, null);
assert.ok(missingWindow.features[0].build.reasons.includes('release_window_missing_or_invalid'));

const invalidWindow = schedule(
  plan([feature('F-BAD-DATE', 1, 1, realAllocation('R-1', 1, 0))]),
  [release('R-1', 'not-a-date', '2026-11-12')],
  [capacity('R-1', 1, 0)]
).releases[0];
assert.equal(invalidWindow.window_status, 'invalid');
assert.equal(invalidWindow.features[0].build.status, 'unscheduled');

const shortWindow = schedule(
  plan([feature('F-OVERFLOW', 1, 1, realAllocation('R-1', 4, 0))]),
  [release('R-1', '2026-11-02', '2026-11-04')],
  [capacity('R-1', 4, 0)]
).releases[0].features[0];
assert.equal(shortWindow.status, 'scheduled');
assert.equal(shortWindow.build.allocated_sp, 4);
assert.equal(shortWindow.build.scheduled_sp, 4);
assert.equal(shortWindow.build.unscheduled_sp, 0);
assert.equal(shortWindow.build.start_date, '2026-11-02');
assert.equal(shortWindow.build.end_date, '2026-11-05');
assert.ok(shortWindow.build.start_date >= '2026-11-02');
assert.ok(shortWindow.build.end_date > '2026-11-04');
assert.equal(shortWindow.build.status, 'scheduled');
assert.deepEqual(shortWindow.build.reasons, []);

const partialTbcPlan = plan(
  [
    feature('F-PARTIAL-TBC', 1, 1, realAllocation('R-1', 8, 2), {
      allocations: [
        realAllocation('R-1', 8, 2),
        { release_id: 'TBC-GEN-001', build: stage(2, 0), st: stage(0), incomplete_reasons: [] },
      ],
    }),
  ],
  [
    {
      release_id: 'TBC-GEN-001',
      release_name: 'TBC 1*',
      start_date: '2026-11-04',
      end_date: '2026-11-04',
    },
  ],
  [capacity('TBC-GEN-001', 2, 0)]
);
partialTbcPlan.real_allocation = {
  allocations: [{ feature_id: 'F-PARTIAL-TBC', build: stage(8, 2), st: stage(2) }],
};
const partialTbcSchedule = schedule(
  partialTbcPlan,
  [release('R-1', '2026-11-02', '2026-11-03')],
  [capacity('R-1', 8, 2)]
);
const partialReal = partialTbcSchedule.releases[0].features[0];
const partialTbc = partialTbcSchedule.releases[1].features[0];
assert.equal(partialReal.build.scheduled_sp, 8);
assert.equal(partialReal.build.unscheduled_sp, 0);
assert.equal(
  partialReal.status,
  'partial',
  'the feature still has remaining effort after this release'
);
assert.equal(partialTbc.build.required_sp, 2);
assert.equal(partialTbc.allocation_percent, 100);

const crossReleasePlan = plan(
  [
    feature(
      'F-CROSS-RELEASE',
      1,
      1,
      realAllocation('R-1', 40, 10, { buildRemaining: 40, stRemaining: 10 }),
      {
        team_name: 'GLUE',
        allocations: [
          realAllocation('R-1', 40, 10, { buildRemaining: 40, stRemaining: 10 }),
          {
            release_id: 'TBC-GEN-001',
            build: stage(9, 31),
            st: stage(1, 9),
            incomplete_reasons: [],
          },
        ],
      }
    ),
  ],
  [
    {
      release_id: 'TBC-GEN-001',
      release_name: 'TBC 1*',
      start_date: '2026-12-07',
      end_date: '2026-12-25',
    },
  ],
  [capacity('TBC-GEN-001', 9, 1)]
);
crossReleasePlan.real_allocation = {
  allocations: [
    {
      feature_id: 'F-CROSS-RELEASE',
      build: stage(40, 40),
      st: stage(10, 10),
    },
  ],
};
const crossReleaseResult = schedule(
  crossReleasePlan,
  [release('R-1', '2026-11-02', '2026-12-04')],
  [capacity('R-1', 40, 10)]
);
const firstReleaseFeature = crossReleaseResult.releases[0].features[0];
const tbcFeature = crossReleaseResult.releases[1].features[0];
assert.equal(firstReleaseFeature.feature_name, 'Feature F-CROSS-RELEASE');
assert.equal(firstReleaseFeature.team_id, 'T-1');
assert.equal(firstReleaseFeature.team_name, 'GLUE');
assert.equal(tbcFeature.feature_name, 'Feature F-CROSS-RELEASE');
assert.equal(tbcFeature.team_id, 'T-1');
assert.equal(tbcFeature.team_name, 'GLUE');
assert.equal(firstReleaseFeature.allocated_effort_sp.total, 50);
assert.equal(firstReleaseFeature.allocation_percent, 50);
assert.deepEqual(firstReleaseFeature.overall_required_effort_sp, { build: 80, st: 20, total: 100 });
assert.equal(firstReleaseFeature.status, 'partial');
assert.equal(tbcFeature.allocated_effort_sp.total, 10);
assert.equal(tbcFeature.required_effort_sp.total, 50);
assert.deepEqual(tbcFeature.overall_required_effort_sp, { build: 80, st: 20, total: 100 });
assert.equal(tbcFeature.allocation_percent, 20);
assert.equal(tbcFeature.status, 'partial');
assert.equal(tbcFeature.team_name, 'GLUE');

const completedFeatureWithTbcPlaceholder = feature(
  'F-COMPLETED',
  1,
  1,
  realAllocation('R-1', 4, 2),
  {
    feature_name: 'Completed Feature',
    team_id: 'T-1',
    team_name: 'GLUE',
    allocations: [
      realAllocation('R-1', 4, 2),
      {
        release_id: 'TBC-GEN-001',
        build: stage(0),
        st: stage(0),
        incomplete_reasons: [],
      },
    ],
  }
);
const omittedTbcPlaceholder = schedule(
  plan(
    [completedFeatureWithTbcPlaceholder],
    [release('TBC-GEN-001')],
    [capacity('TBC-GEN-001', 0, 0)]
  ),
  [release('R-1')],
  [capacity('R-1', 4, 2)]
);
assert.equal(omittedTbcPlaceholder.releases[0].features.length, 1);
assert.equal(omittedTbcPlaceholder.releases[0].features[0].feature_name, 'Completed Feature');
assert.equal(omittedTbcPlaceholder.releases[0].features[0].team_id, 'T-1');
assert.equal(omittedTbcPlaceholder.releases[0].features[0].team_name, 'GLUE');
assert.equal(omittedTbcPlaceholder.releases[1].features.length, 0);

const blockedTbcPlaceholderFeature = feature(
  'F-BLOCKED-TBC',
  1,
  1,
  realAllocation('R-1', 0, 0, {
    buildRemaining: 4,
    buildBlocked: 4,
    reasons: ['hard_dependency_blocked_build'],
  }),
  {
    allocations: [
      realAllocation('R-1', 0, 0, {
        buildRemaining: 4,
        buildBlocked: 4,
        reasons: ['hard_dependency_blocked_build'],
      }),
      {
        release_id: 'TBC-GEN-001',
        build: stage(0),
        st: stage(0),
        incomplete_reasons: ['hard_dependency_blocked_build'],
      },
    ],
  }
);
const retainedBlockedTbcRow = schedule(
  plan([blockedTbcPlaceholderFeature], [release('TBC-GEN-001')], [capacity('TBC-GEN-001', 0, 0)]),
  [release('R-1')],
  [capacity('R-1', 0, 0)]
);
assert.equal(retainedBlockedTbcRow.releases[1].features.length, 1);
assert.ok(
  retainedBlockedTbcRow.releases[1].features[0].incomplete_reasons.includes(
    'hard_dependency_blocked_build'
  )
);

const weekendStart = schedule(
  plan([feature('F-WEEKEND', 1, 1, realAllocation('R-1', 2, 0))]),
  [release('R-1', '2026-11-07', '2026-11-12')],
  [capacity('R-1', 2, 0)]
).releases[0].features[0];
assert.equal(weekendStart.build.start_date, '2026-11-09');
assert.equal(weekendStart.build.end_date, '2026-11-10');

const orderedPlan = plan([
  feature('F-HIGH', 1, 9, realAllocation('R-1', 1, 0)),
  feature('F-TIE-FIRST', 2, 3, realAllocation('R-1', 1, 0)),
  feature('F-TIE-LAST', 2, 7, realAllocation('R-1', 1, 0)),
  feature('F-LOW', 3, 1, realAllocation('R-1', 1, 0)),
]);
const orderedSnapshot = JSON.stringify(orderedPlan);
const orderedResult = schedule(orderedPlan, [release('R-1')], [capacity('R-1', 4, 0)]);
assert.deepEqual(
  orderedResult.releases[0].features.map((item) => item.feature_id),
  ['F-HIGH', 'F-TIE-FIRST', 'F-TIE-LAST', 'F-LOW']
);
assert.equal(orderedResult.releases[0].features[0].build.start_date, '2026-11-02');
assert.ok(
  orderedResult.releases[0].features.every((item) => item.build.start_date === '2026-11-02'),
  'priority orders allocation and rows; features in one release start in parallel'
);
assert.equal(JSON.stringify(orderedPlan), orderedSnapshot);
assert.deepEqual(orderedResult, schedule(orderedPlan, [release('R-1')], [capacity('R-1', 4, 0)]));

const tbcPlan = plan(
  [
    feature('F-TBC', 1, 1, {
      ...realAllocation('TBC-GEN-001', 1, 2),
      release_type: 'TBC',
    }),
  ],
  [
    {
      release_id: 'TBC-GEN-001',
      release_name: 'TBC 1*',
      start_date: '2026-12-07',
      end_date: '2026-12-25',
    },
  ],
  [capacity('TBC-GEN-001', 1, 2)]
);
const tbcResult = schedule(tbcPlan, [], []);
assert.equal(tbcResult.releases[0].release_type, 'TBC');
assert.equal(tbcResult.releases[0].release_name, 'TBC 1*');
assert.equal(tbcResult.releases[0].features[0].build.start_date, '2026-12-07');

assert.throws(
  () =>
    schedule(
      plan([feature('F-OVER', 1, 1, realAllocation('R-1', 3, 0))]),
      [release('R-1')],
      [capacity('R-1', 2, 0)]
    ),
  { code: 'INVALID_PLAN_RESULT' }
);

process.stdout.write('Feature stage scheduling verification passed.\n');
