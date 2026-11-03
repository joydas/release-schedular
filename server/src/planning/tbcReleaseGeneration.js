'use strict';

const { getFeatureConsiderationOrder } = require('./featureOrdering');

const SPRINT_WORKDAYS = Object.freeze([15, 15, 5]);
const DAY_MS = 24 * 60 * 60 * 1000;

class TbcGenerationError extends Error {
  constructor(message, { code, featureId = null, releaseId = null } = {}) {
    super(message);
    this.name = 'TbcGenerationError';
    this.code = code;
    this.featureId = featureId;
    this.releaseId = releaseId;
  }
}

function dateOnly(value, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TbcGenerationError(`${label} must be a valid date.`, { code: 'INVALID_DATE' });
    }
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TbcGenerationError(`${label} must be an ISO date (YYYY-MM-DD).`, {
      code: 'INVALID_DATE',
    });
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TbcGenerationError(`${label} must be a valid ISO date.`, { code: 'INVALID_DATE' });
  }
  return parsed;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, count) {
  return new Date(date.getTime() + count * DAY_MS);
}

function nextWednesday(date) {
  const daysUntilWednesday = (3 - date.getUTCDay() + 7) % 7 || 7;
  return addDays(date, daysUntilWednesday);
}

function addWorkingDays(start, count) {
  let current = new Date(start);
  let workingDays = 0;
  while (workingDays < count) {
    if (current.getUTCDay() !== 0 && current.getUTCDay() !== 6) workingDays += 1;
    if (workingDays < count) current = addDays(current, 1);
  }
  return current;
}

function numericCapacity(value, label, releaseId) {
  if (value === null || value === undefined || value === '') {
    throw new TbcGenerationError(`${label} is required.`, {
      code: 'INVALID_CAPACITY',
      releaseId,
    });
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TbcGenerationError(`${label} must be a finite non-negative number.`, {
      code: 'INVALID_CAPACITY',
      releaseId,
    });
  }
  return amount;
}

function buildTeamAverages(releases, capacities) {
  const releaseIds = new Set();
  for (const release of releases) {
    const id = String(release?.release_id ?? '').trim();
    if (!id || releaseIds.has(id)) {
      throw new TbcGenerationError('Real releases require unique, non-empty release_id values.', {
        code: 'INVALID_RELEASE',
        releaseId: id || null,
      });
    }
    releaseIds.add(id);
  }

  const capacityByKey = new Map();
  const teams = new Set();
  for (const record of capacities) {
    const teamId = String(record?.team_id ?? '').trim();
    const releaseId = String(record?.release_id ?? '').trim();
    if (!teamId || !releaseIds.has(releaseId)) {
      throw new TbcGenerationError('Capacity records must reference a real release and team.', {
        code: 'INVALID_CAPACITY_KEY',
        releaseId: releaseId || null,
      });
    }
    const key = `${teamId}\u0000${releaseId}`;
    if (capacityByKey.has(key)) {
      throw new TbcGenerationError(
        `Duplicate capacity for team ${teamId} and release ${releaseId}.`,
        {
          code: 'DUPLICATE_CAPACITY',
          releaseId,
        }
      );
    }
    capacityByKey.set(key, {
      team_id: teamId,
      release_id: releaseId,
      build_capacity: numericCapacity(record.build_capacity, 'build_capacity', releaseId),
      st_capacity: numericCapacity(record.st_capacity, 'st_capacity', releaseId),
    });
    teams.add(teamId);
  }

  const averages = new Map();
  for (const teamId of [...teams].sort()) {
    let buildTotal = 0;
    let stTotal = 0;
    for (const releaseId of releaseIds) {
      const capacity = capacityByKey.get(`${teamId}\u0000${releaseId}`);
      if (capacity) {
        buildTotal += capacity.build_capacity;
        stTotal += capacity.st_capacity;
      }
    }
    averages.set(teamId, {
      team_id: teamId,
      build_capacity: buildTotal / releases.length,
      st_capacity: stTotal / releases.length,
    });
  }
  return averages;
}

