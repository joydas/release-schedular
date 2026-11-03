import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as ganttModule from 'dhtmlx-gantt';
import { configureGantt, mountGanttChart, updateGanttTasks } from '../src/ganttLifecycle.js';
import { makeGanttTasks } from '../src/ganttPlanView.js';

const component = await readFile(new URL('../src/GanttSchedulePage.jsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const boundary = await readFile(new URL('../src/GanttErrorBoundary.jsx', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../src/ganttLifecycle.js', import.meta.url), 'utf8');

assert.equal(typeof ganttModule.gantt.init, 'function');
assert.equal(typeof ganttModule.gantt.clearAll, 'function');
assert.equal(typeof ganttModule.gantt.destructor, 'function');
assert.equal(ganttModule.Gantt, undefined, 'GPL 9.1.4 should not expose the PRO instance factory');
assert.match(String(ganttModule.gantt.destructor), /\$destroyed\s*=\s*!0/);
assert.doesNotMatch(lifecycle, /\.destructor\s*\(/, 'cleanup must not destroy the GPL singleton');
assert.match(component, /const unmountGantt = mountGanttChart\(gantt, containerRef\.current\)/);
assert.match(component, /unmountGantt\(\)/);
assert.match(component, /updateGanttTasks\(gantt, tasks, links, addGanttExclusiveEndDates\)/);
assert.match(
  app,
  /<GanttErrorBoundary>[\s\S]*<GanttSchedulePage\s*\/>[\s\S]*<\/GanttErrorBoundary>/
);
assert.match(boundary, /Gantt could not be displayed/);
assert.match(boundary, /Retry Gantt/);

const calls = [];
let currentData = [];
let currentLinks = [];
const fakeGantt = {
  config: {},
  templates: {},
  init(container) {
    calls.push(['init', container]);
  },
  setWorkTime(setting) {
    calls.push(['setWorkTime', setting.day]);
  },
  clearAll() {
    currentData = [];
    currentLinks = [];
    calls.push(['clearAll']);
  },
  parse(payload) {
    currentData = payload.data;
    currentLinks = payload.links;
    calls.push(['parse', payload.data.map(({ id }) => id)]);
  },
};
const passExclusiveDates = (tasks) => tasks.map((task) => ({ ...task }));
const unscheduledTimeline = makeGanttTasks({
  releases: [
    {
      release_id: 'LIFECYCLE',
      release_name: 'Lifecycle release',
      release_type: 'Real',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
      window_status: 'valid',
      features: [
        {
          feature_id: 'NO-BAR',
          feature_name: 'Unscheduled feature',
          priority: 1,
          input_order: 1,
          status: 'unscheduled',
          reasons: ['release_window_exceeded'],
          build: { status: 'unscheduled', allocated_sp: 2 },
          st: { status: 'not_allocated', allocated_sp: 0 },
        },
      ],
    },
  ],
});
assert.deepEqual(
  unscheduledTimeline.tasks.map(({ id }) => id),
  ['release-LIFECYCLE', 'feature-LIFECYCLE-NO-BAR']
);
const noBarFeature = unscheduledTimeline.tasks[1];
assert.equal(noBarFeature.unscheduled, true);
assert.equal(Object.hasOwn(noBarFeature, 'start_date'), false);
assert.equal(Object.hasOwn(noBarFeature, 'duration'), false);

configureGantt(fakeGantt);
const firstCleanup = mountGanttChart(fakeGantt, 'first-container');
updateGanttTasks(
  fakeGantt,
  unscheduledTimeline.tasks,
  unscheduledTimeline.links,
  passExclusiveDates
);
assert.deepEqual(
  currentData.map(({ id }) => id),
  ['release-LIFECYCLE', 'feature-LIFECYCLE-NO-BAR']
);
assert.deepEqual(currentLinks, []);
firstCleanup();
assert.deepEqual(currentData, [], 'unmount cleanup should clear stale task data');

configureGantt(fakeGantt);
const secondCleanup = mountGanttChart(fakeGantt, 'second-container');
updateGanttTasks(
  fakeGantt,
  unscheduledTimeline.tasks,
  unscheduledTimeline.links,
  passExclusiveDates
);
assert.deepEqual(
  currentData.map(({ id }) => id),
  ['release-LIFECYCLE', 'feature-LIFECYCLE-NO-BAR']
);
assert.deepEqual(currentLinks, []);
secondCleanup();

assert.equal(calls.filter(([name]) => name === 'init').length, 2);
assert.equal(calls.filter(([name]) => name === 'clearAll').length, 4);
assert.equal(calls.filter(([name]) => name === 'parse').length, 2);
assert.deepEqual(
  calls.filter(([name]) => name === 'init').map(([, container]) => container),
  ['first-container', 'second-container']
);

console.log(
  'Gantt lifecycle checks passed: repeated setup/cleanup, task clearing, singleton reuse, and route error boundary.'
);
