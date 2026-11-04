'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const { WorkbookService } = require('../src/services/WorkbookService');
const { computePlan } = require('../src/planning/computePlan');

async function withTempDirectory(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-scheduler-plan-api-'));
  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function loadApp(workbookPath) {
  process.env.WORKBOOK_PATH = workbookPath;
  delete require.cache[require.resolve('../src/index.js')];
  const app = require('../src/index.js');
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

async function requestJson(baseUrl, route, { method = 'GET', body } = {}) {
  const hasBody = body !== undefined;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function requestBuffer(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
}

async function mutate(service, method, record) {
  const expectedVersion = await service.getWorkbookVersion();
  return service[method](record, { expectedVersion });
}

function makeFeature(featureId, priority, inputOrder, overrides = {}) {
  return {
    feature_id: featureId,
    release_id: '',
    feature_name: featureId,
    priority,
    input_order: inputOrder,
    team_id: 'T-1',
    status: 'Planned',
    build_estimate_current: 3,
    build_original_estimate: 3,
    build_actual_spent: 0,
    st_estimate_current: 0,
    st_original_estimate: 0,
    st_actual_spent: 0,
    ...overrides,
  };
}

async function seedWorkbook(
  workbookPath,
  {
    features = [makeFeature('F-1', 1, 1)],
    dependencies = [],
    teams = [{ team_id: 'T-1', team_name: 'Team 1', status: 'Active' }],
  } = {}
) {
  const service = await WorkbookService.create({ workbookPath });
  for (const team of teams) await mutate(service, 'upsertTeam', team);
  await mutate(service, 'upsertRelease', {
    release_id: 'R-1',
    release_name: 'Release 1',
    status: 'Planned',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    end_date: new Date('2026-01-06T00:00:00.000Z'),
    target_date: null,
    priority_order: 1,
  });
  for (const feature of features) await mutate(service, 'upsertFeature', feature);
  for (const dependency of dependencies) await mutate(service, 'upsertDependency', dependency);
  await mutate(service, 'upsertUserStory', {
    story_id: 'S-1',
    feature_id: features[0].feature_id,
    story_name: 'Story 1',
    input_order: 1,
    status: 'Planned',
    build_estimate_current: 1,
    build_original_estimate: 1,
    build_actual_spent: 0,
    st_estimate_current: 0,
    st_original_estimate: 0,
    st_actual_spent: 0,
  });
  await mutate(service, 'upsertTeamReleaseCapacity', {
    team_id: 'T-1',
    release_id: 'R-1',
    build_capacity: 1,
    st_capacity: 0,
    capacity_source: 'Manual',
  });
  return service;
}

async function verifyCrossTeamPriorityValidation(tempRoot) {
  const workbookPath = path.join(tempRoot, 'cross-team-priority.xlsx');
  const dependency = {
    dependency_id: 'D-CROSS-TEAM',
    predecessor_feature_id: 'PRED',
    dependent_feature_id: 'DEP',
    dependency_type: 'Normal',
    dependency_status: 'Unresolved',
    affected_activity: null,
    blocking_pct: null,
  };
  const service = await seedWorkbook(workbookPath, {
    teams: [
      { team_id: 'T-1', team_name: 'Team 1', status: 'Active' },
      { team_id: 'T-2', team_name: 'Team 2', status: 'Active' },
    ],
    features: [
      makeFeature('PRED', 1, 2, { team_id: 'T-1' }),
      makeFeature('DEP', 1, 1, { team_id: 'T-2' }),
    ],
    dependencies: [dependency],
  });
  const app = await loadApp(workbookPath);
  try {
    const versionBefore = await service.getWorkbookVersion();
    const hashBefore = await workbookHash(workbookPath);
    const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.data.feature_order, ['PRED', 'DEP']);
    assert.deepEqual(response.json.data.dependency_graph.edges, [
      {
        dependency_id: 'D-CROSS-TEAM',
        predecessor_feature_id: 'PRED',
        dependent_feature_id: 'DEP',
        dependency_type: 'Normal',
        dependency_status: 'Unresolved',
      },
    ]);
    assert.equal(response.json.workbookVersion, versionBefore);
    assert.equal(await workbookHash(workbookPath), hashBefore);
  } finally {
    await app.close();
  }
}

function planningState(service) {
  return {
    teams: service.listTeams(),
    releases: service.listReleases(),
    features: service.listFeatures(),
    stories: service.listUserStories(),
    dependencies: service.listDependencies(),
    capacities: service.listTeamReleaseCapacity(),
    config: service.buildConfigMap(),
  };
}

async function workbookHash(workbookPath) {
  const bytes = await fs.readFile(workbookPath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function corruptWorkbook(workbookPath, sheetName, rowNumber, columnNumber, value) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  workbook.getWorksheet(sheetName).getCell(rowNumber, columnNumber).value = value;
  await workbook.xlsx.writeFile(workbookPath);
}

async function appendCorruptRow(workbookPath, sheetName, values) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  workbook.getWorksheet(sheetName).addRow(values);
  await workbook.xlsx.writeFile(workbookPath);
}

async function verifySuccessfulReadOnlyPlan(tempRoot) {
  const workbookPath = path.join(tempRoot, 'success.xlsx');
  const service = await seedWorkbook(workbookPath);
  const versionBefore = await service.getWorkbookVersion();
  const expectedPlan = JSON.parse(JSON.stringify(computePlan(planningState(service))));
  const hashBefore = await workbookHash(workbookPath);
  const app = await loadApp(workbookPath);
  try {
    const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.workbookVersion, versionBefore);
    assert.deepEqual(response.json.data, expectedPlan);
    assert.equal(response.json.data.tbc_generation.releases.length, 2);
    assert.ok(
      response.json.data.schedule[0].allocations.some((item) => item.release_type === 'TBC')
    );
    const scheduled = await requestJson(app.baseUrl, '/api/plan/schedule', {
      method: 'POST',
      body: { plan: response.json.data, expectedVersion: response.json.workbookVersion },
    });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.json.workbookVersion, versionBefore);
    assert.equal(scheduled.json.data.story_points_per_workday, 1);
    assert.deepEqual(
      scheduled.json.data.releases.map((item) => item.release_type),
      ['Real', 'TBC', 'TBC']
    );
    assert.equal(scheduled.json.data.releases[0].features[0].build.allocated_sp, 1);
    assert.equal(scheduled.json.data.releases[0].features[0].build.start_date, '2026-01-01');
    assert.equal(scheduled.json.data.releases[0].features[0].build.status, 'scheduled');
    const exported = await requestBuffer(app.baseUrl, '/api/plan/export', {
      rows: [{ feature_id: 'F-1', feature_name: 'Feature one', team: 'Team 1', build_allocation: '1/3 SP', st_allocation: '0/0 SP', work_days: 1, allocation: 'Partially Allocated', timeline: 'Partial' }],
      gantt: {
        releases: [{ id: 'release-R-1', name: 'Release 1' }, { id: 'release-R-2', name: 'Release 2' }],
        rows: [{ feature_id: 'F-1', feature_name: 'Feature one', team: 'Team 1', cells: {
          'release-R-1': { value: 'Build: 1 SP · ST: 0 SP', status: 'partial' },
          'release-R-2': { value: 'Build: 2 SP · ST: 1 SP', status: 'complete' },
        } }],
      },
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /spreadsheetml\.sheet/);
    const exportBook = new ExcelJS.Workbook();
    await exportBook.xlsx.load(exported.buffer);
    assert.equal(exportBook.worksheets.length, 1, 'Schedule and Gantt must be combined on one sheet');
    const combinedSheet = exportBook.getWorksheet('Schedule and Gantt');
    assert.equal(combinedSheet.getRow(2).getCell(1).value, 'Feature ID');
    assert.equal(combinedSheet.getRow(2).getCell(8).value, 'Timeline');
    assert.equal(combinedSheet.getRow(3).getCell(1).value, 'F-1');
    assert.equal(combinedSheet.getRow(1).getCell(1).value, 'Schedule summary');
    assert.equal(combinedSheet.getRow(1).getCell(9).value, 'Gantt allocation by release · green = complete; yellow = partial');
    assert.equal(combinedSheet.getRow(2).getCell(9).value, 'Release 1');
    assert.equal(combinedSheet.getRow(2).getCell(10).value, 'Release 2');
    assert.equal(combinedSheet.getRow(3).getCell(9).value, 'Build: 1 SP · ST: 0 SP');
    assert.equal(combinedSheet.getRow(3).getCell(9).fill.fgColor.argb, 'FFFFEB9C');
    assert.equal(combinedSheet.getRow(3).getCell(10).fill.fgColor.argb, 'FFC6EFCE');
    assert.equal(await workbookHash(workbookPath), hashBefore, 'Excel export must not modify workbook data');
    const invalidExport = await requestJson(app.baseUrl, '/api/plan/export', { method: 'POST', body: { rows: [{ unknown: 'column' }], gantt: { releases: [], rows: [] } } });
    assert.equal(invalidExport.status, 400);
    assert.equal(invalidExport.json.code, 'INVALID_EXPORT_ROWS');
    const staleSchedule = await requestJson(app.baseUrl, '/api/plan/schedule', {
      method: 'POST',
      body: { plan: response.json.data, expectedVersion: versionBefore + 1 },
    });
    assert.equal(staleSchedule.status, 409);
    assert.equal(staleSchedule.json.code, 'WORKBOOK_CONFLICT');
    const changedPlan = structuredClone(response.json.data);
    changedPlan.schedule[0].allocations[0].build.allocated_effort += 1;
    const mismatchedSchedule = await requestJson(app.baseUrl, '/api/plan/schedule', {
      method: 'POST',
      body: { plan: changedPlan, expectedVersion: response.json.workbookVersion },
    });
    assert.equal(mismatchedSchedule.status, 409);
    assert.equal(mismatchedSchedule.json.code, 'PLAN_SNAPSHOT_MISMATCH');
    assert.equal(await workbookHash(workbookPath), hashBefore);
    const after = await WorkbookService.create({ workbookPath });
    assert.equal(await after.getWorkbookVersion(), versionBefore);
    assert.deepEqual(
      after.listReleases().map((item) => item.release_id),
      ['R-1']
    );
    assert.deepEqual(after.listScenarios(), []);
    assert.equal(after.listFeatures()[0].build_actual_spent, 0);

    const invalidBody = await requestJson(app.baseUrl, '/api/plan/compute', {
      method: 'POST',
      body: { state: planningState(service) },
    });
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.json.code, 'INVALID_REQUEST');
    assert.equal(typeof invalidBody.json.error, 'string');
  } finally {
    await app.close();
  }
}

