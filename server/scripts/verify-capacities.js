'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { WorkbookService } = require('../src/services/WorkbookService');

async function withTempWorkbook(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-scheduler-capacities-'));
  const workbookPath = path.join(tempRoot, 'capacities.xlsx');

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

async function verifyCapacityHappyPath() {
  await withTempWorkbook(async (workbookPath) => {
    const { baseUrl, close } = await loadApp(workbookPath);
    const service = await WorkbookService.create({ workbookPath });

    try {
      let version = await service.getWorkbookVersion();
      await service.upsertTeam(
        {
          team_id: 'TEAM-CAP',
          team_name: 'Capacity Team',
          status: 'Active',
        },
        { expectedVersion: version }
      );
      version = await service.getWorkbookVersion();
      await service.upsertRelease(
        {
          release_id: 'REL-CAP',
          release_name: 'Capacity Release',
          status: 'Planned',
          start_date: '2026-02-01',
          end_date: '2026-02-28',
          target_date: '2026-02-15',
          priority_order: 1,
        },
        { expectedVersion: version }
      );
      version = await service.getWorkbookVersion();

      let listResponse = await requestJson(baseUrl, '/api/capacities');
      assertStatus(listResponse, 200, 'list capacities empty');
      if (listResponse.json.data.length !== 0) {
        throw new Error('GET /api/capacities should list zero capacity records before creation.');
      }

      let createResponse = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          build_capacity: 12.5,
          st_capacity: 8,
          capacity_source: 'Manual',
        },
      });
      assertStatus(createResponse, 200, 'capacity create');
      if (createResponse.json.data.build_capacity !== 12.5) {
        throw new Error('Create response did not preserve the Build capacity value.');
      }
      if (createResponse.json.data.st_capacity !== 8) {
        throw new Error('Create response did not preserve the ST capacity value.');
      }
      version = createResponse.json.workbookVersion;

      const readResponse = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP');
      assertStatus(readResponse, 200, 'capacity read');
      if (readResponse.json.data.build_capacity !== 12.5) {
        throw new Error(
          'GET /api/capacities/:teamId/:releaseId returned the wrong Build capacity.'
        );
      }
      if (readResponse.json.data.st_capacity !== 8) {
        throw new Error('GET /api/capacities/:teamId/:releaseId returned the wrong ST capacity.');
      }

      let updateResponse = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          build_capacity: 15.75,
          st_capacity: 10.5,
          capacity_source: 'Imported',
        },
      });
      assertStatus(updateResponse, 200, 'capacity update');
      if (updateResponse.json.data.build_capacity !== 15.75) {
        throw new Error('Capacity update did not change Build capacity as expected.');
      }
      if (updateResponse.json.data.st_capacity !== 10.5) {
        throw new Error('Capacity update did not change ST capacity as expected.');
      }

      listResponse = await requestJson(baseUrl, '/api/capacities');
      assertStatus(listResponse, 200, 'capacity list after update');
      if (listResponse.json.data.length !== 1) {
        throw new Error('Capacity list should contain exactly one record after updates.');
      }

      const reloaded = await WorkbookService.create({ workbookPath });
      const persisted = reloaded.getTeamReleaseCapacity('TEAM-CAP', 'REL-CAP');
      if (!persisted) {
        throw new Error('Capacity row did not persist after workbook reload.');
      }
      if (persisted.build_capacity !== 15.75 || persisted.st_capacity !== 10.5) {
        throw new Error('Persisted capacity values did not survive reload.');
      }
    } finally {
      await close();
    }
  });
}

async function verifyCapacityValidation() {
  await withTempWorkbook(async (workbookPath) => {
    const { baseUrl, close } = await loadApp(workbookPath);
    const service = await WorkbookService.create({ workbookPath });

    try {
      let version = await service.getWorkbookVersion();
      await service.upsertTeam(
        {
          team_id: 'TEAM-CAP',
          team_name: 'Capacity Team',
          status: 'Active',
        },
        { expectedVersion: version }
      );
      version = await service.getWorkbookVersion();
      await service.upsertRelease(
        {
          release_id: 'REL-CAP',
          release_name: 'Capacity Release',
          status: 'Planned',
          start_date: '2026-02-01',
          end_date: '2026-02-28',
          target_date: '2026-02-15',
          priority_order: 1,
        },
        { expectedVersion: version }
      );
      version = await service.getWorkbookVersion();

      let response = await requestJson(baseUrl, '/api/capacities/NOPE/REL-CAP');
      assertStatus(response, 404, 'missing team capacity read');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/NOPE');
      assertStatus(response, 404, 'missing release capacity read');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version, build_capacity: 10, st_capacity: 5 },
      });
      assertStatus(response, 200, 'capacity insert');
      version = response.json.workbookVersion;

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version, build_capacity: 11, st_capacity: 6 },
      });
      assertStatus(response, 200, 'capacity duplicate update');
      version = response.json.workbookVersion;

      const listResponse = await requestJson(baseUrl, '/api/capacities');
      assertStatus(listResponse, 200, 'capacity list uniqueness');
      if (listResponse.json.data.length !== 1) {
        throw new Error('Composite-key capacity update should not create duplicate rows.');
      }

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version, st_capacity: 4 },
      });
      assertStatus(response, 400, 'missing build capacity');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version, build_capacity: -1, st_capacity: 4 },
      });
      assertStatus(response, 400, 'negative build capacity');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version, build_capacity: 'NaN', st_capacity: 4 },
      });
      assertStatus(response, 400, 'non-finite build capacity');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: 'not-a-number', build_capacity: 4, st_capacity: 6 },
      });
      assertStatus(response, 400, 'bad expected version type');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: -1, build_capacity: 4, st_capacity: 6 },
      });
      assertStatus(response, 400, 'negative expected version');

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version - 1, build_capacity: 4, st_capacity: 6 },
      });
      assertStatus(response, 409, 'stale expected version');

      const beforeReject = JSON.stringify(
        (await WorkbookService.create({ workbookPath })).listTeamReleaseCapacity()
      );

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version, build_capacity: 99, st_capacity: 99 },
      });
      assertStatus(response, 200, 'capacity accepted version');
      version = response.json.workbookVersion;

      const afterValid = JSON.stringify(
        (await WorkbookService.create({ workbookPath })).listTeamReleaseCapacity()
      );
      if (beforeReject === afterValid) {
        throw new Error('Expected the accepted mutation to change persisted capacity values.');
      }

      response = await requestJson(baseUrl, '/api/capacities/TEAM-CAP/REL-CAP', {
        method: 'PUT',
        body: { expectedVersion: version - 1, build_capacity: 1, st_capacity: 1 },
      });
      assertStatus(response, 409, 'stale version after valid update');

      const reloaded = await WorkbookService.create({ workbookPath });
      const persisted = reloaded.getTeamReleaseCapacity('TEAM-CAP', 'REL-CAP');
      if (!persisted || persisted.build_capacity !== 99 || persisted.st_capacity !== 99) {
        throw new Error('Rejected stale-version writes changed persisted capacity data.');
      }
    } finally {
      await close();
    }
  });
}

async function main() {
  await verifyCapacityHappyPath();
  await verifyCapacityValidation();
  console.log('Capacity verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
