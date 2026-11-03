'use strict';

const { buildDependencyGraph } = require('./dependencyGraph');
const { getFeatureConsiderationOrder } = require('./featureOrdering');
const { calculateHardDependencyBlocking } = require('./hardDependencyBlocking');
const { allocateFeatureEffort } = require('./featureAllocation');
const { generateTbcReleases } = require('./tbcReleaseGeneration');

const REQUIRED_ARRAY_FIELDS = Object.freeze([
  'teams',
  'releases',
  'features',
  'stories',
  'dependencies',
  'capacities',
]);

class PlanComputationError extends Error {
  constructor(
    message,
    { code = 'PLAN_COMPUTATION_ERROR', stage = 'input', cause, details = {} } = {}
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PlanComputationError';
    this.code = code;
    this.stage = stage;
    this.details = details;
  }
}

function runStage(stage, operation) {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof PlanComputationError) throw cause;
    throw new PlanComputationError(`${stage}: ${cause.message}`, {
      code: cause.code || 'PLAN_COMPUTATION_ERROR',
      stage,
      cause,
      details: {
        featureId: cause.featureId ?? null,
        featureIds: cause.featureIds ?? [],
        dependencyId: cause.dependencyId ?? null,
        releaseId: cause.releaseId ?? null,
        capacityKey: cause.capacityKey ?? null,
        cycle: cause.cycle ?? [],
      },
    });
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new PlanComputationError('state must be an object.', { code: 'INVALID_STATE' });
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(state[field])) {
      throw new PlanComputationError(`state.${field} must be an array.`, {
        code: 'INVALID_STATE_FIELD',
        details: { field },
      });
    }
  }
  if (!state.config || typeof state.config !== 'object' || Array.isArray(state.config)) {
    throw new PlanComputationError('state.config must be a configuration object.', {
      code: 'INVALID_STATE_FIELD',
      details: { field: 'config' },
    });
  }

  const teamsById = new Map();
  for (const [index, team] of state.teams.entries()) {
    if (!team || typeof team !== 'object' || Array.isArray(team)) {
      throw new PlanComputationError(`state.teams[${index}] must be a team record.`, {
        code: 'INVALID_TEAM',
        details: { index },
      });
    }
    const teamId = String(team.team_id ?? '').trim();
    if (!teamId || teamsById.has(teamId)) {
      throw new PlanComputationError(
        `Team IDs must be unique and non-empty (${teamId || 'missing'}).`,
        {
          code: 'INVALID_TEAM',
          details: { teamId: teamId || null, index },
        }
      );
    }
    teamsById.set(teamId, team);
  }

  const featureIds = new Set();
  for (const [index, feature] of state.features.entries()) {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
      throw new PlanComputationError(`state.features[${index}] must be a feature record.`, {
        code: 'INVALID_FEATURE',
        details: { index },
      });
    }
    const featureId = String(feature.feature_id ?? '').trim();
    if (!featureId || featureIds.has(featureId)) {
      throw new PlanComputationError(
        `Feature IDs must be unique and non-empty (${featureId || 'missing'}).`,
        { code: 'INVALID_FEATURE', details: { featureId: featureId || null, index } }
      );
    }
    featureIds.add(featureId);
    const teamId = String(feature.team_id ?? '').trim();
    if (teamId && !teamsById.has(teamId)) {
      throw new PlanComputationError(`Feature ${featureId} references missing team ${teamId}.`, {
        code: 'MISSING_TEAM_REFERENCE',
        details: { featureId, teamId },
      });
    }
  }

  const storyIds = new Set();
  for (const [index, story] of state.stories.entries()) {
    if (!story || typeof story !== 'object' || Array.isArray(story)) {
      throw new PlanComputationError(`state.stories[${index}] must be a user story record.`, {
        code: 'INVALID_STORY',
        details: { index },
      });
    }
    const storyId = String(story.story_id ?? '').trim();
    const featureId = String(story.feature_id ?? '').trim();
    if (!storyId || storyIds.has(storyId)) {
      throw new PlanComputationError(
        `Story IDs must be unique and non-empty (${storyId || 'missing'}).`,
        { code: 'INVALID_STORY', details: { storyId: storyId || null, index } }
      );
    }
    if (!featureIds.has(featureId)) {
      throw new PlanComputationError(
        `Story ${storyId} references missing feature ${featureId || '(blank)'}.`,
        {
          code: 'MISSING_FEATURE_REFERENCE',
          details: { storyId, featureId: featureId || null },
        }
      );
    }
    if (!Number.isSafeInteger(Number(story.input_order))) {
      throw new PlanComputationError(`Story ${storyId} has an invalid input_order.`, {
        code: 'INVALID_STORY',
        details: { storyId, inputOrder: story.input_order },
      });
    }
    storyIds.add(storyId);
  }

  for (const [index, capacity] of state.capacities.entries()) {
    if (!capacity || typeof capacity !== 'object' || Array.isArray(capacity)) {
      throw new PlanComputationError(`state.capacities[${index}] must be a capacity record.`, {
        code: 'INVALID_CAPACITY',
        details: { index },
      });
    }
    const teamId = String(capacity.team_id ?? '').trim();
    if (!teamsById.has(teamId)) {
      throw new PlanComputationError(
        `Capacity record references missing team ${teamId || '(blank)'}.`,
        {
          code: 'MISSING_TEAM_REFERENCE',
          details: { teamId: teamId || null, releaseId: capacity.release_id ?? null },
        }
      );
    }
  }
}

