import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import { gantt } from 'dhtmlx-gantt';
import {
  addGanttExclusiveEndDates,
  loadComputedGanttSchedule,
  makeGanttTasks,
} from '../src/ganttPlanView.js';
import { compactWeekLabel, configureGantt } from '../src/ganttLifecycle.js';

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const ganttPackage = JSON.parse(
  await readFile(new URL('../../node_modules/dhtmlx-gantt/package.json', import.meta.url), 'utf8')
);
const component = await readFile(new URL('../src/GanttSchedulePage.jsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const license = await readFile(
  new URL('../public/licenses/dhtmlx-gantt-GPL-2.0.txt', import.meta.url),
  'utf8'
);

assert.equal(packageInfo.dependencies['dhtmlx-gantt'], '9.1.4');
assert.equal(ganttPackage.version, '9.1.4');
assert.equal(ganttPackage.license, 'GPL-2.0');
assert.equal(ganttPackage.version, '9.1.4');
assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 2/);
assert.match(component, /license text/);
assert.match(component, />\s*source\s*</);
const lifecycle = await readFile(new URL('../src/ganttLifecycle.js', import.meta.url), 'utf8');
assert.match(lifecycle, /gantt\.config\.readonly = true/);
assert.match(lifecycle, /gantt\.config\.drag_move = false/);
assert.match(lifecycle, /gantt\.config\.drag_resize = false/);
assert.match(lifecycle, /gantt\.config\.drag_progress = false/);
assert.match(lifecycle, /gantt\.config\.show_links = true/);
assert.match(lifecycle, /gantt\.config\.drag_links = false/);
assert.match(lifecycle, /gantt\.templates\.link_class/);
assert.match(lifecycle, /gantt\.init\(container\)/);
assert.match(lifecycle, /data: addExclusiveEndDates\(tasks, gantt\),[\s\S]*links: links\.map/);
assert.doesNotMatch(lifecycle, /gantt\.destructor\(/);
assert.match(component, /role="status"/);
assert.match(component, /role="alert"/);
assert.match(component, /Partial and unscheduled work/);
assert.match(component, /Computing the current release plan/);
assert.match(component, /No features in the computed plan/);
assert.match(component, /Retry/);
assert.match(component, /Features in the same release\s+can run in parallel/);
assert.doesNotMatch(component, /1 SP = 1 workday/);
assert.match(app, /content-gantt/);

const plan = {
  schedule: [{ feature_id: 'F1' }, { feature_id: 'F2' }],
};
const featureSchedule = {
  releases: [
    {
      release_id: 'R1',
      release_name: 'Release One',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F2',
          feature_name: 'Second priority',
          priority: 2,
          input_order: 1,
          status: 'scheduled',
          start_date: '2026-11-04',
          finish_date: '2026-11-05',
          reasons: [],
          incomplete_reasons: [],
          build: {
            status: 'scheduled',
            start_date: '2026-11-04',
            end_date: '2026-11-04',
            allocated_sp: 1,
            effort_duration_workdays: 1,
            visual_duration_workdays: 1,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-05',
            end_date: '2026-11-05',
            allocated_sp: 1,
            effort_duration_workdays: 1,
            visual_duration_workdays: 1,
          },
        },
        {
          feature_id: 'F1',
          feature_name: 'First priority',
          priority: 1,
          input_order: 3,
          status: 'partial',
          start_date: '2026-11-02',
          finish_date: '2026-11-03',
          reasons: ['hard_dependency_blocked_st'],
          incomplete_reasons: ['hard_dependency_blocked_st'],
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-03',
            allocated_sp: 2,
            effort_duration_workdays: 2,
            visual_duration_workdays: 2,
          },
          st: {
            status: 'not_allocated',
            start_date: null,
            end_date: null,
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
            reasons: ['hard_dependency_blocked_st'],
          },
        },
      ],
    },
    {
      release_id: 'TBC-GEN-001',
      release_name: 'TBC 1*',
      release_type: 'TBC',
      start_date: '2026-11-23',
      end_date: '2026-12-11',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F3',
          feature_name: 'TBC feature',
          priority: 4,
          input_order: 4,
          status: 'unscheduled',
          start_date: null,
          finish_date: null,
          reasons: ['release_window_exceeded'],
          incomplete_reasons: [],
          build: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 3,
            effort_duration_workdays: 3,
            visual_duration_workdays: 3,
            reasons: ['release_window_exceeded'],
          },
          st: {
            status: 'not_allocated',
            start_date: null,
            end_date: null,
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
            reasons: [],
          },
        },
      ],
    },
  ],
};
// The scheduling API preserves computePlan's dependency-aware consideration order.
featureSchedule.releases[0].features.reverse();

const dependencies = [
  {
    dependency_id: 'D-HARD',
    predecessor_feature_id: 'F1',
    dependent_feature_id: 'F2',
    dependency_type: 'Hard',
    dependency_status: 'Unresolved',
  },
  {
    dependency_id: 'D-NORMAL',
    predecessor_feature_id: 'F2',
    dependent_feature_id: 'F1',
    dependency_type: 'Normal',
    dependency_status: 'Resolved',
  },
  {
    dependency_id: 'D-HARD',
    predecessor_feature_id: 'F1',
    dependent_feature_id: 'F2',
    dependency_type: 'Hard',
    dependency_status: 'Unresolved',
  },
];
plan.dependency_graph = { edges: dependencies };
const calls = [];
const loaded = await loadComputedGanttSchedule(async (path, options) => {
  calls.push({ path, options });
  return path.endsWith('/compute')
    ? { ok: true, data: plan, workbookVersion: 42 }
    : { ok: true, data: featureSchedule, workbookVersion: 42 };
});
assert.equal(loaded.plan, plan);
assert.equal(loaded.workbookVersion, 42);
assert.deepEqual(
  calls.map(({ path, options }) => [path, options.method]),
  [
    ['/api/plan/compute', 'POST'],
    ['/api/plan/schedule', 'POST'],
  ]
);
assert.equal(
  calls.some(({ options }) => ['PUT', 'PATCH', 'DELETE'].includes(options.method)),
  false
);
assert.deepEqual(JSON.parse(calls[1].options.body), { plan, expectedVersion: 42 });

