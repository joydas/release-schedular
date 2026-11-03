'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { WorkbookService } = require('../src/services/WorkbookService');

async function withTempWorkbook(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-scheduler-dependencies-'));
  const workbookPath = path.join(tempRoot, 'dependencies.xlsx');
  try {
    await callback(workbookPath);
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
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, got ${response.status}: ${JSON.stringify(response.json)}`
    );
  }
}

async function verifyDependencyValidation() {
  await withTempWorkbook(async (workbookPath) => {
    const { baseUrl, close } = await loadApp(workbookPath);
    try {
      let version = await (await WorkbookService.create({ workbookPath })).getWorkbookVersion();
      let response = await requestJson(baseUrl, '/api/teams', {
        method: 'POST',
        body: {
          expectedVersion: version,
          team_id: 'TEAM-DV',
          team_name: 'Dependency Team',
          status: 'Active',
        },
      });
      assertStatus(response, 201, 'create team');
      version = response.json.workbookVersion;
      response = await requestJson(baseUrl, '/api/releases', {
        method: 'POST',
        body: {
          expectedVersion: version,
          release_id: 'REL-DV',
          release_name: 'Dependency Release',
          status: 'Planned',
        },
      });
      assertStatus(response, 201, 'create release');
      version = response.json.workbookVersion;

      const featureIds = ['FEAT-A', 'FEAT-B', 'FEAT-C', 'FEAT-D', 'FEAT-E', 'FEAT-F'];
      for (const [index, featureId] of featureIds.entries()) {
        response = await requestJson(baseUrl, '/api/features', {
          method: 'POST',
          body: {
            expectedVersion: version,
            feature_id: featureId,
            release_id: 'REL-DV',
            feature_name: `Feature ${featureId}`,
            priority: index + 1,
            input_order: index + 1,
            team_id: 'TEAM-DV',
            status: 'Backlog',
            build_estimate_current: index + 3,
            build_original_estimate: index + 3,
            build_actual_spent: 0,
            st_estimate_current: 2,
            st_original_estimate: 2,
            st_actual_spent: 0,
          },
        });
        assertStatus(response, 201, `create ${featureId}`);
        version = response.json.workbookVersion;
      }

      const createDependency = async (dependency) => {
        const result = await requestJson(baseUrl, '/api/dependencies', {
          method: 'POST',
          body: { expectedVersion: version, dependency_status: 'Unresolved', ...dependency },
        });
        return result;
      };
      const normal = {
        dependency_id: 'DEP-AB',
        predecessor_feature_id: 'FEAT-A',
        dependent_feature_id: 'FEAT-B',
        dependency_type: 'Normal',
      };
      response = await createDependency(normal);
      assertStatus(response, 201, 'valid Normal dependency');
      version = response.json.workbookVersion;

      const hard = {
        dependency_id: 'DEP-BC',
        predecessor_feature_id: 'FEAT-B',
        dependent_feature_id: 'FEAT-C',
        dependency_type: 'Hard',
        affected_activity: 'Both',
        blocking_pct: 35,
      };
      response = await createDependency(hard);
      assertStatus(response, 201, 'valid Hard dependency');
      version = response.json.workbookVersion;

      response = await createDependency({
        dependency_id: 'DEP-AC',
        predecessor_feature_id: 'FEAT-A',
        dependent_feature_id: 'FEAT-C',
        dependency_type: 'Normal',
      });
      assertStatus(response, 201, 'second valid Normal dependency');
      version = response.json.workbookVersion;

      const validRows = await requestJson(baseUrl, '/api/dependencies');
      assertStatus(validRows, 200, 'dependency list');
      if (
        !validRows.json.data.some(
          (row) => row.dependency_id === 'DEP-AB' && row.dependency_type === 'Normal'
        )
      ) {
        throw new Error('Valid Normal dependency was not returned by the list route.');
      }
      if (
        !validRows.json.data.some(
          (row) =>
            row.dependency_id === 'DEP-BC' &&
            row.affected_activity === 'Both' &&
            Number(row.blocking_pct) === 35
        )
      ) {
        throw new Error('Valid Hard dependency did not retain its activity and percentage.');
      }

      const expectInvalidCreate = async (dependency, label) => {
        const beforeVersion = version;
        const beforeBytes = await fs.readFile(workbookPath);
        const failed = await createDependency({ ...dependency, dependency_id: `BAD-${label}` });
        assertStatus(failed, 400, label);
        const afterBytes = await fs.readFile(workbookPath);
        if (!afterBytes.equals(beforeBytes)) throw new Error(`${label} changed workbook bytes.`);
        const current = await WorkbookService.create({ workbookPath });
        if ((await current.getWorkbookVersion()) !== beforeVersion)
          throw new Error(`${label} advanced the workbook version.`);
      };

      await expectInvalidCreate(
        { ...normal, predecessor_feature_id: 'MISSING' },
        'missing reference'
      );
      await expectInvalidCreate(
        { ...normal, predecessor_feature_id: 'FEAT-A', dependent_feature_id: 'FEAT-A' },
        'self dependency'
      );
      await expectInvalidCreate(
        { ...normal, dependency_type: 'Hard', affected_activity: null, blocking_pct: 35 },
        'missing hard activity'
      );
      await expectInvalidCreate(
        { ...normal, dependency_type: 'Hard', affected_activity: 'Build', blocking_pct: null },
        'missing hard percentage'
      );
      for (const percentage of [-1, 101, 'nope']) {
        await expectInvalidCreate(
          {
            ...normal,
            dependency_type: 'Hard',
            affected_activity: 'Build',
            blocking_pct: percentage,
          },
          `invalid blocking percentage ${percentage}`
        );
      }
      await expectInvalidCreate(
        {
          ...normal,
          dependency_id: 'DEP-AB-OTHER-TYPE',
          dependency_type: 'Hard',
          affected_activity: 'ST',
          blocking_pct: 10,
        },
        'duplicate pair with another type'
      );
      await expectInvalidCreate(
        { ...normal, dependent_feature_id: 'FEAT-Z' },
        'unknown dependent feature'
      );

      const directCycle = await createDependency({
        dependency_id: 'DEP-BA',
        predecessor_feature_id: 'FEAT-B',
        dependent_feature_id: 'FEAT-A',
        dependency_type: 'Normal',
      });
      assertStatus(directCycle, 400, 'direct cycle');
      const indirectCycle = await createDependency({
        dependency_id: 'DEP-CA',
        predecessor_feature_id: 'FEAT-C',
        dependent_feature_id: 'FEAT-A',
        dependency_type: 'Normal',
      });
      assertStatus(indirectCycle, 400, 'indirect cycle');

      response = await requestJson(baseUrl, '/api/dependencies/DEP-AB', {
        method: 'PUT',
        body: { expectedVersion: version, notes: 'same relationship edit' },
      });
      assertStatus(response, 200, 'edit without false cycle');
      version = response.json.workbookVersion;

      const editCycleBefore = await fs.readFile(workbookPath);
      response = await requestJson(baseUrl, '/api/dependencies/DEP-BC', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          predecessor_feature_id: 'FEAT-C',
          dependent_feature_id: 'FEAT-A',
        },
      });
      assertStatus(response, 400, 'edit that creates cycle');
      if (!(await fs.readFile(workbookPath)).equals(editCycleBefore)) {
        throw new Error('Rejected cycle edit changed workbook bytes.');
      }

      // Simulate a legacy cycle. Loading it remains possible, and an unrelated edge remains writable.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(workbookPath);
      const dependencySheet = workbook.getWorksheet('Dependencies');
      const stamp = new Date();
      dependencySheet.addRow([
        'LEGACY-DE',
        'FEAT-D',
        'FEAT-E',
        'Normal',
        null,
        null,
        'Unresolved',
        null,
        'legacy cycle fixture',
        stamp,
        stamp,
      ]);
      dependencySheet.addRow([
        'LEGACY-ED',
        'FEAT-E',
        'FEAT-D',
        'Normal',
        null,
        null,
        'Unresolved',
        null,
        'legacy cycle fixture',
        stamp,
        stamp,
      ]);
      await workbook.xlsx.writeFile(workbookPath);

      const unrelated = await requestJson(baseUrl, '/api/dependencies', {
        method: 'POST',
        body: {
          expectedVersion: version,
          dependency_id: 'DEP-FA',
          predecessor_feature_id: 'FEAT-F',
          dependent_feature_id: 'FEAT-A',
          dependency_type: 'Normal',
          dependency_status: 'Unresolved',
        },
      });
      assertStatus(unrelated, 201, 'unrelated write with legacy cycle present');
      version = unrelated.json.workbookVersion;

      const stale = await requestJson(baseUrl, '/api/dependencies/DEP-AB', {
        method: 'PUT',
        body: { expectedVersion: version - 1, notes: 'must stay stale' },
      });
      assertStatus(stale, 409, 'stale dependency update');

      const afterReload = await WorkbookService.create({ workbookPath });
      const persisted = afterReload.listDependencies();
      if (!persisted.some((row) => row.dependency_id === 'DEP-FA')) {
        throw new Error('A valid dependency mutation did not survive workbook reload.');
      }
      if (
        afterReload.getFeature('FEAT-A').build_estimate_current !== 3 ||
        afterReload.getFeature('FEAT-A').build_original_estimate !== 3
      ) {
        throw new Error('Dependency validation unexpectedly changed feature effort fields.');
      }
    } finally {
      await close();
    }
  });
}

verifyDependencyValidation()
  .then(() => console.log('Dependency validation verification passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
