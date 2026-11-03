'use strict';

const STORY_POINTS_PER_WORKDAY = 1;
const EPSILON = 1e-9;

class FeatureStageSchedulingError extends Error {
  constructor(message, { code = 'INVALID_SCHEDULE_INPUT', details = {} } = {}) {
    super(message);
    this.name = 'FeatureStageSchedulingError';
    this.code = code;
    this.details = details;
  }
}

function asDateKey(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value);
  if (!match) return null;
  if (value.includes('T') && Number.isNaN(new Date(value).getTime())) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]
    ? null
    : match[1];
}

function dateFromKey(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function isWeekend(date) {
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

function nextWorkday(date) {
  const result = new Date(date);
  while (isWeekend(result)) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function addWorkdays(date, count) {
  const result = new Date(date);
  let remaining = count;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isWeekend(result)) remaining -= 1;
  }
  return result;
}

function stageEffort(allocation, stage, featureId) {
  const entry = allocation?.[stage];
  if (!entry || typeof entry !== 'object') {
    throw new FeatureStageSchedulingError(
      `Feature ${featureId} has no ${stage.toUpperCase()} allocation record.`,
      { code: 'INVALID_PLAN_RESULT', details: { featureId, stage } }
    );
  }
  const allocated = Number(entry.allocated_effort);
  const remaining = Number(entry.remaining_effort_after_allocation ?? 0);
  const blocked = Number(entry.blocked_effort ?? 0);
  const requestedRaw = entry.requested_remaining_effort;
  const requested =
    requestedRaw === null || requestedRaw === undefined || requestedRaw === ''
      ? null
      : Number(requestedRaw);
  if (
    ![allocated, remaining, blocked].every(Number.isFinite) ||
    allocated < 0 ||
    remaining < 0 ||
    blocked < 0 ||
    (requested !== null && (!Number.isFinite(requested) || requested < allocated))
  ) {
    throw new FeatureStageSchedulingError(
      `Feature ${featureId} has an invalid ${stage.toUpperCase()} allocation.`,
      { code: 'INVALID_PLAN_RESULT', details: { featureId, stage } }
    );
  }
  return { allocated, remaining, blocked, requested };
}

function initialRequiredEffort(plan) {
  const requiredByFeature = new Map();
  for (const allocation of plan.real_allocation?.allocations || []) {
    const featureId = String(allocation?.feature_id ?? '').trim();
    if (!featureId) continue;
    const requested = (stage) => {
      const value = allocation[stage]?.requested_remaining_effort;
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    requiredByFeature.set(featureId, { build: requested('build'), st: requested('st') });
  }
  for (const feature of plan.schedule || []) {
    const featureId = String(feature?.feature_id ?? '').trim();
    if (!featureId) continue;
    const current = requiredByFeature.get(featureId) || { build: null, st: null };
    if (current.build !== null && current.st !== null) continue;
    const realAllocation = (feature.allocations || []).find(
      (allocation) =>
        allocation?.release_type === 'Real' ||
        allocation?.build?.requested_remaining_effort !== undefined ||
        allocation?.st?.requested_remaining_effort !== undefined
    );
    if (!realAllocation) continue;
    const requested = (stage) => {
      const value = realAllocation[stage]?.requested_remaining_effort;
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    requiredByFeature.set(featureId, {
      build: current.build ?? requested('build'),
      st: current.st ?? requested('st'),
    });
  }
  return requiredByFeature;
}

function validateCapacityUsage(plan, capacities) {
  const limits = new Map();
  for (const capacity of capacities) {
    const teamId = String(capacity?.team_id ?? '').trim();
    const releaseId = String(capacity?.release_id ?? '').trim();
    if (!teamId || !releaseId) continue;
    const values = [Number(capacity.build_capacity), Number(capacity.st_capacity)];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) continue;
    limits.set(`${releaseId}\u0000${teamId}`, { build: values[0], st: values[1] });
  }
  for (const capacity of plan.tbc_generation?.capacities || []) {
    const teamId = String(capacity?.team_id ?? '').trim();
    const releaseId = String(capacity?.release_id ?? '').trim();
    if (!teamId || !releaseId) continue;
    const values = [Number(capacity.build_capacity), Number(capacity.st_capacity)];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) continue;
    limits.set(`${releaseId}\u0000${teamId}`, { build: values[0], st: values[1] });
  }

  const usage = new Map();
  for (const feature of plan.schedule) {
    for (const allocation of feature.allocations || []) {
      const teamId = String(feature.team_id ?? '').trim();
      const releaseId = String(allocation.release_id ?? '').trim();
      if (!teamId || !releaseId) continue;
      const key = `${releaseId}\u0000${teamId}`;
      const total = usage.get(key) || { build: 0, st: 0 };
      total.build += stageEffort(allocation, 'build', feature.feature_id).allocated;
      total.st += stageEffort(allocation, 'st', feature.feature_id).allocated;
      usage.set(key, total);
    }
  }
  for (const [key, allocated] of usage) {
    const capacity = limits.get(key);
    if (!capacity) {
      if (allocated.build > 0 || allocated.st > 0) {
        throw new FeatureStageSchedulingError(
          'Allocated effort has no matching team/release capacity.',
          {
            code: 'INVALID_PLAN_RESULT',
            details: { capacityKey: key.replace('\u0000', '/') },
          }
        );
      }
      continue;
    }
    if (allocated.build > capacity.build + EPSILON || allocated.st > capacity.st + EPSILON) {
      throw new FeatureStageSchedulingError('Scheduled effort exceeds the plan capacity.', {
        code: 'INVALID_PLAN_RESULT',
        details: { capacityKey: key.replace('\u0000', '/') },
      });
    }
  }
}

function normalizeWindow(release) {
  const start = asDateKey(release.start_date);
  const end = asDateKey(release.end_date);
  if (!start || !end) {
    return {
      start: null,
      end: null,
      reason: !start || !end ? 'release_window_missing_or_invalid' : 'release_window_invalid',
    };
  }
  if (start > end) return { start: null, end: null, reason: 'release_window_invalid' };
  return { start, end, reason: null };
}

function releaseOrderValue(release) {
  if (release.priority_order === null || String(release.priority_order ?? '').trim() === '') {
    return null;
  }
  const order = Number(release.priority_order);
  return Number.isSafeInteger(order) ? order : null;
}

function buildReleaseRecords(plan, releases) {
  const byId = new Map();
  const orderedRealReleases = releases
    .map((release, index) => ({ release, index }))
    .sort((left, right) => {
      const leftOrder = releaseOrderValue(left.release);
      const rightOrder = releaseOrderValue(right.release);
      const hasLeftOrder = leftOrder !== null;
      const hasRightOrder = rightOrder !== null;
      if (hasLeftOrder && hasRightOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (hasLeftOrder !== hasRightOrder) return hasLeftOrder ? -1 : 1;
      return (
        String(left.release.start_date ?? '').localeCompare(
          String(right.release.start_date ?? '')
        ) || left.index - right.index
      );
    })
    .map(({ release }) => release);
  for (const release of orderedRealReleases) {
    const id = String(release?.release_id ?? '').trim();
    if (!id || byId.has(id)) {
      throw new FeatureStageSchedulingError('Release inputs require unique release_id values.', {
        code: 'INVALID_RELEASE_INPUT',
        details: { releaseId: id || null },
      });
    }
    byId.set(id, { ...release, release_type: 'Real' });
  }
  for (const release of plan.tbc_generation?.releases || []) {
    const id = String(release?.release_id ?? '').trim();
    if (!id || byId.has(id)) {
      throw new FeatureStageSchedulingError('Generated release IDs must be unique.', {
        code: 'INVALID_PLAN_RESULT',
        details: { releaseId: id || null },
      });
    }
    byId.set(id, { ...release, release_type: 'TBC' });
  }
  return byId;
}

function scheduleFeatureStages(plan, { releases, capacities }) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.schedule)) {
    throw new FeatureStageSchedulingError('plan.schedule must be an array.', {
      code: 'INVALID_PLAN_RESULT',
    });
  }
  if (!Array.isArray(releases) || !Array.isArray(capacities)) {
    throw new FeatureStageSchedulingError('releases and capacities must be arrays.', {
      code: 'INVALID_SCHEDULE_INPUT',
    });
  }

  validateCapacityUsage(plan, capacities);
  const releaseRecords = buildReleaseRecords(plan, releases);
  const groupedFeatures = new Map([...releaseRecords.keys()].map((releaseId) => [releaseId, []]));
  const requiredByFeature = initialRequiredEffort(plan);

  for (const feature of plan.schedule) {
    const featureId = String(feature?.feature_id ?? '').trim();
    const priority = Number(feature?.priority);
    const inputOrder = Number(feature?.input_order);
    if (!featureId || !Number.isFinite(priority) || !Number.isFinite(inputOrder)) {
      throw new FeatureStageSchedulingError(
        'Plan schedule features require IDs and numeric ordering.',
        {
          code: 'INVALID_PLAN_RESULT',
          details: { featureId: featureId || null },
        }
      );
    }
    if (!Array.isArray(feature.allocations) || feature.allocations.length === 0) {
      throw new FeatureStageSchedulingError(
        `Feature ${featureId} has no release allocation records.`,
        {
          code: 'INVALID_PLAN_RESULT',
          details: { featureId },
        }
      );
    }
    const remainingRequired = {
      ...(requiredByFeature.get(featureId) || { build: null, st: null }),
    };
    for (const allocation of feature.allocations || []) {
      const releaseId = String(allocation?.release_id ?? '').trim();
      if (!releaseRecords.has(releaseId)) {
        throw new FeatureStageSchedulingError(
          `Feature ${featureId} references missing release ${releaseId || '(blank)'}.`,
          { code: 'INVALID_PLAN_RESULT', details: { featureId, releaseId: releaseId || null } }
        );
      }
      const build = stageEffort(allocation, 'build', featureId);
      const st = stageEffort(allocation, 'st', featureId);
      if (remainingRequired.build === null && build.requested !== null) {
        remainingRequired.build = build.requested;
      }
      if (remainingRequired.st === null && st.requested !== null) {
        remainingRequired.st = st.requested;
      }
      const hasAllocatedEffort = build.allocated > EPSILON || st.allocated > EPSILON;
      const hasUnallocatedEffort = build.remaining > EPSILON || st.remaining > EPSILON;
      const hasHardDependencyBlock = (allocation.incomplete_reasons || []).some(
        (reason) => typeof reason === 'string' && reason.startsWith('hard_dependency_blocked_')
      );
      if (hasAllocatedEffort || hasUnallocatedEffort || hasHardDependencyBlock) {
        groupedFeatures.get(releaseId).push({
          feature,
          allocation,
          requiredEffort: { ...remainingRequired },
          overallRequiredEffort: {
            ...(requiredByFeature.get(featureId) || { build: null, st: null }),
          },
        });
      }
      if (remainingRequired.build !== null) {
        remainingRequired.build = Math.max(0, remainingRequired.build - build.allocated);
      }
      if (remainingRequired.st !== null) {
        remainingRequired.st = Math.max(0, remainingRequired.st - st.allocated);
      }
    }
  }

  const outputReleases = [...releaseRecords.values()].map((release) => {
    const releaseId = String(release.release_id);
    const window = normalizeWindow(release);
    // Capacity is an aggregate team pool, and the PM may run multiple features
    // in parallel. Preserve PlanResult priority order in the rows, but anchor
    // each feature to the release start instead of serializing team work.
    const releaseFeatures = groupedFeatures.get(releaseId) || [];

    const features = releaseFeatures.map(
      ({ feature, allocation, requiredEffort, overallRequiredEffort }) => {
        const cursor = window.start ? nextWorkday(dateFromKey(window.start)) : null;
        const build = stageEffort(allocation, 'build', feature.feature_id);
        const st = stageEffort(allocation, 'st', feature.feature_id);
        const buildDays = build.allocated / STORY_POINTS_PER_WORKDAY;
        const stDays = st.allocated / STORY_POINTS_PER_WORKDAY;
        const buildVisualDays = buildDays;
        const stVisualDays = stDays > 0 ? Math.max(stDays, buildDays) : 0;
        const stageIncomplete = (stage) => stage.remaining > EPSILON || stage.blocked > EPSILON;
        const baseReasons = [...new Set(allocation.incomplete_reasons || [])];
        if (
          build.remaining > EPSILON &&
          !baseReasons.some((reason) => reason.startsWith('build_'))
        ) {
          baseReasons.push('build_effort_unallocated');
        }
        if (st.remaining > EPSILON && !baseReasons.some((reason) => reason.startsWith('st_'))) {
          baseReasons.push('st_effort_unallocated');
        }
        if (build.blocked > EPSILON && !baseReasons.includes('hard_dependency_blocked_build')) {
          baseReasons.push('hard_dependency_blocked_build');
        }
        if (st.blocked > EPSILON && !baseReasons.includes('hard_dependency_blocked_st')) {
          baseReasons.push('hard_dependency_blocked_st');
        }

        const makeStage = (name, effort, requiredSp, effortDays, visualDays) => {
          if (effort.allocated <= 0) {
            return {
              allocated_sp: effort.allocated,
              scheduled_sp: 0,
              unscheduled_sp: 0,
              required_sp: requiredSp,
              remaining_effort_after_allocation_sp: effort.remaining,
              effort_duration_workdays: 0,
              scheduled_duration_workdays: 0,
              visual_duration_workdays: 0,
              start_date: null,
              end_date: null,
              status: 'not_allocated',
              reasons: effort.remaining > EPSILON || effort.blocked > EPSILON ? baseReasons : [],
            };
          }
          const scheduledEffort = cursor && !window.reason ? effort.allocated : 0;
          const unscheduledEffort = Math.max(0, effort.allocated - scheduledEffort);
          const scheduledVisualDays = scheduledEffort > EPSILON ? visualDays : 0;
          const start = scheduledEffort > 0 && cursor ? new Date(cursor) : null;
          const end =
            start && scheduledVisualDays > 0
              ? addWorkdays(start, Math.ceil(scheduledVisualDays) - 1)
              : null;
          const reasons = [];
          if (window.reason) reasons.push(window.reason);
          const hasScheduledEffort = scheduledEffort > EPSILON;
          const status = !hasScheduledEffort
            ? 'unscheduled'
            : unscheduledEffort > EPSILON
              ? 'partial'
              : 'scheduled';
          return {
            allocated_sp: effort.allocated,
            scheduled_sp: scheduledEffort,
            unscheduled_sp: unscheduledEffort,
            required_sp: requiredSp,
            remaining_effort_after_allocation_sp: effort.remaining,
            effort_duration_workdays: effortDays,
            scheduled_duration_workdays: scheduledEffort / STORY_POINTS_PER_WORKDAY,
            visual_duration_workdays: scheduledVisualDays,
            start_date: hasScheduledEffort && start ? formatDate(start) : null,
            end_date: hasScheduledEffort && end ? formatDate(end) : null,
            status,
            reasons,
            stage: name,
          };
        };

        const buildStage = makeStage(
          'Build',
          build,
          requiredEffort.build,
          buildDays,
          buildVisualDays
        );
        const stStage = makeStage('ST', st, requiredEffort.st, stDays, stVisualDays);
        const scheduledStages = [buildStage, stStage].filter(
          (stage) => stage.scheduled_sp > EPSILON
        );
        const featureStart =
          scheduledStages
            .map((stage) => stage.start_date)
            .filter(Boolean)
            .sort()[0] ?? null;
        const featureFinish =
          scheduledStages
            .map((stage) => stage.end_date)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null;
        const remaining = stageIncomplete(build) || stageIncomplete(st);
        const stageMissedWindow = [buildStage, stStage].some(
          (stage) => stage.unscheduled_sp > EPSILON
        );
        const reasons = [...new Set([...baseReasons, ...buildStage.reasons, ...stStage.reasons])];
        const hasAnyEffort = build.allocated > 0 || st.allocated > 0;
        if (!hasAnyEffort && reasons.length === 0) reasons.push('no_stage_effort_allocated');
        const requiredTotal =
          requiredEffort.build !== null && requiredEffort.st !== null
            ? requiredEffort.build + requiredEffort.st
            : null;
        const allocatedTotal = build.allocated + st.allocated;
        const scheduledTotal = buildStage.scheduled_sp + stStage.scheduled_sp;
        const unscheduledTotal = buildStage.unscheduled_sp + stStage.unscheduled_sp;
        const allocationPercent =
          requiredTotal > 0 && allocatedTotal <= requiredTotal + EPSILON
            ? (allocatedTotal / requiredTotal) * 100
            : null;
        const scheduledPercent =
          requiredTotal > 0 && scheduledTotal <= requiredTotal + EPSILON
            ? (scheduledTotal / requiredTotal) * 100
            : null;
        const status = !hasAnyEffort
          ? 'no_allocated_work'
          : remaining ||
              reasons.length > 0 ||
              stageMissedWindow ||
              (allocationPercent !== null && allocationPercent < 100 - EPSILON)
            ? scheduledStages.length > 0
              ? 'partial'
              : 'unscheduled'
            : 'scheduled';

        return {
          feature_id: feature.feature_id,
          feature_name: feature.feature_name ?? feature.feature_id,
          team_id: feature.team_id ?? null,
          team_name: feature.team_name ?? null,
          priority: Number(feature.priority),
          input_order: Number(feature.input_order),
          required_effort_sp: {
            build: requiredEffort.build,
            st: requiredEffort.st,
            total: requiredTotal,
          },
          overall_required_effort_sp: {
            build: overallRequiredEffort.build,
            st: overallRequiredEffort.st,
            total:
              overallRequiredEffort.build !== null && overallRequiredEffort.st !== null
                ? overallRequiredEffort.build + overallRequiredEffort.st
                : null,
          },
          allocated_effort_sp: {
            build: build.allocated,
            st: st.allocated,
            total: allocatedTotal,
          },
          scheduled_effort_sp: {
            build: buildStage.scheduled_sp,
            st: stStage.scheduled_sp,
            total: scheduledTotal,
          },
          unscheduled_effort_sp: {
            build: buildStage.unscheduled_sp,
            st: stStage.unscheduled_sp,
            total: unscheduledTotal,
          },
          remaining_effort_after_allocation_sp: build.remaining + st.remaining,
          allocation_percent: allocationPercent,
          scheduled_percent: scheduledPercent,
          build: buildStage,
          st: stStage,
          start_date: featureStart,
          finish_date: featureFinish,
          status,
          reasons,
          incomplete_reasons: baseReasons,
        };
      }
    );

    return {
      release_id: releaseId,
      release_name: String(release.release_name ?? releaseId),
      release_type: release.release_type,
      start_date: window.start,
      end_date: window.end,
      window_status: window.reason ? 'invalid' : 'valid',
      reasons: window.reason ? [window.reason] : [],
      features,
    };
  });

  return {
    story_points_per_workday: STORY_POINTS_PER_WORKDAY,
    calendar: 'Monday-Friday; no holidays',
    releases: outputReleases,
  };
}

module.exports = { FeatureStageSchedulingError, STORY_POINTS_PER_WORKDAY, scheduleFeatureStages };