const view = makeGanttTasks(loaded.featureSchedule, loaded.plan.dependency_graph.edges);
const repeatedView = makeGanttTasks(loaded.featureSchedule, loaded.plan.dependency_graph.edges);
assert.deepEqual(view, repeatedView);
assert.equal(view.links.length, 2, 'duplicate dependency records produce no duplicate links');
const hardLink = view.links.find((link) => link.dependency_type === 'Hard');
const normalLink = view.links.find((link) => link.dependency_type === 'Normal');
assert.equal(hardLink.source, 'feature-R1-F1');
assert.equal(hardLink.target, 'feature-R1-F2');
assert.equal(hardLink.dependency_status, 'Unresolved');
assert.equal(normalLink.source, 'feature-R1-F2');
assert.equal(normalLink.target, 'feature-R1-F1');
assert.equal(normalLink.dependency_status, 'Resolved');
assert.ok(
  view.links.every(
    (link) => !link.source.startsWith('release-') && !link.target.startsWith('release-')
  )
);
assert.deepEqual(view.linkDiagnostics, []);
assert.ok(view.tasks.find((task) => task.feature_id === 'F2').dependency_details.length > 0);
assert.equal(
  makeGanttTasks(loaded.featureSchedule, [{ ...dependencies[0], dependency_status: 'Resolved' }])
    .links[0].dependency_status,
  'Resolved',
  'a resolved Hard dependency remains a visual link with its authoritative status'
);

const multipleReleaseSchedule = structuredClone(loaded.featureSchedule);
multipleReleaseSchedule.releases[1].features.push({
  feature_id: 'F1',
  feature_name: 'First priority',
  priority: 1,
  input_order: 3,
  status: 'partial',
  overall_required_effort_sp: { build: 4, st: 0, total: 4 },
  allocated_effort_sp: { build: 2, st: 0, total: 2 },
  build: {
    status: 'partial',
    start_date: '2026-11-23',
    end_date: '2026-11-24',
    allocated_sp: 2,
    effort_duration_workdays: 2,
    visual_duration_workdays: 2,
  },
  st: { status: 'not_allocated', allocated_sp: 0 },
});
const multipleReleaseBefore = JSON.stringify(multipleReleaseSchedule);
const multipleReleaseView = makeGanttTasks(multipleReleaseSchedule, [dependencies[0]]);
assert.equal(
  multipleReleaseView.links[0].source,
  'feature-TBC-GEN-001-F1',
  'use the latest dated predecessor release row to represent completion of distributed work'
);
assert.equal(JSON.stringify(multipleReleaseSchedule), multipleReleaseBefore);

const undatedEndpointView = makeGanttTasks(loaded.featureSchedule, [
  {
    dependency_id: 'D-UNSCHEDULED',
    predecessor_feature_id: 'F1',
    dependent_feature_id: 'F3',
    dependency_type: 'Hard',
    dependency_status: 'Resolved',
  },
]);
assert.equal(undatedEndpointView.links.length, 1);
assert.equal(undatedEndpointView.links[0].source, 'feature-R1-F1');
assert.equal(undatedEndpointView.links[0].target, 'feature-TBC-GEN-001-F3');
assert.equal(undatedEndpointView.linkDiagnostics.length, 0);
assert.equal(
  undatedEndpointView.tasks.some((task) => task.id.includes('D-UNSCHEDULED')),
  false,
  'the link targets the visible undated feature row without a fabricated task'
);
assert.ok(
  undatedEndpointView.tasks
    .filter((task) => task.task_kind === 'feature' && task.feature_id === 'F3')
    .every((task) => Object.hasOwn(task, 'unscheduled')),
  'an unscheduled endpoint remains an undated empty row'
);
const realReleaseTask = view.tasks.find((task) => task.id === 'release-R1');
const tbcReleaseTask = view.tasks.find((task) => task.id === 'release-TBC-GEN-001');
assert.equal(realReleaseTask.text, 'Release One');
assert.equal(tbcReleaseTask.text, 'TBC release — TBC 1*');
assert.equal(tbcReleaseTask.release_type, 'TBC');
assert.equal(
  view.tasks.find((task) => task.id === 'feature-TBC-GEN-001-F3').parent,
  tbcReleaseTask.id
);
assert.deepEqual(
  view.tasks
    .filter((task) => task.parent === realReleaseTask.id && task.feature_id)
    .map((task) => task.feature_id),
  ['F1', 'F2']
);
assert.equal(
  view.tasks.some((task) => task.id === 'stage-R1-F1-ST'),
  false
);
assert.equal(view.tasks.find((task) => task.id === 'feature-R1-F1').status, 'partial');
assert.ok(view.tasks.find((task) => task.id === 'feature-R1-F1').bar_text.includes('Build: 2 SP'));
assert.ok(view.tasks.find((task) => task.id === 'feature-R1-F1').bar_text.includes('ST: 0 SP'));
assert.equal(
  view.tasks.some((task) => task.id.startsWith('stage-')),
  false
);
assert.ok(
  view.statusRows.some((row) => row.label.includes('First priority') && row.status === 'partial')
);
assert.ok(
  view.statusRows.some((row) => row.label.includes('TBC feature') && row.status === 'unscheduled')
);
assert.equal(view.tasks.find((task) => task.id === 'feature-TBC-GEN-001-F3').unscheduled, true);
assert.deepEqual(
  view,
  repeatedView,
  'feature and stage IDs are deterministic across repeated views'
);
assert.equal(new Set(view.tasks.map((task) => task.id)).size, view.tasks.length);
assert.equal(new Set(view.statusRows.map((row) => row.id)).size, view.statusRows.length);

gantt.config.date_format = '%Y-%m-%d';
gantt.config.work_time = true;
gantt.setWorkTime({ day: 0, hours: false });
gantt.setWorkTime({ day: 6, hours: false });

function renderedLastWorkday(task) {
  assert.ok(task.start_date instanceof Date);
  assert.ok(task.end_date instanceof Date);
  const actualEnd = gantt.calculateEndDate({ start_date: task.end_date, duration: -1 });
  return gantt.date.date_to_str('%Y-%m-%d')(actualEnd);
}

function calculateGanttExclusiveEnd(start, duration) {
  const startDate = gantt.date.parseDate(start, 'parse_date');
  return gantt.date.date_to_str('%Y-%m-%d')(
    gantt.calculateEndDate({ start_date: startDate, duration })
  );
}

function verifyRenderedDates(tasks, expectedById) {
  const datedTasks = addGanttExclusiveEndDates(tasks, gantt);
  gantt.clearAll();
  gantt.parse({ data: datedTasks, links: [] });
  for (const [taskId, intendedEnd] of Object.entries(expectedById)) {
    const parsedTask = gantt.getTask(taskId);
    assert.equal(parsedTask.intended_end_date, intendedEnd);
    assert.equal(
      gantt.date.date_to_str('%Y-%m-%d')(parsedTask.end_date),
      calculateGanttExclusiveEnd(
        gantt.date.date_to_str('%Y-%m-%d')(parsedTask.start_date),
        parsedTask.duration
      ),
      `${taskId} uses dhtmlxGantt's exclusive end boundary`
    );
    assert.equal(renderedLastWorkday(parsedTask), intendedEnd, taskId);
    assert.equal(
      gantt.calculateDuration({ start_date: parsedTask.start_date, end_date: parsedTask.end_date }),
      parsedTask.duration,
      `${taskId} library duration`
    );
  }
  return datedTasks;
}

