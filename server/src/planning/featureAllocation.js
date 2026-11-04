'use strict';

const { calculateHardDependencyBlocking } = require('./hardDependencyBlocking');
const { getFeatureConsiderationOrder } = require('./featureOrdering');

const EFFORT_EPSILON = 1e-9;

function proportionalStEligibility(totalStRequired, totalBuildRequired, cumulativeBuildAllocated) {
  const stRequired = Number(totalStRequired);
  if (!Number.isFinite(stRequired) || stRequired <= 0) return 0;

  const buildRequired = Number(totalBuildRequired);
  if (!Number.isFinite(buildRequired) || buildRequired <= EFFORT_EPSILON) return stRequired;

  const buildAllocated = Number(cumulativeBuildAllocated);
  if (!Number.isFinite(buildAllocated) || buildAllocated <= 0) return 0;

  const buildProgress = Math.min(1, buildAllocated / buildRequired);
  return Math.min(stRequired, stRequired * buildProgress);
}

class FeatureAllocationError extends Error {
  constructor(message, { code, featureId = null, capacityKey = null } = {}) {
    super(message);
    this.name = 'FeatureAllocationError';
    this.code = code;
    this.featureId = featureId;
    this.capacityKey = capacityKey;
  }
}

function toNonNegativeNumber(value, label, metadata = {}) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new FeatureAllocationError(`${label} is required.`, {
      code: 'INVALID_CAPACITY',
      ...metadata,
    });
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new FeatureAllocationError(`${label} must be a finite non-negative number.`, {
      code: 'INVALID_CAPACITY',
      ...metadata,
    });
  }
  return number;
}

function capacityKey(teamId, releaseId) {
  return `${teamId}\u0000${releaseId}`;
}

function addReason(reasons, reason) {
  if (reason && !reasons.includes(reason)) reasons.push(reason);
}

function activityAllocation(blocking, availableCapacity, allocated, consumed, capacityRemaining) {
  return {
    requested_remaining_effort: blocking.remaining_effort,
    blocked_effort: blocking.blocked_effort,
    allocatable_effort: blocking.allocatable_effort,
    allocated_effort: allocated,
    remaining_effort_after_allocation: Math.max(0, blocking.remaining_effort - allocated),
    capacity_consumed: consumed,
    capacity_remaining: capacityRemaining,
    available_capacity_before_allocation: availableCapacity,
  };
}

function remainingCapacity(capacity, consumed) {
  return Math.max(0, capacity - consumed);
}

function releaseOrderValue(release) {
  if (release.priority_order === null || String(release.priority_order ?? '').trim() === '') {
    return null;
  }
  const order = Number(release.priority_order);
  return Number.isSafeInteger(order) ? order : null;
}

