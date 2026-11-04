export async function loadComputedGanttSchedule(requestJson) {
  const planResponse = await requestJson('/api/plan/compute', {
    method: 'POST',
    body: '{}',
  });
  if (!planResponse?.data || !Array.isArray(planResponse.data.schedule)) {
    throw new Error('The planning API returned an invalid plan response.');
  }
  if (!Number.isSafeInteger(planResponse.workbookVersion) || planResponse.workbookVersion < 0) {
    throw new Error('The planning API did not return a valid workbook version.');
  }

  const scheduleResponse = await requestJson('/api/plan/schedule', {
    method: 'POST',
    body: JSON.stringify({
      plan: planResponse.data,
      expectedVersion: planResponse.workbookVersion,
    }),
  });
  if (scheduleResponse.workbookVersion !== planResponse.workbookVersion) {
    const error = new Error(
      'The workbook changed while preparing the chart. Refresh and try again.'
    );
    error.status = 409;
    throw error;
  }
  if (!scheduleResponse.data || !Array.isArray(scheduleResponse.data.releases)) {
    throw new Error('The scheduling API returned an invalid feature schedule.');
  }
  return {
    plan: planResponse.data,
    workbookVersion: planResponse.workbookVersion,
    featureSchedule: scheduleResponse.data,
  };
}

export async function loadScenarioGanttSchedule(requestJson, globalPercent, featureOverrides) {
  const response = await requestJson('/api/plan/scenario', {
    method: 'POST',
    body: JSON.stringify({ globalPercent, featureOverrides }),
  });
  if (
    !response?.data?.plan ||
    !Array.isArray(response.data.plan.schedule) ||
    !response.data.featureSchedule ||
    !Array.isArray(response.data.featureSchedule.releases)
  ) {
    throw new Error('The scenario API returned an invalid schedule.');
  }
  return {
    plan: response.data.plan,
    featureSchedule: response.data.featureSchedule,
    workbookVersion: response.workbookVersion,
  };
}