function createPendingWork(features, realAllocation) {
  if (!realAllocation || !Array.isArray(realAllocation.allocations)) {
    throw new TbcGenerationError('realAllocation.allocations must be an array.', {
      code: 'INVALID_REAL_ALLOCATION',
    });
  }
  const allocations = new Map();
  for (const allocation of realAllocation.allocations) {
    const featureId = String(allocation?.feature_id ?? '').trim();
    if (!featureId || allocations.has(featureId)) {
      throw new TbcGenerationError(
        'Real allocations require unique, non-empty feature_id values.',
        {
          code: 'INVALID_REAL_ALLOCATION',
          featureId: featureId || null,
        }
      );
    }
    allocations.set(featureId, allocation);
  }
  const pending = features.map((feature) => {
    const featureId = String(feature.feature_id).trim();
    const allocation = allocations.get(featureId);
    if (!allocation) {
      throw new TbcGenerationError(`Real allocation is missing feature ${featureId}.`, {
        code: 'MISSING_FEATURE_ALLOCATION',
        featureId,
      });
    }
    const activity = (name) => {
      const row = allocation[name];
      if (
        !row ||
        !Number.isFinite(Number(row.allocatable_effort)) ||
        !Number.isFinite(Number(row.allocated_effort)) ||
        !Number.isFinite(Number(row.blocked_effort))
      ) {
        throw new TbcGenerationError(
          `Real allocation for ${featureId} has invalid ${name} effort values.`,
          { code: 'INVALID_REAL_ALLOCATION', featureId }
        );
      }
      return {
        schedulable: Math.max(0, Number(row.allocatable_effort) - Number(row.allocated_effort)),
        blocked: Math.max(0, Number(row.blocked_effort)),
      };
    };
    return {
      feature_id: featureId,
      team_id: allocation.team_id ?? feature.team_id ?? null,
      priority: Number(feature.priority),
      input_order: Number(feature.input_order),
      build: activity('build'),
      st: activity('st'),
      incomplete_reasons: Array.isArray(allocation.incomplete_reasons)
        ? [...allocation.incomplete_reasons]
        : [],
    };
  });
  if (allocations.size !== features.length) {
    throw new TbcGenerationError('Real allocations must contain exactly one entry per feature.', {
      code: 'INVALID_REAL_ALLOCATION',
    });
  }
  return pending;
}

function listHardBlockers(work) {
  const blockers = [];
  for (const feature of work) {
    for (const activity of ['build', 'st']) {
      if (feature[activity].blocked > 0) {
        blockers.push({
          feature_id: feature.feature_id,
          activity: activity === 'build' ? 'Build' : 'ST',
          blocked_effort: feature[activity].blocked,
          reason: `hard_dependency_blocked_${activity}`,
        });
      }
    }
  }
  return blockers;
}

function remainingSchedulable(work) {
  return work.reduce((sum, feature) => sum + feature.build.schedulable + feature.st.schedulable, 0);
}

function allocateTbcSprint(work, order, capacities) {
  const incompleteTeamScopes = new Set();
  const allocations = [];
  const capacityStates = new Map(
    [...capacities.values()].map((capacity) => [
      capacity.team_id,
      { ...capacity, build_used: 0, st_used: 0 },
    ])
  );

  for (const featureId of order) {
    const feature = work.find((item) => item.feature_id === featureId);
    if (!feature) continue;
    const reasons = [];
    let buildAllocated = 0;
    let stAllocated = 0;
    const teamId = feature.team_id ? String(feature.team_id).trim() : null;
    const capacity = teamId ? capacityStates.get(teamId) : null;
    const priorityScopeKey = JSON.stringify([teamId, teamId ? null : feature.feature_id]);
    const higherPriorityIncomplete = incompleteTeamScopes.has(priorityScopeKey);
    if (higherPriorityIncomplete) reasons.push('higher_priority_feature_incomplete');

    if (
      !higherPriorityIncomplete &&
      (feature.build.schedulable > 0 || feature.st.schedulable > 0)
    ) {
      if (!teamId) {
        reasons.push('team_unassigned');
      } else if (!capacity) {
        reasons.push('capacity_record_missing');
      } else {
        const buildAvailable = Math.max(0, capacity.build_capacity - capacity.build_used);
        const stAvailable = Math.max(0, capacity.st_capacity - capacity.st_used);
        buildAllocated = Math.min(feature.build.schedulable, buildAvailable);
        capacity.build_used += buildAllocated;
        stAllocated = Math.min(feature.st.schedulable, stAvailable);
        capacity.st_used += stAllocated;
        if (feature.build.schedulable > buildAllocated) {
          reasons.push('build_capacity_exhausted');
        }
        if (feature.st.schedulable > stAllocated) {
          reasons.push('st_capacity_exhausted');
        }
      }
    }

    const outstanding =
      feature.build.schedulable - buildAllocated > 0 ||
      feature.st.schedulable - stAllocated > 0 ||
      feature.build.blocked > 0 ||
      feature.st.blocked > 0;
    if (outstanding) incompleteTeamScopes.add(priorityScopeKey);

    feature.build.schedulable = Math.max(0, feature.build.schedulable - buildAllocated);
    feature.st.schedulable = Math.max(0, feature.st.schedulable - stAllocated);
    allocations.push({
      feature_id: featureId,
      team_id: teamId,
      build_allocated_effort: buildAllocated,
      st_allocated_effort: stAllocated,
      remaining_build_effort: feature.build.schedulable,
      remaining_st_effort: feature.st.schedulable,
      incomplete_reasons: [...new Set([...feature.incomplete_reasons, ...reasons])],
    });
  }

  const usedCapacity = [...capacityStates.values()].reduce(
    (sum, capacity) => sum + capacity.build_used + capacity.st_used,
    0
  );
  return { allocations, used_capacity: usedCapacity };
}