function orderedReleases(releases) {
  return releases
    .map((release, index) => ({ release, index }))
    .sort((left, right) => {
      const leftOrder = releaseOrderValue(left.release);
      const rightOrder = releaseOrderValue(right.release);
      const hasLeftOrder = leftOrder !== null;
      const hasRightOrder = rightOrder !== null;
      if (hasLeftOrder && hasRightOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (hasLeftOrder !== hasRightOrder) return hasLeftOrder ? -1 : 1;
      const dateDifference = String(left.release.start_date ?? '').localeCompare(
        String(right.release.start_date ?? '')
      );
      return dateDifference || left.index - right.index;
    })
    .map(({ release }) => release);
}

function allocateFeatureEffort({ features, dependencies, releases, capacities }) {
  if (![features, dependencies, releases, capacities].every(Array.isArray)) {
    throw new TypeError('Features, dependencies, releases, and capacities must be arrays.');
  }

  const releaseIds = new Set();
  for (const release of releases) {
    const releaseId = String(release?.release_id ?? '').trim();
    if (!releaseId || releaseIds.has(releaseId)) {
      throw new FeatureAllocationError(
        `Release records must have unique, non-empty release_id values (${releaseId || 'missing'}).`,
        { code: 'INVALID_RELEASE' }
      );
    }
    releaseIds.add(releaseId);
  }

  const featuresById = new Map();
  for (const feature of features) {
    const featureId = String(feature?.feature_id ?? '').trim();
    if (!featureId || featuresById.has(featureId)) {
      throw new FeatureAllocationError(
        `Feature records must have unique, non-empty feature_id values (${featureId || 'missing'}).`,
        { code: 'INVALID_FEATURE', featureId: featureId || null }
      );
    }
    featuresById.set(featureId, feature);
  }

  const capacityStates = new Map();
  for (const capacity of capacities) {
    const teamId = String(capacity?.team_id ?? '').trim();
    const releaseId = String(capacity?.release_id ?? '').trim();
    const key = capacityKey(teamId, releaseId);
    if (!teamId || !releaseId) {
      throw new FeatureAllocationError('Each capacity record requires team_id and release_id.', {
        code: 'INVALID_CAPACITY_KEY',
        capacityKey: key,
      });
    }
    if (!releaseIds.has(releaseId)) {
      throw new FeatureAllocationError(`Capacity references missing release ${releaseId}.`, {
        code: 'MISSING_RELEASE_REFERENCE',
        capacityKey: key,
      });
    }
    if (capacityStates.has(key)) {
      throw new FeatureAllocationError(
        `Duplicate capacity record for team ${teamId} and release ${releaseId}.`,
        { code: 'DUPLICATE_CAPACITY', capacityKey: key }
      );
    }
    capacityStates.set(key, {
      team_id: teamId,
      release_id: releaseId,
      build_capacity: toNonNegativeNumber(capacity.build_capacity, 'build_capacity', {
        capacityKey: key,
      }),
      st_capacity: toNonNegativeNumber(capacity.st_capacity, 'st_capacity', {
        capacityKey: key,
      }),
      build_consumed: 0,
      st_consumed: 0,
    });
  }

  const featureOrder = getFeatureConsiderationOrder(features, dependencies);
  const blockingByFeature = new Map(
    calculateHardDependencyBlocking(features, dependencies).map((result) => [
      result.feature_id,
      result,
    ])
  );
  const allocationByFeature = new Map();
  const pendingByFeature = new Map();
  for (const featureId of featureOrder) {
    const feature = featuresById.get(featureId);
    const blocking = blockingByFeature.get(featureId);
    pendingByFeature.set(featureId, {
      feature,
      blocking,
      team_id: String(feature.team_id ?? '').trim() || null,
      build_remaining: blocking.build.allocatable_effort,
      st_remaining: blocking.st.allocatable_effort,
      build_required_total: blocking.build.remaining_effort,
      st_required_total: blocking.st.remaining_effort,
      build_allocated: 0,
      st_allocated: 0,
      release_allocations: [],
    });
  }

  // Release priority is chronological in the configured release order. Within
  // each release, a team's features keep their priority/dependency order. Any
  // incomplete higher-priority feature blocks that team's lower-priority work
  // in the current release; it gets first access to capacity in the next one.
  for (const release of orderedReleases(releases)) {
    const releaseId = String(release.release_id).trim();
    const incompleteTeams = new Set();
    for (const featureId of featureOrder) {
      const pending = pendingByFeature.get(featureId);
      const { blocking, team_id: teamId } = pending;
      const hasRemaining =
        pending.build_remaining > 0 ||
        pending.st_remaining > 0 ||
        blocking.build.blocked_effort > 0 ||
        blocking.st.blocked_effort > 0;
      if (!hasRemaining && pending.release_allocations.length > 0) continue;

      const reasons = [];
      if (blocking.build.blocked_effort > 0) addReason(reasons, 'hard_dependency_blocked_build');
      if (blocking.st.blocked_effort > 0) addReason(reasons, 'hard_dependency_blocked_st');
      const blockedByHigherPriority = teamId && incompleteTeams.has(teamId);
      const capacity = teamId ? capacityStates.get(capacityKey(teamId, releaseId)) : null;
      const buildBefore = pending.build_remaining;
      const stBefore = pending.st_remaining;
      const buildCapacityAvailable = capacity
        ? remainingCapacity(capacity.build_capacity, capacity.build_consumed)
        : 0;
      const stCapacityAvailable = capacity
        ? remainingCapacity(capacity.st_capacity, capacity.st_consumed)
        : 0;
      const buildAvailable = buildCapacityAvailable;
      const stAvailable = stCapacityAvailable;
      let buildAllocated = 0;
      let stAllocated = 0;
      let stEligibleAvailable = 0;

      if (blockedByHigherPriority) {
        addReason(reasons, 'higher_priority_feature_incomplete');
      } else if (!teamId) {
        addReason(reasons, 'team_unassigned');
      } else if (!capacity) {
        addReason(reasons, 'capacity_record_missing');
      } else {
        buildAllocated = Math.min(buildBefore, buildAvailable);
        const stEligibleThroughRelease = proportionalStEligibility(
          pending.st_required_total,
          pending.build_required_total,
          pending.build_allocated + buildAllocated
        );
        stEligibleAvailable = Math.max(0, stEligibleThroughRelease - pending.st_allocated);
        stAllocated = Math.min(stBefore, stAvailable, stEligibleAvailable);
        pending.build_remaining = Math.max(0, buildBefore - buildAllocated);
        pending.st_remaining = Math.max(0, stBefore - stAllocated);
        pending.build_allocated += buildAllocated;
        pending.st_allocated += stAllocated;
        capacity.build_consumed += buildAllocated;
        capacity.st_consumed += stAllocated;
        if (pending.build_remaining > 0) {
          addReason(reasons, 'build_capacity_exhausted');
        }
        if (pending.st_remaining > 0) {
          if (stAvailable < stBefore && stAllocated >= stAvailable - EFFORT_EPSILON) {
            addReason(reasons, 'st_capacity_exhausted');
          }
          if (stEligibleAvailable < Math.min(stBefore, stAvailable) - EFFORT_EPSILON) {
            addReason(reasons, 'st_build_proportional_limit');
          }
        }
      }

      const remainsIncomplete =
        pending.build_remaining > 0 ||
        pending.st_remaining > 0 ||
        blocking.build.blocked_effort > 0 ||
        blocking.st.blocked_effort > 0;
      if (teamId && remainsIncomplete) incompleteTeams.add(teamId);

      const makeReleaseActivity = (stage, before, allocated, available, remaining) => ({
        requested_remaining_effort: before + blocking[stage].blocked_effort,
        blocked_effort: blocking[stage].blocked_effort,
        allocatable_effort: before,
        allocated_effort: allocated,
        remaining_effort_after_allocation: remaining + blocking[stage].blocked_effort,
        capacity_consumed: allocated,
        capacity_remaining: capacity
          ? remainingCapacity(capacity[`${stage}_capacity`], capacity[`${stage}_consumed`])
          : null,
        available_capacity_before_allocation: available,
      });
      pending.release_allocations.push({
        release_id: releaseId,
        build: makeReleaseActivity(
          'build',
          buildBefore,
          buildAllocated,
          buildAvailable,
          pending.build_remaining
        ),
        st: makeReleaseActivity('st', stBefore, stAllocated, stAvailable, pending.st_remaining),
        incomplete_reasons: reasons,
      });
    }
  }

  for (const featureId of featureOrder) {
    const pending = pendingByFeature.get(featureId);
    const { feature, blocking, team_id: teamId } = pending;
    const totalCapacity = (stage) =>
      [...capacityStates.values()]
        .filter((capacity) => capacity.team_id === teamId)
        .reduce((total, capacity) => total + capacity[`${stage}_capacity`], 0);
    const remainingCapacityTotal = (stage) =>
      [...capacityStates.values()]
        .filter((capacity) => capacity.team_id === teamId)
        .reduce(
          (total, capacity) =>
            total + remainingCapacity(capacity[`${stage}_capacity`], capacity[`${stage}_consumed`]),
          0
        );
    const reasons = [];
    if (blocking.build.blocked_effort > 0) addReason(reasons, 'hard_dependency_blocked_build');
    if (blocking.st.blocked_effort > 0) addReason(reasons, 'hard_dependency_blocked_st');
    if (pending.build_remaining > 0 || pending.st_remaining > 0) {
      const releaseReasons = pending.release_allocations.flatMap(
        (entry) => entry.incomplete_reasons
      );
      for (const reason of releaseReasons) addReason(reasons, reason);
      if (!teamId && (pending.build_remaining > 0 || pending.st_remaining > 0)) {
        addReason(reasons, 'team_unassigned');
      }
    }
    const allocation = {
      feature_id: featureId,
      team_id: teamId,
      release_id: null,
      priority: Number(feature.priority),
      input_order: Number(feature.input_order),
      build: activityAllocation(
        blocking.build,
        totalCapacity('build'),
        pending.build_allocated,
        pending.build_allocated,
        remainingCapacityTotal('build')
      ),
      st: activityAllocation(
        blocking.st,
        totalCapacity('st'),
        pending.st_allocated,
        pending.st_allocated,
        remainingCapacityTotal('st')
      ),
      release_allocations: pending.release_allocations,
      incomplete_reasons: reasons,
    };
    allocationByFeature.set(featureId, allocation);
  }

  const capacitySummary = [...capacityStates.values()]
    .sort((left, right) =>
      left.team_id < right.team_id
        ? -1
        : left.team_id > right.team_id
          ? 1
          : left.release_id < right.release_id
            ? -1
            : left.release_id > right.release_id
              ? 1
              : 0
    )
    .map((capacity) => ({
      team_id: capacity.team_id,
      release_id: capacity.release_id,
      build: {
        available_capacity: capacity.build_capacity,
        capacity_consumed: capacity.build_consumed,
        capacity_remaining: remainingCapacity(capacity.build_capacity, capacity.build_consumed),
      },
      st: {
        available_capacity: capacity.st_capacity,
        capacity_consumed: capacity.st_consumed,
        capacity_remaining: remainingCapacity(capacity.st_capacity, capacity.st_consumed),
      },
    }));

  return {
    feature_order: featureOrder,
    allocations: featureOrder.map((featureId) => allocationByFeature.get(featureId)),
    capacity_summary: capacitySummary,
  };
}

module.exports = {
  FeatureAllocationError,
  allocateFeatureEffort,
  proportionalStEligibility,
};