function validateRealAllocation(allocation, features) {
  if (
    !allocation ||
    !Array.isArray(allocation.feature_order) ||
    !Array.isArray(allocation.allocations) ||
    !Array.isArray(allocation.capacity_summary) ||
    allocation.allocations.length !== features.length
  ) {
    throw new PlanComputationError('Feature allocator returned an invalid allocation result.', {
      code: 'INVALID_ALLOCATION_RESULT',
      stage: 'allocation',
    });
  }
  const expectedOrder = allocation.feature_order;
  if (
    expectedOrder.length !== features.length ||
    new Set(expectedOrder).size !== features.length ||
    features.some((feature) => !expectedOrder.includes(String(feature.feature_id)))
  ) {
    throw new PlanComputationError('Feature allocator returned an invalid feature order.', {
      code: 'INVALID_ALLOCATION_RESULT',
      stage: 'allocation',
    });
  }
  const allocatedIds = new Set();
  const requiredEffortFields = [
    'requested_remaining_effort',
    'blocked_effort',
    'allocatable_effort',
    'allocated_effort',
    'remaining_effort_after_allocation',
    'capacity_consumed',
  ];
  for (const item of allocation.allocations) {
    if (
      !item ||
      typeof item.feature_id !== 'string' ||
      allocatedIds.has(item.feature_id) ||
      !item.build ||
      !item.st ||
      !Array.isArray(item.incomplete_reasons)
    ) {
      throw new PlanComputationError('Feature allocator returned a malformed feature allocation.', {
        code: 'INVALID_ALLOCATION_RESULT',
        stage: 'allocation',
        details: { featureId: item?.feature_id ?? null },
      });
    }
    for (const activity of [item.build, item.st]) {
      if (
        requiredEffortFields.some(
          (field) => !Number.isFinite(Number(activity[field])) || Number(activity[field]) < 0
        )
      ) {
        throw new PlanComputationError('Feature allocator returned invalid effort values.', {
          code: 'INVALID_ALLOCATION_RESULT',
          stage: 'allocation',
          details: { featureId: item.feature_id },
        });
      }
    }
    allocatedIds.add(item.feature_id);
  }
  if (features.some((feature) => !allocatedIds.has(String(feature.feature_id)))) {
    throw new PlanComputationError('Feature allocator omitted a feature allocation.', {
      code: 'INVALID_ALLOCATION_RESULT',
      stage: 'allocation',
    });
  }
  for (const capacity of allocation.capacity_summary) {
    for (const activity of [capacity?.build, capacity?.st]) {
      if (
        !activity ||
        ['available_capacity', 'capacity_consumed', 'capacity_remaining'].some(
          (field) => !Number.isFinite(Number(activity[field])) || Number(activity[field]) < 0
        )
      ) {
        throw new PlanComputationError('Feature allocator returned invalid capacity totals.', {
          code: 'INVALID_ALLOCATION_RESULT',
          stage: 'allocation',
          details: { teamId: capacity?.team_id ?? null, releaseId: capacity?.release_id ?? null },
        });
      }
    }
  }
}