function countWeekdays(startDate, endDate) {
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  let count = 0;
  while (current <= end) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

function stableId(value) {
  return encodeURIComponent(String(value));
}

function safeTaskText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function isWorkday(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.getUTCDay() !== 0 && parsed.getUTCDay() !== 6;
}

function validReleaseWindow(release) {
  const start = dateKey(release.start_date);
  const end = dateKey(release.end_date);
  return release.window_status === 'valid' && start && end && start <= end ? { start, end } : null;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatStoryPoints(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function featureEffortSummary(overall) {
  if (!overall?.valid) return 'Overall allocation values unavailable.';
  const values = ['build', 'st'].map((activity) => {
    const name = activity === 'build' ? 'Build' : 'ST';
    const required = overall.required[activity];
    const allocated = overall.allocated[activity];
    const remaining = Math.max(0, required - allocated);
    return `${name}: ${formatStoryPoints(allocated)}/${formatStoryPoints(required)} SP allocated; ${formatStoryPoints(remaining)} SP unallocated`;
  });
  return `${overall.status} overall · ${values.join(' · ')}`;
}

function stageSpan(stage, window) {
  const start = dateKey(stage.start_date);
  const end = dateKey(stage.end_date);
  const allocated = Number(stage.allocated_sp);
  if (
    !['scheduled', 'partial'].includes(stage.status) ||
    !start ||
    !end ||
    start > end ||
    !isWorkday(start) ||
    !isWorkday(end) ||
    !window ||
    start < window.start ||
    !Number.isFinite(allocated) ||
    allocated <= 0
  ) {
    return null;
  }
  return { start, end };
}

function featureEffortLabel(feature, stageName, overallRequired) {
  const key = stageName === 'Build' ? 'build' : 'st';
  const stage = feature[key] || {};
  const allocated = feature.allocated_effort_sp?.[key] ?? stage.allocated_sp;
  if (!finiteNonNegative(allocated)) return `${stageName}: —`;
  const required = overallRequired?.[key];
  return finiteNonNegative(required)
    ? `${stageName}: ${formatStoryPoints(allocated)}/${formatStoryPoints(required)} SP`
    : `${stageName}: ${formatStoryPoints(allocated)} SP / requirement unavailable`;
}

function allocationSummaryByFeature(featureSchedule) {
  const summaries = new Map();
  for (const release of featureSchedule?.releases || []) {
    for (const feature of release.features || []) {
      const id = String(feature.feature_id);
      const required = feature.overall_required_effort_sp;
      const summary = summaries.get(id) || {
        required: { build: null, st: null },
        allocated: { build: 0, st: 0 },
        valid: true,
      };
      for (const activity of ['build', 'st']) {
        const requiredValue = required?.[activity];
        const allocatedValue =
          feature.allocated_effort_sp?.[activity] ?? feature[activity]?.allocated_sp;
        if (!finiteNonNegative(requiredValue) || !finiteNonNegative(allocatedValue)) {
          summary.valid = false;
          continue;
        }
        if (summary.required[activity] !== null && summary.required[activity] !== requiredValue) {
          summary.valid = false;
        } else {
          summary.required[activity] = requiredValue;
        }
        summary.allocated[activity] += allocatedValue;
      }
      summaries.set(id, summary);
    }
  }
  for (const summary of summaries.values()) {
    if (!summary.valid) {
      summary.status = 'Allocation unavailable';
      continue;
    }
    const fullyCovered = ['build', 'st'].every(
      (activity) =>
        summary.required[activity] === 0 ||
        summary.allocated[activity] + 1e-9 >= summary.required[activity]
    );
    const hasAllocatedEffort = summary.allocated.build + summary.allocated.st > 1e-9;
    summary.status = fullyCovered ? 'Fully' : hasAllocatedEffort ? 'Partially' : 'Unallocated';
  }
  return summaries;
}

function cumulativeAllocationStatus(cumulative, overall) {
  if (!overall?.valid) return 'Allocation unavailable';
  const fullyCovered = ['build', 'st'].every(
    (activity) =>
      overall.required[activity] === 0 || cumulative[activity] + 1e-9 >= overall.required[activity]
  );
  const hasAllocatedEffort = cumulative.build + cumulative.st > 1e-9;
  return fullyCovered ? 'Fully' : hasAllocatedEffort ? 'Partially' : 'Unallocated';
}

function featureBarText(feature, overall) {
  return `${featureEffortLabel(feature, 'Build', overall?.required)} | ${featureEffortLabel(feature, 'ST', overall?.required)}`;
}

function truncateFeatureName(value) {
  const name = String(value ?? '');
  return name.length > 40 ? `${name.slice(0, 40)}...` : name;
}

function featureDisplayLabel(feature) {
  return `${feature.feature_id}: ${truncateFeatureName(feature.feature_name || feature.feature_id)}`;
}

function formatAllocationAmount(value) {
  if (!finiteNonNegative(value)) return '—';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatGanttEffortAllocation(task, activity) {
  const allocated = task.allocated_effort_sp?.[activity] ?? task[activity]?.allocated_sp;
  const required = task.overall_required_effort_sp?.[activity];
  return `${formatAllocationAmount(allocated)}/${formatAllocationAmount(required)} SP`;
}

export function formatGanttTimelineStatus(task) {
  if (task.timeline_status === 'complete') return 'Complete';
  if (task.timeline_status === 'partial') return 'Partial';
  if (task.timeline_status === 'unscheduled') return 'Unscheduled';
  return '';
}

export function filterGanttViewByTeam(view, teamId) {
  if (!teamId) return view;
  const featureTasks = view.tasks.filter(
    (task) => task.task_kind === 'feature' && String(task.team_id ?? '') === teamId
  );
  const featureIds = new Set(featureTasks.map((task) => task.id));
  const releaseIds = new Set(featureTasks.map((task) => task.parent));
  const tasks = view.tasks.filter(
    (task) => task.task_kind === 'feature' ? featureIds.has(task.id) : releaseIds.has(task.id)
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  return {
    ...view,
    tasks,
    links: view.links.filter((link) => taskIds.has(link.source) && taskIds.has(link.target)),
    statusRows: view.statusRows.filter(
      (row) => row.team_id === undefined || String(row.team_id ?? '') === teamId
    ),
  };
}

export function makeGanttExportRows(tasks) {
  const features = new Map();
  for (const task of tasks.filter((item) => item.task_kind === 'feature')) {
    const featureId = String(task.feature_id ?? '');
    const row = features.get(featureId) || {
      feature_id: featureId,
      feature_name: task.display_feature_name || truncateFeatureName(task.feature_name),
      team: String(task.team_name ?? ''),
      allocated: { build: 0, st: 0 },
      required: task.overall_required_effort_sp || {},
      work_days: 0,
      has_work_days: false,
    };
    for (const activity of ['build', 'st']) {
      const amount = task.allocated_effort_sp?.[activity] ?? task[activity]?.allocated_sp;
      if (finiteNonNegative(amount)) row.allocated[activity] += amount;
    }
    if (task.timeline_status !== 'unscheduled' && finiteNonNegative(task.duration)) {
      row.work_days += task.duration;
      row.has_work_days = true;
    }
    row.allocation = String(task.allocation_status ?? '');
    row.timeline = formatGanttTimelineStatus(task);
    features.set(featureId, row);
  }
  return [...features.values()].map((row) => ({
    feature_id: row.feature_id,
    feature_name: row.feature_name,
    team: row.team,
    build_allocation: `${formatAllocationAmount(row.allocated.build)}/${formatAllocationAmount(row.required.build)} SP`,
    st_allocation: `${formatAllocationAmount(row.allocated.st)}/${formatAllocationAmount(row.required.st)} SP`,
    work_days: row.has_work_days ? row.work_days : '',
    allocation: row.allocation,
    timeline: row.timeline,
  }));
}

export function makeGanttExportGrid(tasks) {
  const releases = tasks.filter((task) => task.task_kind === 'release');
  const features = new Map();
  for (const task of tasks.filter((item) => item.task_kind === 'feature')) {
    const featureId = String(task.feature_id ?? '');
    const feature = features.get(featureId) || {
      feature_id: featureId,
      feature_name: task.display_feature_name || truncateFeatureName(task.feature_name),
      team: String(task.team_name ?? ''),
      cells: {},
    };
    const build = task.allocated_effort_sp?.build ?? task.build?.allocated_sp ?? 0;
    const st = task.allocated_effort_sp?.st ?? task.st?.allocated_sp ?? 0;
    if (build > 0 || st > 0) {
      feature.cells[task.parent] = {
        value: `Build: ${formatAllocationAmount(build)} SP · ST: ${formatAllocationAmount(st)} SP`,
        status: task.timeline_status,
      };
    }
    features.set(featureId, feature);
  }
  return {
    releases: releases.map((release) => ({ id: release.id, name: release.release_name || release.text })),
    rows: [...features.values()],
  };
}

function dependencyEndpointTask(tasks, featureId, side, preferredReleaseId = null) {
  let candidates = tasks.filter(
    (task) => task.task_kind === 'feature' && String(task.feature_id) === String(featureId)
  );
  if (preferredReleaseId !== null && preferredReleaseId !== undefined) {
    const sameReleaseCandidates = candidates.filter(
      (task) => String(task.release_id) === String(preferredReleaseId)
    );
    if (sameReleaseCandidates.length > 0) candidates = sameReleaseCandidates;
  }
  const datedCandidates = candidates.filter(
    (task) =>
      typeof task.start_date === 'string' &&
      typeof task.intended_end_date === 'string' &&
      task.start_date <= task.intended_end_date
  );
  if (candidates.length === 0) return null;
  // Prefer scheduled release instances. If the feature is blocked or otherwise
  // unscheduled, keep the relationship by using its existing visible row.
  if (datedCandidates.length === 0) return candidates[0];

  const endpointCandidates = datedCandidates;
  endpointCandidates.sort((left, right) => {
    const leftDate = side === 'predecessor' ? left.intended_end_date : left.start_date;
    const rightDate = side === 'predecessor' ? right.intended_end_date : right.start_date;
    const dateOrder = leftDate.localeCompare(rightDate);
    if (dateOrder !== 0) return side === 'predecessor' ? -dateOrder : dateOrder;
    return String(left.release_id).localeCompare(String(right.release_id));
  });
  return endpointCandidates[0] || null;
}

function dependencyTaskDetails(dependencies, featureId) {
  const unique = new Map();
  for (const dependency of dependencies) {
    if (
      String(dependency.predecessor_feature_id) !== String(featureId) &&
      String(dependency.dependent_feature_id) !== String(featureId)
    ) {
      continue;
    }
    const detail = {
      dependency_type: dependency.dependency_type,
      dependency_status: dependency.dependency_status,
      direction:
        String(dependency.predecessor_feature_id) === String(featureId)
          ? 'successor'
          : 'predecessor',
    };
    const key = [detail.dependency_type, detail.dependency_status, detail.direction].join('|');
    unique.set(key, detail);
  }
  return [...unique.values()].sort(
    (left, right) =>
      String(left.dependency_type).localeCompare(String(right.dependency_type)) ||
      String(left.dependency_status).localeCompare(String(right.dependency_status)) ||
      left.direction.localeCompare(right.direction)
  );
}

function makeDependencyLinks(tasks, dependencies) {
  const links = [];
  const diagnostics = [];
  const seenDependencyIds = new Set();
  const seenEndpointPairs = new Set();
  for (const [index, dependency] of dependencies.entries()) {
    const dependencyId = String(dependency.dependency_id ?? `dependency-${index}`);
    if (seenDependencyIds.has(dependencyId)) continue;
    seenDependencyIds.add(dependencyId);
    const predecessorId = String(dependency.predecessor_feature_id ?? '');
    const dependentId = String(dependency.dependent_feature_id ?? '');
    const target = dependencyEndpointTask(tasks, dependentId, 'successor');
    const source = dependencyEndpointTask(
      tasks,
      predecessorId,
      'predecessor',
      target && !hasScheduledDates(target) ? target.release_id : null
    );
    if (!source || !target) {
      diagnostics.push({
        dependency_id: dependency.dependency_id ?? null,
        reason: !source
          ? `No visible feature row is available for predecessor ${predecessorId}.`
          : `No visible feature row is available for successor ${dependentId}.`,
      });
      continue;
    }
    const pairKey = `${source.id}\u0000${target.id}`;
    if (seenEndpointPairs.has(pairKey)) continue;
    seenEndpointPairs.add(pairKey);
    links.push({
      id: `dependency-${stableId(dependencyId)}`,
      source: source.id,
      target: target.id,
      type: '0',
      readonly: true,
      editable: false,
      dependency_id: dependency.dependency_id ?? null,
      dependency_type: dependency.dependency_type,
      dependency_status: dependency.dependency_status,
    });
  }
  return { links, diagnostics };
}

export function makeGanttTasks(featureSchedule, dependencies = []) {
  const tasks = [];
  const statusRows = [];
  const overallAllocations = allocationSummaryByFeature(featureSchedule);
  const cumulativeEffortByFeature = new Map();
  for (const release of featureSchedule?.releases || []) {
    const releaseKey = stableId(release.release_id);
    const window = validReleaseWindow(release);
    const releaseTask = {
      id: `release-${releaseKey}`,
      text:
        release.release_type === 'TBC'
          ? `TBC release — ${safeTaskText(release.release_name)}`
          : safeTaskText(release.release_name),
      open: true,
      readonly: true,
      task_kind: 'release',
      release_type: release.release_type,
      release_name: release.release_name,
      ...(window
        ? {
            start_date: window.start,
            duration: countWeekdays(window.start, window.end),
            intended_end_date: window.end,
          }
        : {}),
    };
    const releaseTaskIncluded = Boolean(window && releaseTask.duration > 0);
    if (releaseTaskIncluded) tasks.push(releaseTask);
    if (!window) {
      statusRows.push({
        id: `release-warning-${releaseKey}`,
        label: release.release_name,
        status: 'unscheduled',
        reasons: release.reasons?.length ? release.reasons : ['release_window_missing_or_invalid'],
      });
    }

    for (const feature of release.features || []) {
      const featureKey = stableId(feature.feature_id);
      const featureId = String(feature.feature_id);
      const overallAllocation = overallAllocations.get(featureId);
      const cumulativeEffort = cumulativeEffortByFeature.get(featureId) || {
        build: 0,
        st: 0,
      };
      for (const activity of ['build', 'st']) {
        const allocated =
          feature.allocated_effort_sp?.[activity] ?? feature[activity]?.allocated_sp;
        if (finiteNonNegative(allocated)) cumulativeEffort[activity] += allocated;
      }
      cumulativeEffortByFeature.set(featureId, cumulativeEffort);
      const hasReleaseAllocation = ['build', 'st'].some((activity) => {
        const allocated =
          feature.allocated_effort_sp?.[activity] ?? feature[activity]?.allocated_sp;
        return finiteNonNegative(allocated) && allocated > 1e-9;
      });
      const scheduledStages = [feature.build || {}, feature.st || {}]
        .map((stage) => stageSpan(stage, window))
        .filter(Boolean);
      const featureStart = scheduledStages.map((stage) => stage.start).sort()[0];
      const featureFinish = scheduledStages
        .map((stage) => stage.end)
        .sort()
        .at(-1);
      if (releaseTaskIncluded && hasReleaseAllocation) {
        const taskStatus =
          scheduledStages.length === 0 ||
          feature.status === 'unscheduled' ||
          feature.status === 'no_allocated_work'
            ? 'unscheduled'
            : feature.status === 'scheduled'
              ? 'scheduled'
              : 'partial';
        const cumulativeComplete =
          overallAllocation?.valid &&
          ['build', 'st'].every(
            (activity) =>
              overallAllocation.required[activity] === 0 ||
              cumulativeEffort[activity] + 1e-9 >= overallAllocation.required[activity]
          );
        const hasCumulativeEffort = cumulativeEffort.build + cumulativeEffort.st > 1e-9;
        const cumulativeTimelineStatus =
          scheduledStages.length === 0 &&
          ['unscheduled', 'no_allocated_work'].includes(feature.status)
            ? 'unscheduled'
            : cumulativeComplete
              ? 'complete'
              : hasCumulativeEffort || scheduledStages.length > 0
                ? 'partial'
                : 'unscheduled';
        tasks.push({
          id: `feature-${releaseKey}-${featureKey}`,
          task_kind: 'feature',
          text: safeTaskText(featureDisplayLabel(feature)),
          bar_text: featureBarText(feature, overallAllocation),
          feature_name: feature.feature_name || feature.feature_id,
          display_feature_name: truncateFeatureName(feature.feature_name || feature.feature_id),
          team_id: feature.team_id ?? null,
          team_name: feature.team_name ?? null,
          parent: releaseTask.id,
          ...(scheduledStages.length > 0
            ? {
                start_date: featureStart,
                duration: countWeekdays(featureStart, featureFinish),
                intended_end_date: featureFinish,
                summary_from_scheduled_stages: true,
              }
            : { unscheduled: true }),
          open: true,
          readonly: true,
          release_type: release.release_type,
          feature_id: feature.feature_id,
          release_id: release.release_id,
          status: taskStatus,
          timeline_status: cumulativeTimelineStatus,
          allocation_status: cumulativeAllocationStatus(cumulativeEffort, overallAllocation),
          allocated_effort_sp: feature.allocated_effort_sp,
          overall_required_effort_sp: overallAllocation?.required,
          dependency_details: dependencyTaskDetails(dependencies, feature.feature_id),
        });
      }

      const status =
        scheduledStages.length > 0
          ? feature.status === 'scheduled'
            ? 'scheduled'
            : 'partial'
          : feature.status === 'scheduled'
            ? 'unscheduled'
            : feature.status;
      const reasons = [...(feature.reasons || []), ...(feature.incomplete_reasons || [])];
      if (scheduledStages.length === 0 && reasons.length === 0) {
        reasons.push(
          feature.status === 'no_allocated_work'
            ? 'no_stage_effort_allocated'
            : 'no_valid_scheduled_stage_dates'
        );
      }
      if (hasReleaseAllocation && status !== 'scheduled') {
        statusRows.push({
          id: `feature-warning-${releaseKey}-${featureKey}`,
          label: `${release.release_name} · ${featureDisplayLabel(feature)}`,
          team_id: feature.team_id ?? null,
          status,
          reasons: [...new Set(reasons)],
          effortSummary: featureEffortSummary(overallAllocation),
        });
      }
    }
  }
  const { links, diagnostics: linkDiagnostics } = makeDependencyLinks(tasks, dependencies);
  return { tasks, statusRows, links, linkDiagnostics };
}

function hasScheduledDates(task) {
  return (
    typeof task?.start_date === 'string' &&
    typeof task?.intended_end_date === 'string' &&
    task.start_date <= task.intended_end_date
  );
}

/**
 * GPL Gantt 9.1.4 strips addTaskLayer from the public singleton. Draw links
 * with an SVG in the rendered bars area, using the real bar and row rectangles.
 */
export function addUndatedDependencyLayer(ganttInstance, dataRef) {
  let frame = null;
  let currentSvg = null;

  function draw() {
    currentSvg?.remove();
    currentSvg = null;
    const dataArea = document.querySelector('.gantt_data_area');
    const taskRows = document.querySelectorAll('.gantt_task_row[task_id]');
    if (!dataArea || taskRows.length === 0) return;

    const { tasks = [], links = [] } = dataRef.current || {};
    const taskById = new Map(tasks.map((task) => [String(task.id), task]));
    const rowById = new Map([...taskRows].map((row) => [row.getAttribute('task_id'), row]));
    const overlayLinks = links.filter((link) => {
      const source = taskById.get(String(link.source));
      const target = taskById.get(String(link.target));
      return source && target && (!hasScheduledDates(source) || !hasScheduledDates(target));
    });
    if (overlayLinks.length === 0) return;

    const areaRect = dataArea.getBoundingClientRect();
    const width = Math.max(dataArea.scrollWidth, areaRect.width);
    const height = Math.max(dataArea.scrollHeight, areaRect.height);
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('class', 'gantt-undated-dependency-overlay');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '20';

    overlayLinks.forEach((link, index) => {
      const sourceId = String(link.source);
      const targetId = String(link.target);
      const sourceTask = taskById.get(sourceId);
      const targetTask = taskById.get(targetId);
      const sourceRow = rowById.get(sourceId);
      const targetRow = rowById.get(targetId);
      if (!sourceTask || !targetTask || !sourceRow || !targetRow) return;

      const sourceBar = [...dataArea.querySelectorAll('.gantt_task_line[task_id]')].find(
        (bar) => bar.getAttribute('task_id') === sourceId
      );
      const targetBar = [...dataArea.querySelectorAll('.gantt_task_line[task_id]')].find(
        (bar) => bar.getAttribute('task_id') === targetId
      );
      const sourceRowRect = sourceRow.getBoundingClientRect();
      const targetRowRect = targetRow.getBoundingClientRect();
      const sourceBarRect = sourceBar?.getBoundingClientRect();
      const targetBarRect = targetBar?.getBoundingClientRect();
      const sourceY =
        (sourceBarRect
          ? (sourceBarRect.top + sourceBarRect.bottom) / 2
          : (sourceRowRect.top + sourceRowRect.bottom) / 2) - areaRect.top;
      const targetY =
        (targetBarRect
          ? (targetBarRect.top + targetBarRect.bottom) / 2
          : (targetRowRect.top + targetRowRect.bottom) / 2) - areaRect.top;
      const sourceHasDates = hasScheduledDates(sourceTask);
      const targetHasDates = hasScheduledDates(targetTask);
      const startX =
        sourceHasDates && sourceBarRect
          ? sourceBarRect.right - areaRect.left
          : targetHasDates && targetBarRect
            ? Math.max(4, targetBarRect.left - areaRect.left - 32)
            : 8;
      const endX =
        targetHasDates && targetBarRect ? targetBarRect.left - areaRect.left : startX + 32;
      const bendX = startX + (endX - startX) / 2;
      const color = link.dependency_type === 'Hard' ? '#9b382e' : '#586b7d';
      const markerId = `gantt-undated-dependency-arrow-${index}`;
      const marker = document.createElementNS(svgNamespace, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '4');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');
      const arrowhead = document.createElementNS(svgNamespace, 'path');
      arrowhead.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
      arrowhead.setAttribute('fill', color);
      marker.appendChild(arrowhead);
      const defs = document.createElementNS(svgNamespace, 'defs');
      defs.appendChild(marker);
      svg.appendChild(defs);

      const line = document.createElementNS(svgNamespace, 'path');
      line.setAttribute(
        'class',
        `gantt-dependency-${link.dependency_type?.toLowerCase() || 'normal'}`
      );
      line.setAttribute('d', `M ${startX} ${sourceY} H ${bendX} V ${targetY} H ${endX}`);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', link.dependency_type === 'Hard' ? '2.5' : '1.8');
      if (link.dependency_type !== 'Hard') line.setAttribute('stroke-dasharray', '4 3');
      line.setAttribute('marker-end', `url(#${markerId})`);
      svg.appendChild(line);
    });

    dataArea.appendChild(svg);
    currentSvg = svg;
  }

  function scheduleDraw() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      draw();
    });
  }

  const renderEventId = ganttInstance.attachEvent('onGanttRender', scheduleDraw);
  scheduleDraw();
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    ganttInstance.detachEvent(renderEventId);
    currentSvg?.remove();
  };
}

export function addGanttExclusiveEndDates(tasks, ganttInstance) {
  return tasks.map((task) => {
    if (!task.start_date || !Number.isFinite(Number(task.duration)) || Number(task.duration) <= 0) {
      return { ...task };
    }
    const startDate = ganttInstance.date.parseDate(task.start_date, 'parse_date');
    const endDate = ganttInstance.calculateEndDate({
      start_date: startDate,
      duration: Number(task.duration),
    });
    return {
      ...task,
      start_date: startDate,
      end_date: endDate,
      intended_end_date: task.intended_end_date || null,
    };
  });
}