function generateTbcReleases({ features, dependencies, releases, capacities, realAllocation }) {
  if (![features, dependencies, releases, capacities].every(Array.isArray)) {
    throw new TypeError('Features, dependencies, releases, and capacities must be arrays.');
  }
  const featureOrder = getFeatureConsiderationOrder(features, dependencies);
  const work = createPendingWork(features, realAllocation);
  const blockers = listHardBlockers(work);
  const base = {
    releases: [],
    capacities: [],
    allocations: [],
    unresolved_blockers: blockers,
    stop_reason: null,
  };

  if (releases.length === 0) return { ...base, stop_reason: 'no_real_releases' };
  if (remainingSchedulable(work) === 0) {
    return {
      ...base,
      stop_reason: blockers.length ? 'only_blocked_or_gated_work_remains' : 'no_remaining_work',
    };
  }

  const teamAverages = buildTeamAverages(releases, capacities);
  const hasUsableCapacity = [...teamAverages.values()].some(
    (capacity) => capacity.build_capacity > 0 || capacity.st_capacity > 0
  );
  if (!hasUsableCapacity) return { ...base, stop_reason: 'no_usable_capacity' };

  const realReleaseIds = new Set(releases.map((release) => String(release.release_id)));
  const endDates = releases
    .filter((release) => release.end_date)
    .map((release) => dateOnly(release.end_date, `Release ${release.release_id} end_date`));
  if (endDates.length === 0) return { ...base, stop_reason: 'missing_real_release_end_date' };
  const latestEnd = endDates.reduce((latest, date) => (date > latest ? date : latest));
  const lastReleasePriority = releases.reduce((last, release, index) => {
    const rawPriority = release.priority_order;
    const priority =
      rawPriority !== null && String(rawPriority ?? '').trim() !== ''
        ? Number(rawPriority)
        : Number.NaN;
    return Math.max(last, Number.isSafeInteger(priority) ? priority : index + 1);
  }, 0);
  let sprintStart = nextWednesday(latestEnd);
  let nextIndex = 1;
  let capacityUsed = true;

  while (remainingSchedulable(work) > 0 && capacityUsed) {
    const remainingBeforeSprint = remainingSchedulable(work);
    const sprintWorkdays = SPRINT_WORKDAYS[(nextIndex - 1) % SPRINT_WORKDAYS.length];
    const sprintEnd = addWorkingDays(sprintStart, sprintWorkdays);
    const generatedReleaseId = `TBC-GEN-${String(nextIndex).padStart(3, '0')}`;
    if (realReleaseIds.has(generatedReleaseId)) {
      throw new TbcGenerationError(
        `Generated release ID ${generatedReleaseId} conflicts with a real release.`,
        {
          code: 'GENERATED_RELEASE_ID_CONFLICT',
          releaseId: generatedReleaseId,
        }
      );
    }
    const generatedRelease = {
      release_id: generatedReleaseId,
      release_name: `TBC ${nextIndex}*`,
      status: 'Planned',
      start_date: formatDate(sprintStart),
      end_date: formatDate(sprintEnd),
      target_date: null,
      priority_order: lastReleasePriority + nextIndex,
    };
    const sprintCapacities = new Map();
    for (const [teamId, average] of teamAverages) {
      sprintCapacities.set(teamId, { ...average, release_id: generatedReleaseId });
    }
    const sprintResult = allocateTbcSprint(work, featureOrder, sprintCapacities);
    capacityUsed = sprintResult.used_capacity > 0;
    if (!capacityUsed || remainingSchedulable(work) >= remainingBeforeSprint) {
      base.stop_reason = 'no_progress';
      break;
    }

    base.releases.push(generatedRelease);
    base.capacities.push(...[...sprintCapacities.values()].map((item) => ({ ...item })));
    base.allocations.push({
      release_id: generatedReleaseId,
      release_name: generatedRelease.release_name,
      features: sprintResult.allocations,
    });
    sprintStart = addDays(sprintEnd, 1);
    nextIndex += 1;
  }

  if (!base.stop_reason) {
    base.stop_reason =
      remainingSchedulable(work) > 0 ? 'no_progress' : 'all_schedulable_work_allocated';
  }
  base.remaining_work = work.map((feature) => ({
    feature_id: feature.feature_id,
    build_effort: feature.build.schedulable,
    st_effort: feature.st.schedulable,
    blocked_build_effort: feature.build.blocked,
    blocked_st_effort: feature.st.blocked,
  }));
  return base;
}

module.exports = { TbcGenerationError, generateTbcReleases };
