'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { WorkbookService } = require('../src/services/WorkbookService');

async function withTempWorkbook(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-scheduler-config-'));
  const workbookPath = path.join(tempRoot, 'config.xlsx');

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

async function verifyConfigHappyPath() {
  await withTempWorkbook(async (workbookPath) => {
    const service = await WorkbookService.create({ workbookPath });
    const { baseUrl, close } = await loadApp(workbookPath);

    try {
      await service.upsertConfigValue(
        {
          config_key: 'SCHEMA_VERSION',
          config_value: '1.0',
          value_type: 'String',
          description: 'Workbook schema version.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      await service.upsertConfigValue(
        {
          config_key: 'LAST_UPDATED_AT',
          config_value: '2026-10-31T00:00:00.000Z',
          value_type: 'Date',
          description: 'Last workbook update timestamp.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      await service.upsertConfigValue(
        {
          config_key: 'SPRINT_CADENCE',
          config_value: '2x15+5',
          value_type: 'String',
          description: 'Sprint cadence policy.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      await service.upsertConfigValue(
        {
          config_key: 'LAST_IMPORTED_AT',
          config_value: '2026-10-30T00:00:00.000Z',
          value_type: 'Date',
          description: 'Last CSV import timestamp.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );

      const version = await service.getWorkbookVersion();

      const getResponse = await requestJson(baseUrl, '/api/config');
      assertStatus(getResponse, 200, 'config get');
      if (
        !getResponse.json.data.SPRINT_CADENCE ||
        getResponse.json.data.SPRINT_CADENCE !== '2x15+5'
      ) {
        throw new Error('GET /api/config did not return the expected sprint cadence.');
      }

      const updateResponse = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          SPRINT_CADENCE: '3x15+5',
        },
      });
      assertStatus(updateResponse, 200, 'config put');
      if (updateResponse.json.data.SPRINT_CADENCE !== '3x15+5') {
        throw new Error('PUT /api/config did not persist the updated sprint cadence.');
      }

      const protectedImportTimestamp = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: updateResponse.json.workbookVersion,
          LAST_IMPORTED_AT: '2026-10-31T12:00:00.000Z',
        },
      });
      assertStatus(protectedImportTimestamp, 400, 'protected import timestamp');
      if (protectedImportTimestamp.json.data) {
        throw new Error('Protected config key update unexpectedly returned a success payload.');
      }

      const reloaded = await WorkbookService.create({ workbookPath });
      const configValue = reloaded.getConfigValue('SPRINT_CADENCE');
      if (!configValue || configValue.config_value !== '3x15+5') {
        throw new Error('Updated config value did not survive workbook reload.');
      }

      const lastImported = reloaded.getConfigValue('LAST_IMPORTED_AT');
      if (!lastImported || lastImported.config_value !== '2026-10-30T00:00:00.000Z') {
        throw new Error(
          'Protected metadata must remain unchanged when rejected via PUT /api/config.'
        );
      }
    } finally {
      await close();
    }
  });
}

async function verifyConfigValidation() {
  await withTempWorkbook(async (workbookPath) => {
    const service = await WorkbookService.create({ workbookPath });
    const { baseUrl, close } = await loadApp(workbookPath);

    try {
      await service.upsertConfigValue(
        {
          config_key: 'SCHEMA_VERSION',
          config_value: '1.0',
          value_type: 'String',
          description: 'Workbook schema version.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      await service.upsertConfigValue(
        {
          config_key: 'SPRINT_CADENCE',
          config_value: '2x15+5',
          value_type: 'String',
          description: 'Sprint cadence policy.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      await service.upsertConfigValue(
        {
          config_key: 'LAST_IMPORTED_AT',
          config_value: '2026-10-30T00:00:00.000Z',
          value_type: 'Date',
          description: 'Last CSV import timestamp.',
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );

      const version = await service.getWorkbookVersion();
      const before = await service.listConfig();

      const unknownKey = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          UNKNOWN_KEY: 'bad value',
        },
      });
      assertStatus(unknownKey, 400, 'unknown config key');

      const invalidVersion = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: 'not-a-number',
          SPRINT_CADENCE: '3x15+5',
        },
      });
      assertStatus(invalidVersion, 400, 'bad expected version');

      const staleVersion = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: version - 1,
          SPRINT_CADENCE: '1x15+5',
        },
      });
      assertStatus(staleVersion, 409, 'stale expected version');

      const after = await service.listConfig();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error('Rejected config request mutated the workbook state.');
      }

      const protectedKey = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          SCHEMA_VERSION: '9.9',
        },
      });
      assertStatus(protectedKey, 400, 'protected config key');

      const protectedImportTimestamp = await requestJson(baseUrl, '/api/config', {
        method: 'PUT',
        body: {
          expectedVersion: version,
          LAST_IMPORTED_AT: '2026-10-31T12:00:00.000Z',
        },
      });
      assertStatus(protectedImportTimestamp, 400, 'protected import timestamp');

      const current = await WorkbookService.create({ workbookPath });
      const sameValue = current.getConfigValue('SPRINT_CADENCE');
      if (!sameValue || sameValue.config_value !== '2x15+5') {
        throw new Error('Rejected config mutation changed persisted workbook values.');
      }
      if (!current.getConfigValue('LAST_IMPORTED_AT')) {
        throw new Error(
          'Expected LAST_IMPORTED_AT config row to remain present after rejected update.'
        );
      }
    } finally {
      await close();
    }
  });
}

async function main() {
  await verifyConfigHappyPath();
  await verifyConfigValidation();
  console.log('Config verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