const realTasks = verifyRenderedDates(view.tasks, {
  'release-R1': '2026-11-20',
  'feature-R1-F1': '2026-11-03',
  'feature-R1-F2': '2026-11-05',
});
assert.equal(
  realTasks.find((task) => task.id === 'release-R1').duration,
  15,
  'release span includes configured working dates through Friday'
);

const oneDay = makeGanttTasks({
  releases: [
    {
      release_id: 'ONE',
      release_name: 'One day',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-02',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F1',
          feature_name: 'One day',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          start_date: '2026-11-02',
          finish_date: '2026-11-02',
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-02',
            allocated_sp: 1,
            effort_duration_workdays: 1,
            visual_duration_workdays: 1,
          },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
  ],
});
const oneDayTasks = verifyRenderedDates(oneDay.tasks, {
  'release-ONE': '2026-11-02',
  'feature-ONE-F1': '2026-11-02',
});
assert.equal(oneDayTasks.find((task) => task.id === 'feature-ONE-F1').duration, 1);

const fourteenStageTasks = makeGanttTasks({
  releases: [
    {
      release_id: 'FOURTEEN',
      release_name: 'Fourteen-day feature',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-30',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F14',
          feature_name: 'Build 14, ST 7',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          overall_required_effort_sp: { build: 14, st: 7, total: 21 },
          start_date: '2026-11-02',
          finish_date: '2026-11-19',
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-19',
            allocated_sp: 14,
            effort_duration_workdays: 14,
            visual_duration_workdays: 14,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-19',
            allocated_sp: 7,
            effort_duration_workdays: 7,
            visual_duration_workdays: 14,
          },
        },
      ],
    },
  ],
});
const fourteenGanttTasks = verifyRenderedDates(fourteenStageTasks.tasks, {
  'release-FOURTEEN': '2026-11-30',
  'feature-FOURTEEN-F14': '2026-11-19',
});
const fourteenFeature = fourteenGanttTasks.find((task) => task.id === 'feature-FOURTEEN-F14');
assert.equal(fourteenFeature.duration, 14);
assert.match(fourteenFeature.bar_text, /Build: 14\/14 SP \| ST: 7\/7 SP/);
assert.equal(fourteenStageTasks.tasks.filter((task) => task.task_kind === 'feature').length, 1);
assert.equal(
  fourteenStageTasks.tasks.some((task) => task.id.startsWith('stage-')),
  false
);

const longStTasks = makeGanttTasks({
  releases: [
    {
      release_id: 'LONG-ST',
      release_name: 'Long ST',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F-LONG',
          feature_name: 'Build 3, ST 5',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          start_date: '2026-11-02',
          finish_date: '2026-11-06',
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-04',
            allocated_sp: 3,
            effort_duration_workdays: 3,
            visual_duration_workdays: 3,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-06',
            allocated_sp: 5,
            effort_duration_workdays: 5,
            visual_duration_workdays: 5,
          },
        },
      ],
    },
  ],
});
const longStGanttTasks = verifyRenderedDates(longStTasks.tasks, {
  'feature-LONG-ST-F-LONG': '2026-11-06',
});
assert.equal(longStGanttTasks.find((task) => task.id === 'feature-LONG-ST-F-LONG').duration, 5);

