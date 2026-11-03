/* global process, console */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { getCsvTemplate, TEMPLATE_FIELDS } from '../src/csvTemplates.js';

const require = createRequire(import.meta.url);
const { WorkbookService } = require('../../server/src/services/WorkbookService.js');
const { CSVImportService } = require('../../server/src/services/CSVImportService.js');

function mappingFor(entity, headers) {
  return Object.fromEntries(
    TEMPLATE_FIELDS[entity].map((field, index) => [`${entity}.${field}`, headers[index]])
  );
}

async function verifyTemplatesParseThroughImporter() {
  const tempRoot = await mkdtemp(path.join(process.cwd(), '.tmp-csv-template-'));
  const workbookPath = path.join(tempRoot, 'template-test.xlsx');
  try {
    const workbook = await WorkbookService.create({ workbookPath });
    await workbook.upsertFeature(
      {
        feature_id: 'FEATURE-TEMPLATE-PARENT',
        release_id: '',
        feature_name: 'Parent feature',
        priority: 1,
        input_order: 1,
        team_id: '',
        status: 'Backlog',
        build_estimate_current: 1,
        build_original_estimate: 1,
        build_actual_spent: 0,
        st_estimate_current: 0,
        st_original_estimate: 0,
        st_actual_spent: 0,
      },
      { expectedVersion: await workbook.getWorkbookVersion() }
    );

    const importer = new CSVImportService({ workbookPath });
    const featureTemplate = getCsvTemplate('feature');
    const featurePreview = await importer.previewImport({
      csvText: featureTemplate.csv,
      mapping: mappingFor('feature', featureTemplate.headers),
    });
    assert.equal(featurePreview.rowCount, 1);
    assert.equal(featurePreview.features[0].release_id, '');
    assert.equal(featurePreview.features[0].feature_name, 'Sample feature, replace this row');

    const storyTemplate = getCsvTemplate('story', 'FEATURE-TEMPLATE-PARENT');
    const storyPreview = await importer.previewImport({
      csvText: storyTemplate.csv,
      mapping: mappingFor('story', storyTemplate.headers),
    });
    assert.equal(storyPreview.rowCount, 1);
    assert.equal(storyPreview.stories[0].feature_id, 'FEATURE-TEMPLATE-PARENT');
    assert.equal(storyPreview.stories[0].story_name, 'Sample story, replace this row');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function verifyTemplateShapeAndEscaping() {
  const feature = getCsvTemplate('feature', 'REL-1');
  const story = getCsvTemplate('story', 'FEATURE-1');
  assert.equal(feature.filename, 'feature-import-template.csv');
  assert.equal(story.filename, 'user-story-import-template.csv');
  assert.deepEqual(
    feature.headers,
    TEMPLATE_FIELDS.feature.map((field) => `feature_${field}`)
  );
  assert.deepEqual(
    story.headers,
    TEMPLATE_FIELDS.story.map((field) => `story_${field}`)
  );
  assert.ok(feature.csv.startsWith('\uFEFF'));
  assert.ok(feature.csv.includes('"Sample feature, replace this row"'));
  assert.ok(story.csv.includes('"Sample story, replace this row"'));
  assert.ok(feature.csv.includes('\r\n'));
  assert.equal(getCsvTemplate('', ''), null);
  assert.throws(() => getCsvTemplate('story', ''), /existing feature is required/i);
}

verifyTemplateShapeAndEscaping();
await verifyTemplatesParseThroughImporter();
console.log('CSV template verification passed.');