function makeSchedule({
  order,
  features,
  teams,
  stories,
  releases,
  realAllocation,
  tbcGeneration,
}) {
  const featuresById = new Map(features.map((feature) => [String(feature.feature_id), feature]));
  const teamsById = new Map(teams.map((team) => [String(team.team_id), team]));
  const storiesByFeature = new Map(features.map((feature) => [String(feature.feature_id), []]));
  for (const story of stories) storiesByFeature.get(String(story.feature_id)).push({ ...story });
  for (const featureStories of storiesByFeature.values()) {
    featureStories.sort(
      (left, right) =>
        Number(left.input_order) - Number(right.input_order) ||
        (String(left.story_id) < String(right.story_id)
          ? -1
          : String(left.story_id) > String(right.story_id)
            ? 1
            : 0)
    );
  }

  const schedules = new Map(
    order.map((featureId) => {
      const feature = featuresById.get(featureId);
      const teamId = feature.team_id ?? null;
      const team = teamId === null ? null : teamsById.get(String(teamId));
      return [
        featureId,
        {
          feature_id: featureId,
          feature_name: feature.feature_name ?? featureId,
          team_id: teamId,
          team_name: team?.team_name ?? null,
          // Kept in the result for legacy clients; release placement is predicted
          // by the allocations below and is no longer an input assignment.
          release_id: null,
          priority: Number(feature.priority),
          input_order: Number(feature.input_order),
          stories: storiesByFeature.get(featureId),
          allocations: [],
        },
      ];
    })
  );
  const releaseNames = new Map(
    releases.map((release) => [
      String(release.release_id),
      release.release_name ?? release.release_id,
    ])
  );
  for (const allocation of realAllocation.allocations) {
    const releaseAllocations = allocation.release_allocations || [allocation];
    for (const releaseAllocation of releaseAllocations) {
      const releaseId = String(releaseAllocation.release_id);
      schedules.get(allocation.feature_id).allocations.push({
        release_id: releaseAllocation.release_id,
        release_name: releaseNames.get(releaseId) ?? releaseId,
        release_type: 'Real',
        build: { ...releaseAllocation.build },
        st: { ...releaseAllocation.st },
        incomplete_reasons: [...releaseAllocation.incomplete_reasons],
      });
    }
  }

  for (const generated of tbcGeneration.allocations) {
    for (const allocation of generated.features) {
      schedules.get(allocation.feature_id).allocations.push({
        release_id: generated.release_id,
        release_name: generated.release_name,
        release_type: 'TBC',
        build: {
          allocated_effort: allocation.build_allocated_effort,
          remaining_effort_after_allocation: allocation.remaining_build_effort,
        },
        st: {
          allocated_effort: allocation.st_allocated_effort,
          remaining_effort_after_allocation: allocation.remaining_st_effort,
        },
        incomplete_reasons: [...allocation.incomplete_reasons],
      });
    }
  }
  return order.map((featureId) => schedules.get(featureId));
}

function getNoProgressReasons(tbcGeneration, realAllocation) {
  const terminalReasons = new Set(['all_schedulable_work_allocated', 'no_remaining_work']);
  if (
    (!tbcGeneration.stop_reason || terminalReasons.has(tbcGeneration.stop_reason)) &&
    tbcGeneration.unresolved_blockers.length === 0
  ) {
    return [];
  }
  const latestTbcAllocation = tbcGeneration.allocations.at(-1);
  const reasonsByFeature = new Map(
    (latestTbcAllocation?.features || realAllocation.allocations).map((allocation) => [
      allocation.feature_id,
      allocation.incomplete_reasons || [],
    ])
  );
  return [
    {
      code: terminalReasons.has(tbcGeneration.stop_reason)
        ? 'unresolved_blockers_remain'
        : tbcGeneration.stop_reason || 'planning_stopped',
      message: terminalReasons.has(tbcGeneration.stop_reason)
        ? 'Schedulable work is allocated, but unresolved Hard dependency blockers remain.'
        : `TBC generation stopped: ${tbcGeneration.stop_reason || 'unknown reason'}.`,
      remaining_work: (tbcGeneration.remaining_work || [])
        .filter((item) => item.build_effort > 0 || item.st_effort > 0)
        .map((item) => ({
          ...item,
          incomplete_reasons: [...(reasonsByFeature.get(item.feature_id) || [])],
        })),
      unresolved_blockers: tbcGeneration.unresolved_blockers.map((blocker) => ({ ...blocker })),
    },
  ];
}

function computePlan(state) {
  runStage('input validation', () => validateState(state));
  const dependencies = state.dependencies;
  const graph = runStage('dependency graph validation', () =>
    buildDependencyGraph(state.features, dependencies)
  );
  const featureOrder = runStage('dependency ordering validation', () =>
    getFeatureConsiderationOrder(state.features, dependencies)
  );
  const hardDependencyBlocking = runStage('hard dependency blocking', () =>
    calculateHardDependencyBlocking(state.features, dependencies)
  );
  const realAllocation = runStage('feature allocation', () =>
    allocateFeatureEffort({
      features: state.features,
      dependencies,
      releases: state.releases,
      capacities: state.capacities,
    })
  );
  runStage('allocation result validation', () =>
    validateRealAllocation(realAllocation, state.features)
  );
  const tbcGeneration = runStage('TBC release generation', () =>
    generateTbcReleases({
      features: state.features,
      dependencies,
      releases: state.releases,
      capacities: state.capacities,
      realAllocation,
    })
  );

  return {
    feature_order: [...featureOrder],
    dependency_graph: graph,
    hard_dependency_blocking: hardDependencyBlocking,
    real_allocation: realAllocation,
    tbc_generation: tbcGeneration,
    schedule: makeSchedule({
      order: featureOrder,
      features: state.features,
      teams: state.teams,
      stories: state.stories,
      releases: state.releases,
      realAllocation,
      tbcGeneration,
    }),
    unresolvable_blockers: tbcGeneration.unresolved_blockers.map((blocker) => ({ ...blocker })),
    no_progress_reasons: getNoProgressReasons(tbcGeneration, realAllocation),
  };
}

module.exports = { PlanComputationError, computePlan };