const fridayTasks = makeGanttTasks({
  releases: [
    {
      release_id: 'FRIDAY',
      release_name: 'Friday end',
      release_type: 'Real',
      start_date: '2026-11-06',
      end_date: '2026-11-06',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F-FRI',
          feature_name: 'Friday task',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          start_date: '2026-11-06',
          finish_date: '2026-11-06',
          build: {
            status: 'scheduled',
            start_date: '2026-11-06',
            end_date: '2026-11-06',
            allocated_sp: 1,
            effort_duration_workdays: 1,
            visual_duration_workdays: 1,
          },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
  ],
});
const fridayGanttTasks = verifyRenderedDates(fridayTasks.tasks, {
  'release-FRIDAY': '2026-11-06',
  'feature-FRIDAY-F-FRI': '2026-11-06',
});
assert.equal(fridayGanttTasks.find((task) => task.id === 'release-FRIDAY').duration, 1);

const fridayMultiDayTasks = makeGanttTasks({
  releases: [
    {
      release_id: 'FRIDAY-MULTI',
      release_name: 'Crosses weekend',
      release_type: 'Real',
      start_date: '2026-11-06',
      end_date: '2026-11-09',
      window_status: 'valid',
      features: [
        {
          feature_id: 'F-CROSS',
          feature_name: 'Two workdays across weekend',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          start_date: '2026-11-06',
          finish_date: '2026-11-09',
          build: {
            status: 'scheduled',
            start_date: '2026-11-06',
            end_date: '2026-11-09',
            allocated_sp: 2,
            effort_duration_workdays: 2,
            visual_duration_workdays: 2,
          },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
  ],
});
const fridayMultiDayGantt = verifyRenderedDates(fridayMultiDayTasks.tasks, {
  'release-FRIDAY-MULTI': '2026-11-09',
  'feature-FRIDAY-MULTI-F-CROSS': '2026-11-09',
});
assert.equal(
  fridayMultiDayGantt.find((task) => task.id === 'feature-FRIDAY-MULTI-F-CROSS').duration,
  2
);

const unscheduledReleases = makeGanttTasks({
  releases: [
    {
      release_id: 'UNSCHEDULED',
      release_name: 'Release 1',
      release_type: 'Real',
      start_date: '2026-11-04',
      end_date: '2026-12-18',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FEATURE1',
          feature_name: 'Feature 1',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          start_date: null,
          finish_date: null,
          reasons: ['release_window_exceeded'],
          build: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 40,
            effort_duration_workdays: 40,
            visual_duration_workdays: 40,
          },
          st: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 30,
            effort_duration_workdays: 30,
            visual_duration_workdays: 40,
          },
        },
      ],
    },
    {
      release_id: 'TBC-UNSCHEDULED',
      release_name: 'TBC 1*',
      release_type: 'TBC',
      start_date: '2026-12-21',
      end_date: '2027-01-08',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FEATURE1',
          feature_name: 'Feature 1',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          start_date: null,
          finish_date: null,
          reasons: ['st_effort_unallocated'],
          build: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 20,
            effort_duration_workdays: 20,
            visual_duration_workdays: 20,
          },
          st: {
            status: 'not_allocated',
            start_date: null,
            end_date: null,
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
          },
        },
      ],
    },
  ],
});
assert.deepEqual(
  unscheduledReleases.tasks.map(({ id }) => id),
  [
    'release-UNSCHEDULED',
    'feature-UNSCHEDULED-FEATURE1',
    'release-TBC-UNSCHEDULED',
    'feature-TBC-UNSCHEDULED-FEATURE1',
  ],
  'fully unscheduled features remain grouped under their release rows'
);
const unscheduledRealFeature = unscheduledReleases.tasks.find(
  (task) => task.id === 'feature-UNSCHEDULED-FEATURE1'
);
const unscheduledTbcFeature = unscheduledReleases.tasks.find(
  (task) => task.id === 'feature-TBC-UNSCHEDULED-FEATURE1'
);
for (const task of [unscheduledRealFeature, unscheduledTbcFeature]) {
  assert.equal(task.unscheduled, true);
  assert.equal(task.status, 'unscheduled');
  assert.equal(Object.hasOwn(task, 'start_date'), false);
  assert.equal(Object.hasOwn(task, 'end_date'), false);
  assert.equal(Object.hasOwn(task, 'duration'), false);
}
assert.equal(unscheduledRealFeature.parent, 'release-UNSCHEDULED');
assert.equal(unscheduledTbcFeature.parent, 'release-TBC-UNSCHEDULED');
assert.equal(
  unscheduledReleases.tasks.some((task) => task.id.startsWith('stage-')),
  false,
  'fully unscheduled features receive no Build or ST bars'
);
assert.equal(unscheduledReleases.tasks[0].duration, 33, 'configured release duration is preserved');
assert.equal(unscheduledReleases.tasks[0].start_date, '2026-11-04');
assert.ok(
  unscheduledReleases.statusRows.some(
    (row) => row.label.includes('Feature 1') && row.status === 'unscheduled'
  )
);
assert.ok(
  unscheduledReleases.statusRows.some(
    (row) => row.label.includes('TBC 1* · Feature 1') && row.status === 'unscheduled'
  ),
  'TBC allocation remains visible in the unscheduled-work list'
);
assert.deepEqual(
  unscheduledReleases.statusRows.find((row) => row.label === 'Release 1 · Feature 1').reasons,
  ['release_window_exceeded']
);
assert.deepEqual(
  unscheduledReleases.statusRows.find((row) => row.label === 'TBC 1* · Feature 1').reasons,
  ['st_effort_unallocated']
);
configureGantt(gantt);
assert.equal(gantt.templates.link_class(hardLink), 'gantt-dependency-hard');
assert.equal(gantt.templates.link_class(normalLink), 'gantt-dependency-normal');
gantt.clearAll();
gantt.parse({
  data: addGanttExclusiveEndDates(view.tasks, gantt),
  links: view.links,
});
assert.deepEqual(
  gantt.getLinks().map(({ source, target, dependency_type }) => ({
    source,
    target,
    dependency_type,
  })),
  [
    {
      source: hardLink.source,
      target: hardLink.target,
      dependency_type: 'Hard',
    },
    {
      source: normalLink.source,
      target: normalLink.target,
      dependency_type: 'Normal',
    },
  ],
  'installed Gantt 9.1.4 accepts and retains links between the feature task IDs'
);
gantt.clearAll();
assert.match(
  gantt.templates.tooltip_text(
    null,
    null,
    view.tasks.find((task) => task.id === 'feature-R1-F1')
  ),
  /Successor dependency: Hard · Unresolved/
);
assert.equal(gantt.config.show_unscheduled, true);
assert.equal(gantt.config.start_on_monday, true);
assert.deepEqual(
  gantt.config.scales.map(({ unit }) => unit),
  ['month', 'week'],
  'the timeline defaults to month and week scales without daily columns'
);
assert.equal(gantt.config.min_column_width, 20);
assert.equal(gantt.config.scales[1].format(new Date('2026-11-02T00:00:00.000Z')), 'W 2');
assert.equal(
  gantt.config.scales[1].css(new Date('2026-11-02T00:00:00.000Z')),
  'gantt-week-scale-cell'
);
assert.deepEqual(
  [
    '2026-10-26',
    '2026-11-02',
    '2026-11-23',
    '2026-11-30',
    '2026-12-07',
    '2026-12-28',
    '2027-01-04',
  ].map((value) => compactWeekLabel(new Date(`${value}T00:00:00.000Z`))),
  ['W 1', 'W 2', 'W 5', 'W 1', 'W 2', 'W 1', 'W 2'],
  'a week crossing into a month is its first intersecting week; numbering restarts by month/year'
);
assert.equal(gantt.templates.task_class(null, null, { task_kind: 'release' }), 'gantt-release-bar');
assert.ok(
  gantt.templates.task_class(null, null, { task_kind: 'feature' }).includes('gantt-feature-task')
);
assert.equal(
  gantt.templates.task_class(null, null, { task_kind: 'feature', status: 'partial' }),
  gantt.templates.task_class(null, null, { task_kind: 'feature', status: 'scheduled' }),
  'timeline completion status is communicated by labels/columns rather than decorative outlines'
);
const ganttStyles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
assert.match(ganttStyles, /gantt-release-bar\s*\{[^}]*height:\s*4px/s);
assert.match(ganttStyles, /gantt-feature-task\s*\{[^}]*background:\s*#3479ad/s);
assert.match(ganttStyles, /gantt-feature-task \.gantt_task_content\s*\{[^}]*color:\s*#fff/s);
assert.match(ganttStyles, /gantt-dependency-hard[\s\S]*--dhx-gantt-link-background:\s*#9b382e/);
assert.match(ganttStyles, /gantt-dependency-normal[\s\S]*border:\s*1px dashed #586b7d/);
assert.match(component, /Normal \(dashed, subtle\)/);
assert.match(
  ganttStyles,
  /\.content\.content-gantt\s*\{[^}]*padding-right:\s*10px;[^}]*padding-left:\s*10px/s
);
const featureStyles = ganttStyles.match(
  /\.gantt-spike-chart \.gantt_task_line\.gantt-feature-task[\s\S]*?\.gantt-spike-chart \.gantt_task_link/
)[0];
assert.doesNotMatch(featureStyles, /dashed|dotted|repeating-linear-gradient/i);
assert.match(featureStyles, /outline:\s*0/);
assert.match(featureStyles, /:focus-visible\s*\{[^}]*background:/s);
assert.match(lifecycle, /gantt\.templates\.tooltip_text/);
assert.match(lifecycle, /gantt\.templates\.task_text/);
assert.match(lifecycle, /grid_elastic_columns\s*=\s*true/);
assert.ok(gantt.config.columns.find((column) => column.name === 'text').min_width >= 300);
assert.match(
  gantt.config.columns.find((column) => column.name === 'text').template({ text: 'Feature label' }),
  /title="Feature label"/
);
assert.equal(
  gantt.config.columns.find((column) => column.name === 'text').label,
  'Release / feature / team'
);
const allocationStatusColumn = gantt.config.columns.find(
  (column) => column.name === 'allocation_status'
);
const timelineStatusColumn = gantt.config.columns.find(
  (column) => column.name === 'timeline_status'
);
assert.equal(
  allocationStatusColumn.template({ task_kind: 'feature', allocation_status: 'Fully Allocated' }),
  'Fully Allocated'
);
assert.equal(
  timelineStatusColumn.template({ task_kind: 'feature', timeline_status: 'unscheduled' }),
  'Unscheduled'
);
assert.equal(
  timelineStatusColumn.template({
    task_kind: 'feature',
    timeline_status: 'complete',
    allocation_status: 'Fully Allocated',
  }),
  'Complete'
);
assert.equal(
  timelineStatusColumn.template({
    task_kind: 'feature',
    timeline_status: 'partial',
    allocation_status: 'Fully Allocated',
  }),
  'Partial',
  'Timeline uses cumulative release progress rather than the overall allocation status'
);
assert.equal(
  timelineStatusColumn.template({
    task_kind: 'feature',
    timeline_status: 'unscheduled',
    allocation_status: 'Fully Allocated',
  }),
  'Unscheduled'
);
assert.equal(
  timelineStatusColumn.template({
    task_kind: 'feature',
    timeline_status: 'unscheduled',
    allocation_status: 'Unallocated',
  }),
  'Unscheduled'
);
assert.equal(
  timelineStatusColumn.template({
    task_kind: 'feature',
    timeline_status: 'unknown',
    allocation_status: 'Fully Allocated',
  }),
  ''
);
assert.equal(timelineStatusColumn.template({ task_kind: 'release', status: 'partial' }), '');
const weeklyScaleStyles = ganttStyles.match(
  /\.gantt_task_scale \.gantt-week-scale-cell\s*\{[^}]*\}/s
)[0];
assert.match(weeklyScaleStyles, /padding-right:\s*2px/);
assert.match(weeklyScaleStyles, /padding-left:\s*2px/);
assert.match(weeklyScaleStyles, /box-sizing:\s*border-box/);
gantt.clearAll();
gantt.parse({
  data: addGanttExclusiveEndDates(unscheduledReleases.tasks, gantt),
  links: [],
});
for (const id of ['feature-UNSCHEDULED-FEATURE1', 'feature-TBC-UNSCHEDULED-FEATURE1']) {
  assert.equal(gantt.isTaskExists(id), true, 'unscheduled features remain Gantt grid tasks');
  assert.equal(gantt.isUnscheduledTask(gantt.getTask(id)), true);
}
assert.equal(
  unscheduledReleases.statusRows.filter((row) => row.label.includes('Feature 1')).length,
  2,
  'one status-list entry remains for each real/TBC allocation'
);

const partialBuild = makeGanttTasks({
  releases: [
    {
      release_id: 'PARTIAL-BUILD',
      release_name: 'Partial Build',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'PB',
          feature_name: 'Build only',
          priority: 1,
          input_order: 1,
          status: 'partial',
          start_date: '2025-01-01',
          finish_date: '2025-01-02',
          reasons: ['st_effort_unallocated'],
          build: {
            status: 'scheduled',
            start_date: '2026-11-03',
            end_date: '2026-11-04',
            allocated_sp: 2,
            effort_duration_workdays: 2,
            visual_duration_workdays: 2,
          },
          st: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
          },
        },
      ],
    },
  ],
});
const partialBuildFeature = partialBuild.tasks.find(
  (task) => task.id === 'feature-PARTIAL-BUILD-PB'
);
assert.equal(partialBuildFeature.start_date, '2026-11-03');
assert.equal(partialBuildFeature.intended_end_date, '2026-11-04');
assert.equal(partialBuildFeature.status, 'partial');
assert.equal(
  partialBuild.tasks.some((task) => task.id.startsWith('stage-')),
  false,
  'Build and ST are represented by one feature row'
);
assert.equal(partialBuildFeature.bar_text.includes('Build: 2 SP'), true);
assert.ok(partialBuild.statusRows.some((row) => row.status === 'partial'));

