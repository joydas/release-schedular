import { formatDate } from './dateUtils.js';

let tooltipPluginEnabled = false;

export function compactWeekLabel(date) {
  const day = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(day.getTime())) return '';
  const weekStart = new Date(day);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const labelMonth =
    weekStart.getMonth() !== weekEnd.getMonth() || weekStart.getFullYear() !== weekEnd.getFullYear()
      ? weekEnd
      : weekStart;
  const firstOfMonth = new Date(labelMonth.getFullYear(), labelMonth.getMonth(), 1);
  const firstWeekStart = new Date(firstOfMonth);
  firstWeekStart.setDate(firstWeekStart.getDate() - ((firstWeekStart.getDay() + 6) % 7));
  const weekNumber = Math.floor((weekStart - firstWeekStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `W ${weekNumber}`;
}

function timelineStatusLabel(task) {
  if (task.task_kind !== 'feature') return '';
  if (task.timeline_status === 'complete') return 'Complete';
  if (task.timeline_status === 'partial') return 'Partial';
  if (task.timeline_status === 'unscheduled') return 'Unscheduled';
  return '';
}

function teamNameLabel(task) {
  if (task.task_kind !== 'feature' || !task.team_name) return '';
  return String(task.team_name)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function featureGridText(task) {
  if (task.task_kind !== 'feature') return `<span title="${task.text}">${task.text}</span>`;
  const amount = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  };
  const activityRatio = (activity) => {
    const allocated = task.allocated_effort_sp?.[activity] ?? task[activity]?.allocated_sp;
    const required = task.overall_required_effort_sp?.[activity];
    return `${amount(allocated)}/${amount(required)} SP`;
  };
  return `<span class="gantt-feature-grid-text"><span class="gantt-feature-grid-name" title="${task.text}">${task.text}</span><span class="gantt-feature-grid-effort">Build: ${activityRatio('build')} · ST: ${activityRatio('st')}</span></span>`;
}

export function configureGantt(gantt) {
  gantt.config.date_format = '%Y-%m-%d';
  gantt.config.readonly = true;
  gantt.config.drag_move = false;
  gantt.config.drag_resize = false;
  gantt.config.drag_progress = false;
  gantt.config.drag_links = false;
  gantt.config.dblclick_create = false;
  gantt.config.details_on_dblclick = false;
  gantt.config.show_links = true;
  // In dhtmlxGantt 9.1.4, true keeps unscheduled tasks as empty grid rows;
  // false allows them into the timeline and can draw their runtime defaults.
  gantt.config.show_unscheduled = true;
  gantt.config.work_time = true;
  gantt.config.start_on_monday = true;
  gantt.config.min_column_width = 30;
  gantt.config.grid_elastic_columns = true;
  gantt.config.scales = [
    { unit: 'month', step: 1, format: '%F %Y' },
    {
      unit: 'week',
      step: 1,
      format: compactWeekLabel,
      css: () => 'gantt-week-scale-cell',
    },
  ];
  gantt.config.columns = [
    {
      name: 'text',
      label: 'Release / Feature',
      tree: true,
      width: '380',
      min_width: 340,
      template: featureGridText,
    },
    {
      name: 'team_name',
      label: 'Team',
      align: 'left',
      width: 70,
      min_width: 65,
      template: teamNameLabel,
    },
    // {
    //   name: 'start_date',
    //   label: 'Start',
    //   align: 'center',
    //   width: 100,
    //   min_width: 90,
    //   template: (task) => formatDate(task.start_date),
    // },
    {
      name: 'duration',
      label: 'Workdays',
      align: 'center',
      width: 65,
      min_width: 60,
      template: (task) =>
        task.task_kind === 'feature' && task.timeline_status === 'unscheduled' ? '' : task.duration,
    },
    {
      name: 'allocation_status',
      label: 'Allocation',
      align: 'center',
      width: 80,
      min_width: 75,
      template: (task) =>
        task.task_kind === 'feature' ? task.allocation_status || 'Allocation unavailable' : '',
    },
    {
      name: 'timeline_status',
      label: 'Timeline',
      align: 'center',
      width: 85,
      min_width: 80,
      template: timelineStatusLabel,
    },
  ];
  gantt.templates.task_class = (_start, _end, task) =>
    [
      task.task_kind === 'release' ? 'gantt-release-bar' : '',
      task.task_kind === 'release' && task.release_type === 'TBC' ? 'gantt-tbc-task' : '',
      task.task_kind === 'feature' ? 'gantt-feature-task' : '',
    ]
      .filter(Boolean)
      .join(' ');
  gantt.templates.task_text = (_start, _end, task) =>
    task.task_kind === 'feature' ? '' : task.text;
  gantt.templates.link_class = (link) =>
    link.dependency_type === 'Hard' ? 'gantt-dependency-hard' : 'gantt-dependency-normal';
  if (
    !tooltipPluginEnabled &&
    typeof document !== 'undefined' &&
    typeof gantt.plugins === 'function'
  ) {
    gantt.plugins({ tooltip: true });
    tooltipPluginEnabled = true;
  }
  gantt.templates.tooltip_text = (_start, _end, task) => {
    if (task.task_kind !== 'feature') return task.text;
    const timeline = timelineStatusLabel(task);
    const dependencyLines = (task.dependency_details || []).map(
      (dependency) =>
        `${dependency.direction === 'predecessor' ? 'Predecessor' : 'Successor'} dependency: ${dependency.dependency_type} · ${dependency.dependency_status}`
    );
    return `${task.text}<br/>${task.bar_text}<br/>Allocation: ${task.allocation_status}<br/>Timeline: ${timeline}${dependencyLines.length ? `<br/>${dependencyLines.join('<br/>')}` : ''}`;
  };
}

export function mountGanttChart(gantt, container) {
  gantt.init(container);
  gantt.setWorkTime({ day: 0, hours: false });
  gantt.setWorkTime({ day: 6, hours: false });

  // GPL Gantt 9.x exposes one page-lifetime singleton. Its destructor removes
  // internal stores permanently, so cleanup only clears chart data. A later
  // init() safely reuses the singleton and replaces its previous container.
  return () => gantt.clearAll();
}

export function updateGanttTasks(gantt, tasks, links, addExclusiveEndDates) {
  gantt.clearAll();
  gantt.parse({
    data: addExclusiveEndDates(tasks, gantt),
    links: links.map((link) => ({ ...link, readonly: true, editable: false })),
  });
}
