'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkbookService } = require('../src/services/WorkbookService');

const MAPPING = {
  'feature.feature_id': 'feature_id',
  'feature.release_id': 'release_id',
  'feature.feature_name': 'feature_name',
  'feature.priority': 'priority',
  'feature.input_order': 'input_order',
  'feature.team_id': 'team_id',
  'feature.status': 'status',
  'feature.build_estimate_current': 'build_estimate_current',
  'feature.st_estimate_current': 'st_estimate_current',
  'story.story_id': 'story_id',
  'story.feature_id': 'story_feature_id',
  'story.story_name': 'story_name',
  'story.input_order': 'story_order',
  'story.status': 'story_status',
  'story.build_estimate_current': 'story_build_estimate_current',
  'story.st_estimate_current': 'story_st_estimate_current',
};

async function withTempWorkbook(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-scheduler-csv-api-'));
  const workbookPath = path.join(tempRoot, 'api.xlsx');
  const previousPath = process.env.WORKBOOK_PATH;
  try {
    await callback(workbookPath);
  } finally {
    if (previousPath === undefined) delete process.env.WORKBOOK_PATH;
    else process.env.WORKBOOK_PATH = previousPath;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function startApp(workbookPath) {
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

async function sendCsv(baseUrl, endpoint, csvText, fields = {}) {
  const body = new FormData();
  body.append('file', new Blob([csvText], { type: 'text/csv' }), 'input.csv');
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', body });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, got ${response.status}: ${JSON.stringify(response.json)}`
    );
  }
}

function csvRow(featureId, featureName, storyId, storyName) {
  return `${featureId},REL-API,${featureName},1,1,TEAM-API,Backlog,8,3,${storyId},${featureId},${storyName},1,Backlog,5,2`;
}

function csvText(...rows) {
  return [
    'feature_id,release_id,feature_name,priority,input_order,team_id,status,build_estimate_current,st_estimate_current,story_id,story_feature_id,story_name,story_order,story_status,story_build_estimate_current,story_st_estimate_current',
    ...rows,
  ].join('\n');
}

async function verifyImportApi() {
  await withTempWorkbook(async (workbookPath) => {
    const service = await WorkbookService.create({ workbookPath });
    await service.upsertTeam(
      { team_id: 'TEAM-API', team_name: 'Import Team', status: 'Active' },
      { expectedVersion: await service.getWorkbookVersion() }
    );
    await service.upsertRelease(
      { release_id: 'REL-API', release_name: 'Import Release', status: 'Planned' },
      { expectedVersion: await service.getWorkbookVersion() }
    );

    const { baseUrl, close } = await startApp(workbookPath);
    try {
      const validCsv = csvText(
        csvRow('FEAT-API-1', 'Imported Feature', 'STORY-API-1', 'Imported Story')
      );
      let preview = await sendCsv(baseUrl, '/api/import/csv/preview', validCsv, {
        mapping: MAPPING,
      });
      assertStatus(preview, 200, 'valid preview');
      if (
        preview.json.rowCount !== 1 ||
        preview.json.features?.[0]?.feature_id !== 'FEAT-API-1' ||
        preview.json.stories?.[0]?.story_id !== 'STORY-API-1' ||
        !Number.isInteger(preview.json.workbookVersion)
      ) {
        throw new Error('Preview API did not return the expected records and workbook version.');
      }

      const noCommit = await WorkbookService.create({ workbookPath });
      if (noCommit.getFeature('FEAT-API-1'))
        throw new Error('Preview unexpectedly mutated the workbook.');

      const noExplicitConfirm = await sendCsv(baseUrl, '/api/import/csv/confirm', validCsv, {
        mapping: MAPPING,
        mode: 'add',
        workbookVersion: preview.json.workbookVersion,
      });
      assertStatus(noExplicitConfirm, 400, 'confirmation requires explicit confirmation');

      const missingHeader = await sendCsv(
        baseUrl,
        '/api/import/csv/preview',
        'feature_id,release_id\nFEAT-BAD,REL-API',
        { mapping: { 'feature.feature_id': 'feature_id', 'feature.release_id': 'release_id' } }
      );
      assertStatus(missingHeader, 400, 'required feature name mapping missing');

      const malformedRows = await sendCsv(
        baseUrl,
        '/api/import/csv/preview',
        'feature_id,release_id,feature_name\nFEAT-BAD,REL-API,Only three,extra',
        {
          mapping: {
            'feature.feature_id': 'feature_id',
            'feature.release_id': 'release_id',
            'feature.feature_name': 'feature_name',
          },
        }
      );
      assertStatus(malformedRows, 400, 'malformed row');

      const added = await sendCsv(baseUrl, '/api/import/csv/confirm', validCsv, {
        mapping: MAPPING,
        mode: 'add',
        confirmed: true,
        workbookVersion: preview.json.workbookVersion,
      });
      assertStatus(added, 200, 'confirmed add import');
      if (
        added.json.confirmed !== true ||
        added.json.imported?.features?.length !== 1 ||
        added.json.imported?.stories?.length !== 1
      ) {
        throw new Error('Confirm API did not return actual imported feature and story records.');
      }

      const duplicateAddPreview = await sendCsv(baseUrl, '/api/import/csv/preview', validCsv, {
        mapping: MAPPING,
      });
      assertStatus(duplicateAddPreview, 200, 'duplicate ID preview');
      const duplicateAdd = await sendCsv(baseUrl, '/api/import/csv/confirm', validCsv, {
        mapping: MAPPING,
        mode: 'add',
        confirmed: true,
        workbookVersion: duplicateAddPreview.json.workbookVersion,
      });
      assertStatus(duplicateAdd, 400, 'add rejects existing IDs');

      const replacementCsv = csvText(
        csvRow('FEAT-API-1', 'Replacement Feature', 'STORY-API-1', 'Replacement Story')
      );
      const replacementPreview = await sendCsv(baseUrl, '/api/import/csv/preview', replacementCsv, {
        mapping: MAPPING,
      });
      assertStatus(replacementPreview, 200, 'replace preview');
      const replaced = await sendCsv(baseUrl, '/api/import/csv/confirm', replacementCsv, {
        mapping: MAPPING,
        mode: 'replace',
        confirmed: true,
        workbookVersion: replacementPreview.json.workbookVersion,
      });
      assertStatus(replaced, 200, 'confirmed replace import');
      const reloaded = await WorkbookService.create({ workbookPath });
      if (reloaded.getFeature('FEAT-API-1')?.feature_name !== 'Replacement Feature') {
        throw new Error('Replace import did not overwrite the matching feature.');
      }
      if (reloaded.getUserStory('STORY-API-1')?.story_name !== 'Replacement Story') {
        throw new Error('Replace import did not overwrite the matching story.');
      }

      const staleCsv = csvText(csvRow('FEAT-STALE', 'Stale Preview', 'STORY-STALE', 'Stale Story'));
      const stalePreview = await sendCsv(baseUrl, '/api/import/csv/preview', staleCsv, {
        mapping: MAPPING,
      });
      assertStatus(stalePreview, 200, 'stale setup preview');
      const current = await WorkbookService.create({ workbookPath });
      await current.upsertTeam(
        { team_id: 'TEAM-OTHER', team_name: 'Concurrent Team', status: 'Active' },
        { expectedVersion: await current.getWorkbookVersion() }
      );
      const staleConfirm = await sendCsv(baseUrl, '/api/import/csv/confirm', staleCsv, {
        mapping: MAPPING,
        mode: 'add',
        confirmed: true,
        workbookVersion: stalePreview.json.workbookVersion,
      });
      assertStatus(staleConfirm, 409, 'stale preview confirmation');
      const finalWorkbook = await WorkbookService.create({ workbookPath });
      if (finalWorkbook.getFeature('FEAT-STALE'))
        throw new Error('Stale confirmation imported records.');
    } finally {
      await close();
    }
  });
}

verifyImportApi()
  .then(() => console.log('CSV import API verification passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