const partialSt = makeGanttTasks({
  releases: [
    {
      release_id: 'PARTIAL-ST',
      release_name: 'Partial ST',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'PS',
          feature_name: 'ST only',
          priority: 1,
          input_order: 1,
          status: 'partial',
          reasons: ['build_capacity_exhausted'],
          build: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-05',
            end_date: '2026-11-06',
            allocated_sp: 2,
            effort_duration_workdays: 2,
            visual_duration_workdays: 2,
          },
        },
      ],
    },
  ],
});
const partialStRendered = verifyRenderedDates(partialSt.tasks, {
  'release-PARTIAL-ST': '2026-11-20',
  'feature-PARTIAL-ST-PS': '2026-11-06',
});
assert.equal(
  partialSt.tasks.some((task) => task.id.startsWith('stage-')),
  false
);
assert.equal(
  partialSt.tasks.find((task) => task.id === 'feature-PARTIAL-ST-PS').start_date,
  '2026-11-05'
);
assert.equal(
  partialStRendered
    .find((task) => task.id === 'feature-PARTIAL-ST-PS')
    .bar_text.includes('ST: 2 SP'),
  true
);

const multiReleasePartial = makeGanttTasks({
  releases: [
    {
      release_id: 'MR-1',
      release_name: 'Release one',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-12-04',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FM',
          feature_name: 'Multi-release feature',
          team_id: 'GLUE-ID',
          team_name: 'GLUE',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          overall_required_effort_sp: { build: 60, st: 40, total: 100 },
          required_effort_sp: { build: 60, st: 40, total: 100 },
          allocated_effort_sp: { build: 40, st: 30, total: 70 },
          scheduled_effort_sp: { build: 40, st: 30, total: 70 },
          remaining_effort_after_allocation_sp: 0,
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-27',
            allocated_sp: 40,
            scheduled_sp: 40,
            unscheduled_sp: 0,
            effort_duration_workdays: 40,
            visual_duration_workdays: 20,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-27',
            allocated_sp: 30,
            scheduled_sp: 30,
            unscheduled_sp: 0,
            effort_duration_workdays: 30,
            visual_duration_workdays: 20,
          },
        },
      ],
    },
    {
      release_id: 'MR-TBC',
      release_name: 'TBC 1*',
      release_type: 'TBC',
      start_date: '2026-11-23',
      end_date: '2026-12-11',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FM',
          feature_name: 'Multi-release feature',
          team_id: 'GLUE-ID',
          team_name: 'GLUE',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          overall_required_effort_sp: { build: 60, st: 40, total: 100 },
          required_effort_sp: { build: 20, st: 10, total: 30 },
          allocated_effort_sp: { build: 20, st: 10, total: 30 },
          scheduled_effort_sp: { build: 20, st: 10, total: 30 },
          remaining_effort_after_allocation_sp: 0,
          build: {
            status: 'scheduled',
            start_date: '2026-11-23',
            end_date: '2026-12-04',
            allocated_sp: 20,
            scheduled_sp: 20,
            unscheduled_sp: 0,
            effort_duration_workdays: 20,
            visual_duration_workdays: 10,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-23',
            end_date: '2026-12-04',
            allocated_sp: 10,
            scheduled_sp: 10,
            unscheduled_sp: 0,
            effort_duration_workdays: 10,
            visual_duration_workdays: 10,
          },
        },
      ],
    },
  ],
});
const multiReleaseFeatures = multiReleasePartial.tasks.filter((task) => task.feature_id === 'FM');
assert.deepEqual(
  multiReleaseFeatures.map((task) => task.parent),
  ['release-MR-1', 'release-MR-TBC']
);
assert.ok(multiReleaseFeatures.every((task) => task.status === 'scheduled'));
assert.deepEqual(
  multiReleaseFeatures.map((task) => task.allocation_status),
  ['Partially', 'Fully'],
  'allocation status advances cumulatively across releases'
);
assert.deepEqual(
  multiReleaseFeatures.map((task) => task.timeline_status),
  ['partial', 'complete'],
  'release rows show cumulative allocation progress'
);
assert.deepEqual(
  multiReleaseFeatures.map((task) => timelineStatusColumn.template(task)),
  ['Partial', 'Complete']
);
assert.ok(multiReleaseFeatures[0].bar_text.includes('Build: 40/60 SP | ST: 30/40 SP'));
assert.ok(multiReleaseFeatures[1].bar_text.includes('Build: 20/60 SP | ST: 10/40 SP'));
assert.ok(multiReleaseFeatures.every((task) => !task.text.includes('Partial allocation')));
assert.ok(multiReleaseFeatures.every((task) => !task.text.includes('scheduled')));
assert.equal(multiReleaseFeatures[0].allocated_effort_sp.build, 40);
assert.equal(multiReleaseFeatures[1].allocated_effort_sp.build, 20);
assert.equal(multiReleaseFeatures[0].allocated_effort_sp.st, 30);
assert.equal(multiReleaseFeatures[1].allocated_effort_sp.st, 10);
assert.equal(multiReleaseFeatures[0].allocation_status, 'Partially');
assert.equal(multiReleaseFeatures[0].text, 'Multi-release feature (GLUE)');
assert.equal(multiReleaseFeatures[1].text, 'Multi-release feature (GLUE)');
assert.equal(multiReleaseFeatures[0].bar_text, 'Build: 40/60 SP | ST: 30/40 SP');
assert.equal(multiReleaseFeatures[1].bar_text, 'Build: 20/60 SP | ST: 10/40 SP');
assert.ok(multiReleaseFeatures.every((task) => !task.bar_text.includes('FM')));
assert.ok(multiReleaseFeatures.every((task) => !task.bar_text.includes('Multi-release feature')));
const featureTooltip = gantt.templates.tooltip_text(null, null, multiReleaseFeatures[0]);
assert.match(featureTooltip, /Multi-release feature \(GLUE\)/);
assert.match(featureTooltip, /Build: 40\/60 SP \| ST: 30\/40 SP/);
assert.match(featureTooltip, /Cumulative allocation: Partially/);
assert.match(featureTooltip, /Timeline: Partial/);
assert.equal(
  gantt.templates.task_text(null, null, multiReleaseFeatures[0]),
  '',
  'effort is shown in the left grid, not inside the timeline bars'
);
assert.equal(
  gantt.templates.task_text(
    null,
    null,
    view.tasks.find((task) => task.task_kind === 'release')
  ),
  view.tasks.find((task) => task.task_kind === 'release').text,
  'release bar text remains unchanged'
);