async function verifyScenarioReadOnlyCalculation(tempRoot) {
  const workbookPath = path.join(tempRoot, 'scenario.xlsx');
  const service = await seedWorkbook(workbookPath, {
    features: [
      makeFeature('F-1', 1, 1, {
        build_estimate_current: 4,
        build_original_estimate: 7,
        build_actual_spent: 1,
        st_estimate_current: 2,
        st_original_estimate: 3,
        st_actual_spent: 0.5,
      }),
    ],
  });
  const versionBefore = await service.getWorkbookVersion();
  const hashBefore = await workbookHash(workbookPath);
  const app = await loadApp(workbookPath);
  try {
    const response = await requestJson(app.baseUrl, '/api/plan/scenario', {
      method: 'POST',
      body: { globalPercent: 20, featureOverrides: { 'F-1': 25 } },
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.workbookVersion, versionBefore);
    const build = response.json.data.plan.hard_dependency_blocking[0].build;
    const st = response.json.data.plan.hard_dependency_blocking[0].st;
    assert.equal(build.remaining_effort, 4);
    assert.equal(st.remaining_effort, 2);
    assert.equal(await workbookHash(workbookPath), hashBefore);
    const unchanged = await WorkbookService.create({ workbookPath });
    assert.equal(unchanged.listFeatures()[0].build_estimate_current, 4);
    assert.equal(unchanged.listFeatures()[0].build_original_estimate, 7);
    assert.equal(unchanged.listFeatures()[0].build_actual_spent, 1);
    const invalid = await requestJson(app.baseUrl, '/api/plan/scenario', {
      method: 'POST',
      body: { globalPercent: 51, featureOverrides: {} },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.code, 'INVALID_SCENARIO_INPUT');
  } finally {
    await app.close();
  }
}

async function verifyTeamPriorityCarriesAcrossRealReleases(tempRoot) {
  const workbookPath = path.join(tempRoot, 'team-priority-carry-forward.xlsx');
  const service = await seedWorkbook(workbookPath, {
    features: [
      makeFeature('HIGH', 1, 1, { release_id: '', build_estimate_current: 6 }),
      makeFeature('LOW', 2, 2, { release_id: '', build_estimate_current: 2 }),
    ],
  });
  await mutate(service, 'upsertRelease', {
    release_id: 'R-1',
    release_name: 'Release 1',
    status: 'Planned',
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    end_date: new Date('2026-01-15T00:00:00.000Z'),
    target_date: null,
    priority_order: 1,
  });
  await mutate(service, 'upsertRelease', {
    release_id: 'R-2',
    release_name: 'Release 2',
    status: 'Planned',
    start_date: new Date('2026-01-16T00:00:00.000Z'),
    end_date: new Date('2026-02-15T00:00:00.000Z'),
    target_date: null,
    priority_order: 2,
  });
  await mutate(service, 'upsertTeamReleaseCapacity', {
    team_id: 'T-1',
    release_id: 'R-1',
    build_capacity: 4,
    st_capacity: 0,
    capacity_source: 'Manual',
  });
  await mutate(service, 'upsertTeamReleaseCapacity', {
    team_id: 'T-1',
    release_id: 'R-2',
    build_capacity: 4,
    st_capacity: 0,
    capacity_source: 'Manual',
  });

  const version = await service.getWorkbookVersion();
  const hashBefore = await workbookHash(workbookPath);
  const app = await loadApp(workbookPath);
  try {
    const computed = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(computed.status, 200);
    assert.equal(computed.json.workbookVersion, version);
    const high = computed.json.data.schedule.find((item) => item.feature_id === 'HIGH');
    const low = computed.json.data.schedule.find((item) => item.feature_id === 'LOW');
    assert.deepEqual(
      high.allocations.map((item) => [item.release_id, item.build.allocated_effort]),
      [
        ['R-1', 4],
        ['R-2', 2],
      ]
    );
    assert.deepEqual(
      low.allocations.map((item) => [item.release_id, item.build.allocated_effort]),
      [
        ['R-1', 0],
        ['R-2', 2],
      ]
    );
    assert.ok(low.allocations[0].incomplete_reasons.includes('higher_priority_feature_incomplete'));

    const scheduled = await requestJson(app.baseUrl, '/api/plan/schedule', {
      method: 'POST',
      body: { plan: computed.json.data, expectedVersion: version },
    });
    assert.equal(scheduled.status, 200);
    assert.deepEqual(
      scheduled.json.data.releases.map((item) => item.release_id),
      ['R-1', 'R-2']
    );
    assert.deepEqual(
      scheduled.json.data.releases[1].features.map((item) => item.feature_id),
      ['HIGH', 'LOW']
    );
    assert.equal(scheduled.json.data.releases[1].features[0].build.start_date, '2026-01-16');
    assert.equal(
      scheduled.json.data.releases[1].features[1].build.start_date,
      '2026-01-16',
      'features in one release are projected in parallel after capacity allocation'
    );
    assert.equal(await workbookHash(workbookPath), hashBefore);
  } finally {
    await app.close();
  }
}

async function verifyPlanningValidation(tempRoot) {
  const workbookPath = path.join(tempRoot, 'invalid-priority.xlsx');
  await seedWorkbook(workbookPath, {
    features: [makeFeature('PRED', 2, 1), makeFeature('DEP', 1, 2)],
    dependencies: [
      {
        dependency_id: 'D-1',
        predecessor_feature_id: 'PRED',
        dependent_feature_id: 'DEP',
        dependency_type: 'Normal',
        dependency_status: 'Unresolved',
        affected_activity: null,
        blocking_pct: null,
      },
    ],
  });
  const app = await loadApp(workbookPath);
  try {
    const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal(response.json.code, 'INVALID_DEPENDENCY_PRIORITY');
    assert.match(response.json.error, /PRED.*priority 2.*DEP.*priority 1/);
    assert.equal(response.json.stage, 'dependency ordering validation');
    assert.equal(JSON.stringify(response.json).includes('stack'), false);
  } finally {
    await app.close();
  }
}

async function verifyDependencyCycle(tempRoot) {
  const workbookPath = path.join(tempRoot, 'cycle.xlsx');
  const service = await seedWorkbook(workbookPath, {
    features: [makeFeature('A', 1, 1), makeFeature('B', 2, 2)],
  });
  const worksheet = service.workbook.getWorksheet('Dependencies');
  worksheet.addRow([
    'D-AB',
    'A',
    'B',
    'Normal',
    null,
    null,
    'Unresolved',
    null,
    null,
    new Date(),
    new Date(),
  ]);
  worksheet.addRow([
    'D-BA',
    'B',
    'A',
    'Normal',
    null,
    null,
    'Unresolved',
    null,
    null,
    new Date(),
    new Date(),
  ]);
  await service.persistWorkbook({ expectedVersion: await service.getWorkbookVersion() });
  const app = await loadApp(workbookPath);
  try {
    const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal(response.json.code, 'DEPENDENCY_CYCLE');
    assert.ok(Array.isArray(response.json.details.cycle));
  } finally {
    await app.close();
  }
}

async function verifyBrokenReferences(tempRoot) {
  const cases = [
    {
      name: 'missing-feature',
      sheet: 'Dependencies',
      row: 2,
      column: 2,
      value: 'MISSING-FEATURE',
      expected: 'Features',
    },
    {
      name: 'missing-team',
      sheet: 'Features',
      row: 2,
      column: 6,
      value: 'MISSING-TEAM',
      expected: 'Teams',
    },
    {
      name: 'missing-release',
      sheet: 'Features',
      row: 2,
      column: 2,
      value: 'MISSING-RELEASE',
      expected: 'Releases',
    },
  ];
  for (const item of cases) {
    const workbookPath = path.join(tempRoot, `${item.name}.xlsx`);
    await seedWorkbook(workbookPath);
    if (item.name === 'missing-feature') {
      await appendCorruptRow(workbookPath, 'Dependencies', [
        'D-1',
        'F-1',
        'F-1-OTHER',
        'Normal',
        null,
        null,
        'Unresolved',
        null,
        null,
      ]);
    } else {
      await corruptWorkbook(workbookPath, item.sheet, item.row, item.column, item.value);
    }
    const app = await loadApp(workbookPath);
    try {
      const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
      assert.equal(response.status, 400);
      assert.equal(response.json.code, 'INVALID_WORKBOOK_STATE');
      assert.match(response.json.error, new RegExp(item.expected));
      assert.equal(response.json.error.includes(tempRoot), false);
    } finally {
      await app.close();
    }
  }
}

async function verifyStaleSnapshotRejected(tempRoot) {
  const workbookPath = path.join(tempRoot, 'stale.xlsx');
  const newerPath = path.join(tempRoot, 'newer.xlsx');
  await seedWorkbook(workbookPath);
  await fs.copyFile(workbookPath, newerPath);
  const newerService = await WorkbookService.create({ workbookPath: newerPath });
  await mutate(newerService, 'upsertTeam', {
    team_id: 'T-1',
    team_name: 'Team 1 newer',
    status: 'Active',
  });

  const originalListTeams = WorkbookService.prototype.listTeams;
  let replaced = false;
  WorkbookService.prototype.listTeams = function listTeamsWithConcurrentWrite() {
    const rows = originalListTeams.call(this);
    if (!replaced) {
      replaced = true;
      require('node:fs').copyFileSync(newerPath, workbookPath);
    }
    return rows;
  };
  const app = await loadApp(workbookPath);
  try {
    const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(response.status, 409);
    assert.equal(response.json.code, 'WORKBOOK_CONFLICT');
    assert.equal(response.json.data, undefined);
  } finally {
    WorkbookService.prototype.listTeams = originalListTeams;
    await app.close();
  }
}

async function verifyUnexpectedErrorIsSanitized(tempRoot) {
  const workbookPath = path.join(tempRoot, 'internal-error.xlsx');
  await seedWorkbook(workbookPath);
  const originalListTeams = WorkbookService.prototype.listTeams;
  WorkbookService.prototype.listTeams = () => {
    throw new Error('secret C:\\private\\workbook.xlsx');
  };
  const app = await loadApp(workbookPath);
  try {
    const response = await requestJson(app.baseUrl, '/api/plan/compute', { method: 'POST' });
    assert.equal(response.status, 500);
    assert.equal(response.json.code, 'INTERNAL_SERVER_ERROR');
    assert.equal(JSON.stringify(response.json).includes('secret'), false);
    assert.equal(JSON.stringify(response.json).includes('stack'), false);
  } finally {
    WorkbookService.prototype.listTeams = originalListTeams;
    await app.close();
  }
}

async function main() {
  await withTempDirectory(async (tempRoot) => {
    await verifySuccessfulReadOnlyPlan(tempRoot);
    await verifyScenarioReadOnlyCalculation(tempRoot);
    await verifyTeamPriorityCarriesAcrossRealReleases(tempRoot);
    await verifyCrossTeamPriorityValidation(tempRoot);
    await verifyPlanningValidation(tempRoot);
    await verifyDependencyCycle(tempRoot);
    await verifyBrokenReferences(tempRoot);
    await verifyStaleSnapshotRejected(tempRoot);
    await verifyUnexpectedErrorIsSanitized(tempRoot);
  });
  console.log('Planning API verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
