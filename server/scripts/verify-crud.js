'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { WorkbookService } = require('../src/services/WorkbookService');

async function withTempWorkbook(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-scheduler-crud-'));
  const workbookPath = path.join(tempRoot, 'crud.xlsx');

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
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

async function requestJson(baseUrl, route, { method = 'GET', body } = {}) {
  const requestBody = method === 'GET' || method === 'HEAD' ? undefined : body;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: requestBody ? { 'content-type': 'application/json' } : undefined,
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });

  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

function assertStatus(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label}: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(response.json)}`
    );
  }
}

async function verifyCrudHappyPath() {
  await withTempWorkbook(async (workbookPath) => {
    const { baseUrl, close } = await loadApp(workbookPath);
    const service = await WorkbookService.create({ workbookPath });

    try {
      let version = await service.getWorkbookVersion();

      let response = await requestJson(baseUrl, '/api/teams', {
        method: 'POST',
        body: {
          expectedVersion: version,
          team_id: 'TEAM-CRUD',
          team_name: 'Team CRUD',
          status: 'Active',
          notes: 'Planning team',
        },
      });
      assertStatus(response, 201, 'team create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/teams');
      assertStatus(response, 200, 'team list');
      if (
        response.json.workbookVersion !== version ||
        response.json.data[0]?.team_id !== 'TEAM-CRUD' ||
        response.json.data[0]?.notes !== 'Planning team'
      ) {
        throw new Error('Team list did not return the expected fields and workbook version.');
      }

      response = await requestJson(baseUrl, '/api/teams/TEAM-CRUD');
      assertStatus(response, 200, 'team read');
      if (response.json.data.team_name !== 'Team CRUD') {
        throw new Error('Team read returned the wrong team payload.');
      }

      response = await requestJson(baseUrl, '/api/teams/TEAM-CRUD', {
        method: 'PUT',
        body: { expectedVersion: version, team_name: 'Team CRUD Updated' },
      });
      assertStatus(response, 200, 'team update');
      version = response.json.workbookVersion;
      if (
        response.json.data.team_name !== 'Team CRUD Updated' ||
        response.json.data.status !== 'Active' ||
        response.json.data.notes !== 'Planning team'
      ) {
        throw new Error('Partial team update did not preserve omitted team fields.');
      }

      response = await requestJson(baseUrl, '/api/releases', {
        method: 'POST',
        body: {
          expectedVersion: version,
          release_id: 'REL-CRUD',
          release_name: 'Release CRUD',
          status: 'Planned',
          start_date: '2026-01-01',
          end_date: '2026-01-31',
          target_date: '2026-01-15',
          priority_order: 1,
        },
      });
      assertStatus(response, 201, 'release create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/releases');
      assertStatus(response, 200, 'release list');
      if (
        response.json.workbookVersion !== version ||
        response.json.data.length !== 1 ||
        response.json.data[0].release_id !== 'REL-CRUD' ||
        response.json.data[0].priority_order !== 1 ||
        new Date(response.json.data[0].start_date).toISOString().slice(0, 10) !== '2026-01-01'
      ) {
        throw new Error('Release list did not return its expected fields and workbook version.');
      }

      response = await requestJson(baseUrl, '/api/releases', {
        method: 'POST',
        body: {
          expectedVersion: version,
          release_id: 'REL-INVALID-DATES',
          release_name: 'Invalid dates',
          status: 'Planned',
          start_date: '2026-02-01',
          end_date: '2026-01-01',
        },
      });
      assertStatus(response, 400, 'release reversed date range');

      response = await requestJson(baseUrl, '/api/releases/REL-CRUD');
      assertStatus(response, 200, 'release read');

      response = await requestJson(baseUrl, '/api/releases/REL-CRUD', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          release_name: 'Release CRUD Updated',
          status: 'Active',
        },
      });
      assertStatus(response, 200, 'release update');
      version = response.json.workbookVersion;
      if (
        response.json.data.release_name !== 'Release CRUD Updated' ||
        response.json.data.status !== 'Active' ||
        response.json.data.priority_order !== 1 ||
        new Date(response.json.data.start_date).toISOString().slice(0, 10) !== '2026-01-01' ||
        new Date(response.json.data.end_date).toISOString().slice(0, 10) !== '2026-01-31' ||
        new Date(response.json.data.target_date).toISOString().slice(0, 10) !== '2026-01-15'
      ) {
        throw new Error('Partial release update did not preserve omitted schedule fields.');
      }

      response = await requestJson(baseUrl, '/api/features', {
        method: 'POST',
        body: {
          expectedVersion: version,
          feature_id: 'FEAT-CRUD',
          release_id: 'REL-CRUD',
          feature_name: 'Feature CRUD',
          priority: 1,
          input_order: 1,
          team_id: 'TEAM-CRUD',
          status: 'Backlog',
          build_estimate_current: 5,
          build_original_estimate: 10,
          build_actual_spent: 2,
          st_estimate_current: 3,
          st_original_estimate: 6,
          st_actual_spent: 1,
        },
      });
      assertStatus(response, 201, 'feature create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/features');
      assertStatus(response, 200, 'feature list');
      if (
        response.json.workbookVersion !== version ||
        response.json.data.length !== 1 ||
        response.json.data[0].feature_id !== 'FEAT-CRUD' ||
        response.json.data[0].release_id !== 'REL-CRUD' ||
        response.json.data[0].priority !== 1 ||
        response.json.data[0].input_order !== 1
      ) {
        throw new Error('Feature list did not return the expected fields and workbook version.');
      }

      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD');
      assertStatus(response, 200, 'feature read');

      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          feature_name: 'Feature CRUD Updated',
          build_estimate_current: 7,
        },
      });
      assertStatus(response, 200, 'feature update');
      if (response.json.data.build_original_estimate !== 10) {
        throw new Error('Feature update unexpectedly changed original estimate when omitted.');
      }
      if (response.json.data.build_actual_spent !== 2) {
        throw new Error('Feature update unexpectedly changed actual spent when omitted.');
      }
      if (
        response.json.data.st_original_estimate !== 6 ||
        response.json.data.st_actual_spent !== 1 ||
        response.json.data.st_estimate_current !== 3
      ) {
        throw new Error('Feature update unexpectedly changed omitted ST effort fields.');
      }
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD', {
        method: 'PUT',
        body: { expectedVersion: version, team_id: '' },
      });
      assertStatus(response, 200, 'feature unassign team');
      if (response.json.data.team_id !== null) {
        throw new Error('An empty team assignment should clear the optional feature team.');
      }
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD', {
        method: 'PUT',
        body: { expectedVersion: version, build_estimate_current: -1 },
      });
      assertStatus(response, 400, 'negative feature estimate');
      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD');
      assertStatus(response, 200, 'feature read after rejected negative estimate');
      if (
        response.json.workbookVersion !== version ||
        response.json.data.build_estimate_current !== 7 ||
        response.json.data.build_original_estimate !== 10 ||
        response.json.data.build_actual_spent !== 2
      ) {
        throw new Error('Rejected negative estimate changed feature effort data.');
      }
      version = response.json.workbookVersion;

      response = await requestJson(
        baseUrl,
        `/api/features/${response.json.data.feature_id}/stories`,
        {
          method: 'POST',
          body: {
            expectedVersion: version,
            story_id: 'STORY-CRUD',
            story_name: 'Story CRUD',
            input_order: 1,
            status: 'Backlog',
            build_estimate_current: 4,
            build_original_estimate: 8,
            build_actual_spent: 1,
            st_estimate_current: 2,
            st_original_estimate: 4,
            st_actual_spent: 0,
          },
        }
      );
      assertStatus(response, 201, 'story create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD/stories');
      assertStatus(response, 200, 'feature story list');
      if (
        response.json.workbookVersion !== version ||
        response.json.data.length !== 1 ||
        response.json.data[0].story_id !== 'STORY-CRUD' ||
        response.json.data[0].feature_id !== 'FEAT-CRUD'
      ) {
        throw new Error(
          'Feature story list did not return its expected records and workbook version.'
        );
      }

      response = await requestJson(baseUrl, `/api/features/FEAT-CRUD/stories/STORY-CRUD`);
      assertStatus(response, 200, 'story read');

      response = await requestJson(baseUrl, `/api/features/FEAT-CRUD/stories/STORY-CRUD`, {
        method: 'PUT',
        body: {
          expectedVersion: version,
          story_name: 'Story CRUD Updated',
          build_estimate_current: 5,
        },
      });
      assertStatus(response, 200, 'story update');
      if (response.json.data.build_original_estimate !== 8) {
        throw new Error('Story update unexpectedly changed original estimate when omitted.');
      }
      if (response.json.data.build_actual_spent !== 1) {
        throw new Error('Story update unexpectedly changed actual spent when omitted.');
      }
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/dependencies', {
        method: 'POST',
        body: {
          expectedVersion: version,
          dependency_id: 'DEP-CRUD',
          predecessor_feature_id: 'FEAT-CRUD',
          dependent_feature_id: 'FEAT-CRUD',
          dependency_type: 'Normal',
          dependency_status: 'Unresolved',
        },
      });
      assertStatus(response, 400, 'self dependency invalid');

      response = await requestJson(baseUrl, '/api/dependencies', {
        method: 'POST',
        body: {
          expectedVersion: version,
          dependency_id: 'DEP-CRUD-OK',
          predecessor_feature_id: 'FEAT-CRUD',
          dependent_feature_id: 'FEAT-CRUD',
          dependency_type: 'Normal',
          dependency_status: 'Unresolved',
        },
      });
      assertStatus(response, 400, 'dependency same feature invalid');

      response = await requestJson(baseUrl, '/api/features', {
        method: 'POST',
        body: {
          expectedVersion: version,
          feature_id: 'FEAT-SECOND',
          feature_name: 'Second Feature',
          priority: 2,
          input_order: 2,
          team_id: 'TEAM-CRUD',
          status: 'Backlog',
          build_estimate_current: 2,
          build_original_estimate: 2,
          build_actual_spent: 0,
          st_estimate_current: 1,
          st_original_estimate: 1,
          st_actual_spent: 0,
        },
      });
      assertStatus(response, 201, 'second feature create');
      if (response.json.data.release_id !== '') {
        throw new Error('Feature creation should not require or assign a release ID.');
      }
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/dependencies', {
        method: 'POST',
        body: {
          expectedVersion: version,
          dependency_id: 'DEP-OK',
          predecessor_feature_id: 'FEAT-CRUD',
          dependent_feature_id: 'FEAT-SECOND',
          dependency_type: 'Normal',
          dependency_status: 'Unresolved',
        },
      });
      assertStatus(response, 201, 'dependency create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/dependencies/DEP-OK');
      assertStatus(response, 200, 'dependency read');
      if (response.json.data.dependency_type !== 'Normal') {
        throw new Error('Dependency read did not preserve the Normal classification.');
      }

      response = await requestJson(baseUrl, '/api/dependencies');
      assertStatus(response, 200, 'dependency list');
      if (
        !response.json.data.some(
          (dependency) =>
            dependency.dependency_id === 'DEP-OK' &&
            dependency.predecessor_feature_id === 'FEAT-CRUD' &&
            dependency.dependent_feature_id === 'FEAT-SECOND'
        )
      ) {
        throw new Error(
          'Dependency list did not return the expected predecessor-to-dependent record.'
        );
      }

      response = await requestJson(baseUrl, '/api/dependencies/DEP-OK', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          dependency_type: 'Hard',
          affected_activity: 'Both',
          blocking_pct: 25,
          notes: 'CRUD verification dependency',
          dependency_status: 'Resolved',
        },
      });
      assertStatus(response, 200, 'dependency update');
      if (
        response.json.data.dependency_type !== 'Hard' ||
        response.json.data.affected_activity !== 'Both' ||
        Number(response.json.data.blocking_pct) !== 25 ||
        response.json.data.notes !== 'CRUD verification dependency'
      ) {
        throw new Error(
          'Dependency update did not preserve the Hard classification and supported fields.'
        );
      }
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, `/api/features/FEAT-CRUD/stories/STORY-CRUD`, {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(response, 200, 'story delete');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, `/api/features/FEAT-CRUD/stories/STORY-CRUD`);
      assertStatus(response, 404, 'story missing after delete');

      response = await requestJson(baseUrl, '/api/dependencies/DEP-OK', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(response, 200, 'dependency delete');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/dependencies/DEP-OK');
      assertStatus(response, 404, 'dependency missing after delete');

      response = await requestJson(baseUrl, '/api/features/FEAT-SECOND', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(response, 200, 'second feature delete');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/features/FEAT-CRUD', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(response, 200, 'feature delete');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/teams/TEAM-CRUD', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(response, 200, 'team delete');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/releases/REL-CRUD', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(response, 200, 'release delete');

      const reloaded = await WorkbookService.create({ workbookPath });
      if (reloaded.getTeam('TEAM-CRUD')) {
        throw new Error('Reloaded workbook still contains deleted team.');
      }
      if (reloaded.getRelease('REL-CRUD')) {
        throw new Error('Reloaded workbook still contains deleted release.');
      }
      if (reloaded.getFeature('FEAT-CRUD')) {
        throw new Error('Reloaded workbook still contains deleted feature.');
      }
    } finally {
      await close();
    }
  });
}

async function verifyMissingEntitiesAndVersionRules() {
  await withTempWorkbook(async (workbookPath) => {
    const { baseUrl, close } = await loadApp(workbookPath);
    try {
      const service = await WorkbookService.create({ workbookPath });
      let version = await service.getWorkbookVersion();

      const missingRoutes = [
        ['/api/teams/NOPE', 'GET'],
        ['/api/teams/NOPE', 'PUT'],
        ['/api/teams/NOPE', 'DELETE'],
        ['/api/releases/NOPE', 'GET'],
        ['/api/releases/NOPE', 'PUT'],
        ['/api/releases/NOPE', 'DELETE'],
        ['/api/features/NOPE', 'GET'],
        ['/api/features/NOPE', 'PUT'],
        ['/api/features/NOPE', 'DELETE'],
        ['/api/features/NOPE/stories/NOPE', 'GET'],
        ['/api/features/NOPE/stories/NOPE', 'PUT'],
        ['/api/features/NOPE/stories/NOPE', 'DELETE'],
        ['/api/dependencies/NOPE', 'GET'],
        ['/api/dependencies/NOPE', 'PUT'],
        ['/api/dependencies/NOPE', 'DELETE'],
      ];

      for (const [route, method] of missingRoutes) {
        const response = await requestJson(baseUrl, route, {
          method,
          body: { expectedVersion: version },
        });
        assertStatus(response, 404, `missing entity ${route} ${method}`);
      }

      const invalidVersionCases = [undefined, '', 'abc', '-1', '1.5'];
      for (const invalidVersion of invalidVersionCases) {
        const response = await requestJson(baseUrl, '/api/teams', {
          method: 'POST',
          body: {
            expectedVersion: invalidVersion,
            team_id: 'TEAM-INVALID-VERSION',
            team_name: 'Bad Team',
            status: 'Active',
          },
        });
        assertStatus(response, 400, `invalid version ${String(invalidVersion)}`);
      }

      const createdTeam = await requestJson(baseUrl, '/api/teams', {
        method: 'POST',
        body: {
          expectedVersion: version,
          team_id: 'TEAM-STALE',
          team_name: 'Stale Team',
          status: 'Active',
        },
      });
      assertStatus(createdTeam, 201, 'stale-version setup team create');
      version = createdTeam.json.workbookVersion;

      const staleResponse = await requestJson(baseUrl, '/api/teams/TEAM-STALE', {
        method: 'PUT',
        body: { expectedVersion: version - 1, team_name: 'Stale Update' },
      });
      assertStatus(staleResponse, 409, 'stale version update');

      const beforeBytes = await fs.readFile(workbookPath);
      const staleDelete = await requestJson(baseUrl, '/api/teams/TEAM-STALE', {
        method: 'DELETE',
        body: { expectedVersion: version - 1 },
      });
      assertStatus(staleDelete, 409, 'stale delete version');
      const afterBytes = await fs.readFile(workbookPath);
      if (!afterBytes.equals(beforeBytes)) {
        throw new Error('Stale delete mutated the workbook file.');
      }
    } finally {
      await close();
    }
  });
}

async function verifyDeleteReferentialConflicts() {
  await withTempWorkbook(async (workbookPath) => {
    const { baseUrl, close } = await loadApp(workbookPath);
    try {
      const service = await WorkbookService.create({ workbookPath });
      let version = await service.getWorkbookVersion();

      let response = await requestJson(baseUrl, '/api/teams', {
        method: 'POST',
        body: {
          expectedVersion: version,
          team_id: 'TEAM-CONFLICT',
          team_name: 'Team Conflict',
          status: 'Active',
        },
      });
      assertStatus(response, 201, 'conflict team create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/releases', {
        method: 'POST',
        body: {
          expectedVersion: version,
          release_id: 'REL-CONFLICT',
          release_name: 'Release Conflict',
          status: 'Planned',
          start_date: '2026-02-01',
          end_date: '2026-02-28',
          target_date: '2026-02-15',
          priority_order: 1,
        },
      });
      assertStatus(response, 201, 'conflict release create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/features', {
        method: 'POST',
        body: {
          expectedVersion: version,
          feature_id: 'FEAT-CONFLICT',
          release_id: 'REL-CONFLICT',
          feature_name: 'Feature Conflict',
          priority: 1,
          input_order: 1,
          team_id: 'TEAM-CONFLICT',
          status: 'Backlog',
          build_estimate_current: 5,
          build_original_estimate: 5,
          build_actual_spent: 0,
          st_estimate_current: 2,
          st_original_estimate: 2,
          st_actual_spent: 0,
        },
      });
      assertStatus(response, 201, 'conflict feature create');
      version = response.json.workbookVersion;

      response = await requestJson(
        baseUrl,
        `/api/features/${response.json.data.feature_id}/stories`,
        {
          method: 'POST',
          body: {
            expectedVersion: version,
            story_id: 'STORY-CONFLICT',
            story_name: 'Story Conflict',
            input_order: 1,
            status: 'Backlog',
            build_estimate_current: 1,
            build_original_estimate: 1,
            build_actual_spent: 0,
            st_estimate_current: 1,
            st_original_estimate: 1,
            st_actual_spent: 0,
          },
        }
      );
      assertStatus(response, 201, 'conflict story create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/dependencies', {
        method: 'POST',
        body: {
          expectedVersion: version,
          dependency_id: 'DEP-CONFLICT',
          predecessor_feature_id: 'FEAT-CONFLICT',
          dependent_feature_id: 'FEAT-CONFLICT',
          dependency_type: 'Normal',
          dependency_status: 'Unresolved',
        },
      });
      assertStatus(response, 400, 'self dependency invalid for conflict setup');

      response = await requestJson(baseUrl, '/api/features', {
        method: 'POST',
        body: {
          expectedVersion: version,
          feature_id: 'FEAT-SECOND-CONFLICT',
          release_id: 'REL-CONFLICT',
          feature_name: 'Second Conflict Feature',
          priority: 2,
          input_order: 2,
          team_id: 'TEAM-CONFLICT',
          status: 'Backlog',
          build_estimate_current: 3,
          build_original_estimate: 3,
          build_actual_spent: 0,
          st_estimate_current: 1,
          st_original_estimate: 1,
          st_actual_spent: 0,
        },
      });
      assertStatus(response, 201, 'second feature create');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/dependencies', {
        method: 'POST',
        body: {
          expectedVersion: version,
          dependency_id: 'DEP-CONFLICT-OK',
          predecessor_feature_id: 'FEAT-CONFLICT',
          dependent_feature_id: 'FEAT-SECOND-CONFLICT',
          dependency_type: 'Normal',
          dependency_status: 'Unresolved',
        },
      });
      assertStatus(response, 201, 'dependency create for conflict');
      version = response.json.workbookVersion;

      const deleteRelease = await requestJson(baseUrl, '/api/releases/REL-CONFLICT', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(deleteRelease, 409, 'delete release with feature');
      const releaseAfter = await requestJson(baseUrl, '/api/releases/REL-CONFLICT');
      assertStatus(releaseAfter, 200, 'release still exists after failed delete');

      const deleteFeature = await requestJson(baseUrl, '/api/features/FEAT-CONFLICT', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(deleteFeature, 409, 'delete feature with story/dependency');
      const featureAfter = await requestJson(baseUrl, '/api/features/FEAT-CONFLICT');
      assertStatus(featureAfter, 200, 'feature still exists after failed delete');

      const deleteTeam = await requestJson(baseUrl, '/api/teams/TEAM-CONFLICT', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(deleteTeam, 409, 'delete team with feature');
      const teamAfter = await requestJson(baseUrl, '/api/teams/TEAM-CONFLICT');
      assertStatus(teamAfter, 200, 'team still exists after failed delete');

      const deleteStory = await requestJson(
        baseUrl,
        '/api/features/FEAT-CONFLICT/stories/STORY-CONFLICT',
        {
          method: 'DELETE',
          body: { expectedVersion: version },
        }
      );
      assertStatus(deleteStory, 200, 'delete story when safe');
      version = deleteStory.json.workbookVersion;

      const deleteDependency = await requestJson(baseUrl, '/api/dependencies/DEP-CONFLICT-OK', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(deleteDependency, 200, 'delete dependency when safe');
      version = deleteDependency.json.workbookVersion;

      const deleteFeatureSafe = await requestJson(baseUrl, '/api/features/FEAT-CONFLICT', {
        method: 'DELETE',
        body: { expectedVersion: version },
      });
      assertStatus(deleteFeatureSafe, 200, 'feature delete after dependent rows removed');
    } finally {
      await close();
    }
  });
}

async function main() {
  await verifyCrudHappyPath();
  await verifyMissingEntitiesAndVersionRules();
  await verifyDeleteReferentialConflicts();
  console.log('CRUD verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