const releaseCarryForward = makeGanttTasks({
  releases: [
    {
      release_id: 'CARRY-R1',
      release_name: 'Release 1',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'SAMPLE',
          feature_name: 'Sample feature',
          team_id: 'GLUE',
          priority: 2,
          input_order: 2,
          status: 'unscheduled',
          overall_required_effort_sp: { build: 8, st: 3 },
          allocated_effort_sp: { build: 0, st: 0 },
          build: { status: 'not_allocated', allocated_sp: 0 },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
    {
      release_id: 'CARRY-R2',
      release_name: 'Release 2',
      release_type: 'Real',
      start_date: '2026-11-23',
      end_date: '2026-12-11',
      window_status: 'valid',
      features: [
        {
          feature_id: 'SAMPLE',
          feature_name: 'Sample feature',
          team_id: 'GLUE',
          priority: 2,
          input_order: 2,
          status: 'scheduled',
          overall_required_effort_sp: { build: 8, st: 3 },
          allocated_effort_sp: { build: 8, st: 3 },
          build: {
            status: 'scheduled',
            allocated_sp: 8,
            start_date: '2026-11-23',
            end_date: '2026-12-02',
          },
          st: {
            status: 'scheduled',
            allocated_sp: 3,
            start_date: '2026-11-23',
            end_date: '2026-12-02',
          },
        },
      ],
    },
  ],
});
const sampleCarryRows = releaseCarryForward.tasks.filter((task) => task.feature_id === 'SAMPLE');
assert.deepEqual(
  sampleCarryRows.map((task) => task.allocation_status),
  ['Unallocated', 'Fully'],
  'a feature with no Release 1 allocation reaches Fully only after its Release 2 allocation'
);
assert.equal(sampleCarryRows[0].timeline_status, 'unscheduled');
assert.equal(sampleCarryRows[1].timeline_status, 'complete');

const aggregateWarningView = makeGanttTasks({
  releases: [
    {
      release_id: 'AGG-R1',
      release_name: 'Release 1',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'AGG-F1',
          feature_name: 'Feature 1',
          team_id: 'GLUE-ID',
          team_name: 'GLUE',
          priority: 1,
          input_order: 1,
          status: 'partial',
          overall_required_effort_sp: { build: 60, st: 40 },
          allocated_effort_sp: { build: 40, st: 30 },
          build: { allocated_sp: 40 },
          st: { allocated_sp: 30 },
        },
      ],
    },
    {
      release_id: 'AGG-TBC',
      release_name: 'TBC 1*',
      release_type: 'TBC',
      start_date: '2026-11-23',
      end_date: '2026-12-11',
      window_status: 'valid',
      features: [
        {
          feature_id: 'AGG-F1',
          feature_name: 'Feature 1',
          team_id: 'GLUE-ID',
          team_name: 'GLUE',
          priority: 1,
          input_order: 1,
          status: 'partial',
          overall_required_effort_sp: { build: 60, st: 40 },
          allocated_effort_sp: { build: 20, st: 10 },
          build: {
            status: 'partial',
            start_date: '2026-11-23',
            end_date: '2026-11-24',
            allocated_sp: 20,
          },
          st: { allocated_sp: 10 },
        },
      ],
    },
  ],
});
assert.equal(aggregateWarningView.statusRows.length, 2);
assert.ok(aggregateWarningView.statusRows.every((row) => row.label.includes('Feature 1 (GLUE)')));
const fullyAllocatedTbcFeature = aggregateWarningView.tasks.find(
  (task) => task.feature_id === 'AGG-F1' && task.release_type === 'TBC'
);
assert.equal(fullyAllocatedTbcFeature.status, 'partial');
assert.equal(fullyAllocatedTbcFeature.allocation_status, 'Fully');
assert.equal(fullyAllocatedTbcFeature.timeline_status, 'complete');
assert.equal(timelineStatusColumn.template(fullyAllocatedTbcFeature), 'Complete');
assert.ok(
  aggregateWarningView.statusRows.every((row) =>
    row.effortSummary.includes(
      'Fully overall · Build: 60/60 SP allocated; 0 SP unallocated · ST: 40/40 SP allocated; 0 SP unallocated'
    )
  )
);

const capacityPartialFeature = makeGanttTasks({
  releases: [
    {
      release_id: 'PARTIAL-WINDOW',
      release_name: 'Release with additional allocated work',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-03',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FW',
          feature_name: 'Capacity-limited feature',
          priority: 1,
          input_order: 1,
          status: 'partial',
          reasons: ['build_capacity_exhausted'],
          overall_required_effort_sp: { build: 8, st: 0, total: 8 },
          required_effort_sp: { build: 8, st: 0, total: 8 },
          allocated_effort_sp: { build: 4, st: 0, total: 4 },
          scheduled_effort_sp: { build: 2, st: 0, total: 2 },
          unscheduled_effort_sp: { build: 2, st: 0, total: 2 },
          remaining_effort_after_allocation_sp: 4,
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-05',
            allocated_sp: 4,
            scheduled_sp: 4,
            unscheduled_sp: 0,
            required_sp: 8,
            remaining_effort_after_allocation_sp: 4,
            effort_duration_workdays: 4,
            visual_duration_workdays: 4,
          },
          st: { status: 'not_allocated', allocated_sp: 0, scheduled_sp: 0, required_sp: 0 },
        },
      ],
    },
  ],
});
const capacityPartialRow = capacityPartialFeature.tasks.find(
  (task) => task.id === 'feature-PARTIAL-WINDOW-FW'
);
assert.equal(capacityPartialRow.status, 'partial');
assert.equal(capacityPartialRow.duration, 4);
assert.equal(capacityPartialRow.intended_end_date, '2026-11-05');
assert.ok(capacityPartialRow.bar_text.includes('Build: 4/8 SP'));
assert.equal(capacityPartialRow.text.includes('scheduled'), false);
assert.equal(
  capacityPartialFeature.tasks.some((task) => task.id.startsWith('stage-')),
  false
);
assert.deepEqual(capacityPartialFeature.statusRows[0].reasons, ['build_capacity_exhausted']);
assert.ok(capacityPartialFeature.statusRows[0].effortSummary.includes('4/8 SP allocated'));

const allocatedBeyondReleaseEnd = makeGanttTasks({
  releases: [
    {
      release_id: 'CAPACITY-R2',
      release_name: 'Release 2',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-03',
      window_status: 'valid',
      features: [
        {
          feature_id: 'PARALLEL-F',
          feature_name: 'Parallel feature',
          priority: 2,
          input_order: 2,
          status: 'scheduled',
          overall_required_effort_sp: { build: 4, st: 0 },
          allocated_effort_sp: { build: 4, st: 0 },
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-05',
            allocated_sp: 4,
            scheduled_sp: 4,
            unscheduled_sp: 0,
          },
          st: { status: 'not_allocated', allocated_sp: 0, scheduled_sp: 0 },
        },
      ],
    },
  ],
});
const parallelFeatureRow = allocatedBeyondReleaseEnd.tasks.find(
  (task) => task.feature_id === 'PARALLEL-F'
);
assert.equal(parallelFeatureRow.intended_end_date, '2026-11-05');
assert.equal(parallelFeatureRow.timeline_status, 'complete');

const allocationOnlyView = makeGanttTasks({
  releases: [
    {
      release_id: 'ALLOC-1',
      release_name: 'Release 1',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-03',
      window_status: 'valid',
      features: [
        {
          feature_id: 'ALLOC-F',
          feature_name: 'Allocation only',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          overall_required_effort_sp: { build: 60, st: 40, total: 100 },
          allocated_effort_sp: { build: 60, st: 0, total: 60 },
          build: { status: 'unscheduled', allocated_sp: 60 },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
    {
      release_id: 'ALLOC-TBC',
      release_name: 'TBC Release 1',
      release_type: 'TBC',
      start_date: '2026-11-04',
      end_date: '2026-11-05',
      window_status: 'valid',
      features: [
        {
          feature_id: 'ALLOC-F',
          feature_name: 'Allocation only',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          overall_required_effort_sp: { build: 60, st: 40, total: 100 },
          allocated_effort_sp: { build: 0, st: 20, total: 20 },
          build: { status: 'not_allocated', allocated_sp: 0 },
          st: { status: 'unscheduled', allocated_sp: 20 },
        },
      ],
    },
  ],
});
const allocationOnlyRows = allocationOnlyView.tasks.filter((task) => task.feature_id === 'ALLOC-F');
assert.ok(allocationOnlyRows.every((task) => task.allocation_status === 'Partially'));
assert.ok(allocationOnlyRows.every((task) => task.status === 'unscheduled'));
assert.deepEqual(
  allocationOnlyRows.map((task) => timelineStatusColumn.template(task)),
  ['Unscheduled', 'Unscheduled'],
  'rows without scheduled stage dates remain Unscheduled even when effort is partially allocated'
);
assert.equal(Object.hasOwn(allocationOnlyRows[0], 'start_date'), false);
assert.ok(allocationOnlyRows[0].bar_text.includes('Build: 60/60 SP | ST: 0/40 SP'));
assert.ok(allocationOnlyRows[1].bar_text.includes('Build: 0/60 SP | ST: 20/40 SP'));

const fullyAllocatedWithoutDates = makeGanttTasks({
  releases: [
    {
      release_id: 'NO-DATES',
      release_name: 'Release without scheduled stages',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-03',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FULL-NODATE',
          feature_name: 'Fully allocated',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          overall_required_effort_sp: { build: 60, st: 40, total: 100 },
          allocated_effort_sp: { build: 60, st: 40, total: 100 },
          build: { status: 'unscheduled', allocated_sp: 60 },
          st: { status: 'unscheduled', allocated_sp: 40 },
        },
      ],
    },
  ],
});
const noDateAllocationRow = fullyAllocatedWithoutDates.tasks.find(
  (task) => task.id === 'feature-NO-DATES-FULL-NODATE'
);
assert.equal(noDateAllocationRow.allocation_status, 'Fully');
assert.equal(noDateAllocationRow.status, 'unscheduled');
assert.equal(noDateAllocationRow.timeline_status, 'unscheduled');
assert.equal(timelineStatusColumn.template(noDateAllocationRow), 'Unscheduled');
assert.equal(Object.hasOwn(noDateAllocationRow, 'start_date'), false);

const zeroEffortView = makeGanttTasks({
  releases: [
    {
      release_id: 'ZERO-EFFORT',
      release_name: 'Zero effort',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-03',
      window_status: 'valid',
      features: [
        {
          feature_id: 'ZERO',
          feature_name: 'Zero requirements',
          priority: 1,
          input_order: 1,
          status: 'no_allocated_work',
          overall_required_effort_sp: { build: 0, st: 0, total: 0 },
          allocated_effort_sp: { build: 0, st: 0, total: 0 },
          build: { status: 'not_allocated', allocated_sp: 0 },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
  ],
});
assert.equal(zeroEffortView.tasks[1].allocation_status, 'Fully');

const unallocatedView = makeGanttTasks({
  releases: [
    {
      release_id: 'UNALLOCATED',
      release_name: 'Unallocated',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-03',
      window_status: 'valid',
      features: [
        {
          feature_id: 'NONE',
          feature_name: 'No effort allocated',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          overall_required_effort_sp: { build: 40, st: 0, total: 40 },
          allocated_effort_sp: { build: 0, st: 0, total: 0 },
          build: { status: 'not_allocated', allocated_sp: 0 },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
  ],
});
assert.equal(unallocatedView.tasks[1].allocation_status, 'Unallocated');

const scheduledTbc = makeGanttTasks({
  releases: [
    {
      release_id: 'TBC-PARTIAL',
      release_name: 'TBC 2*',
      release_type: 'TBC',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'TBC-FEATURE',
          feature_name: 'Overflow remaining work',
          priority: 1,
          input_order: 1,
          status: 'partial',
          reasons: ['st_effort_unallocated'],
          build: {
            status: 'scheduled',
            start_date: '2026-11-02',
            end_date: '2026-11-05',
            allocated_sp: 4,
            effort_duration_workdays: 4,
            visual_duration_workdays: 4,
          },
          st: {
            status: 'unscheduled',
            start_date: null,
            end_date: null,
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
          },
        },
      ],
    },
  ],
});
assert.equal(
  scheduledTbc.tasks.find((task) => task.id === 'release-TBC-PARTIAL').release_type,
  'TBC'
);
assert.equal(
  scheduledTbc.tasks.some((task) => task.id.startsWith('stage-')),
  false
);
assert.ok(
  scheduledTbc.tasks
    .find((task) => task.id === 'feature-TBC-PARTIAL-TBC-FEATURE')
    .bar_text.includes('Build: 4 SP')
);

const invalidStageDates = makeGanttTasks({
  releases: [
    {
      release_id: 'INVALID-STAGE',
      release_name: 'Invalid stage dates',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'ID',
          feature_name: 'Invalid dates',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          reasons: ['release_window_exceeded'],
          build: {
            status: 'scheduled',
            start_date: '2026-02-30',
            end_date: '2026-03-02',
            allocated_sp: 2,
            effort_duration_workdays: 2,
            visual_duration_workdays: 2,
          },
          st: {
            status: 'scheduled',
            start_date: '2026-11-06',
            end_date: '2026-11-06',
            allocated_sp: 0,
            effort_duration_workdays: 0,
            visual_duration_workdays: 0,
          },
        },
      ],
    },
  ],
});
assert.equal(
  invalidStageDates.tasks.some((task) => task.id === 'feature-INVALID-STAGE-ID'),
  true
);
const invalidFeature = invalidStageDates.tasks.find(
  (task) => task.id === 'feature-INVALID-STAGE-ID'
);
assert.equal(invalidFeature.unscheduled, true);
assert.equal(Object.hasOwn(invalidFeature, 'start_date'), false);
assert.equal(Object.hasOwn(invalidFeature, 'duration'), false);
assert.equal(
  invalidStageDates.tasks.some((task) => task.id.startsWith('stage-')),
  false
);
assert.equal(invalidStageDates.statusRows[0].status, 'unscheduled');

const safeText = makeGanttTasks({
  releases: [
    {
      release_id: 'RX',
      release_name: '<script>alert(1)</script>',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-13',
      window_status: 'valid',
      features: [
        {
          feature_id: 'FX',
          feature_name: '<img src=x>',
          priority: 1,
          input_order: 1,
          status: 'scheduled',
          reasons: [],
          build: {
            status: 'scheduled',
            start_date: '2026-11-03',
            end_date: '2026-11-03',
            allocated_sp: 1,
            effort_duration_workdays: 1,
            visual_duration_workdays: 1,
          },
          st: { status: 'not_allocated' },
        },
      ],
    },
  ],
});
assert.equal(safeText.tasks[0].text, '&lt;script&gt;alert(1)&lt;/script&gt;');
assert.equal(safeText.tasks[1].text, '&lt;img src=x&gt;');
assert.equal(safeText.tasks[1].bar_text, 'Build: 1 SP / requirement unavailable | ST: —');

const empty = makeGanttTasks({ releases: [] });
assert.deepEqual(empty, { tasks: [], statusRows: [], links: [], linkDiagnostics: [] });
await assert.rejects(
  () =>
    loadComputedGanttSchedule(async () => {
      throw new Error('Planning API unavailable');
    }),
  /Planning API unavailable/
);
await assert.rejects(
  () =>
    loadComputedGanttSchedule(async (path) =>
      path.endsWith('/compute')
        ? { data: plan, workbookVersion: 42 }
        : { data: featureSchedule, workbookVersion: 43 }
    ),
  (error) => error.status === 409
);

process.stdout.write('Gantt plan view verification passed.\n');
