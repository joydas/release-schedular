'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { WorkbookService, WorkbookConflictError } = require('../src/services/WorkbookService');
const { CSVImportService, CSVImportValidationError } = require('../src/services/CSVImportService');

const FEATURE_STORY_MAPPING = {
  'feature.feature_id': 'feature_id',
  'feature.release_id': 'release_id',
  'feature.feature_name': 'feature_name',
  'feature.priority': 'feature_priority',
  'feature.input_order': 'feature_input_order',
  'feature.team_id': 'team_id',
  'feature.status': 'feature_status',
  'feature.build_estimate_current': 'feature_build_estimate_current',
  'feature.build_original_estimate': 'feature_build_original_estimate',
  'feature.build_actual_spent': 'feature_build_actual_spent',
  'feature.st_estimate_current': 'feature_st_estimate_current',
  'feature.st_original_estimate': 'feature_st_original_estimate',
  'feature.st_actual_spent': 'feature_st_actual_spent',
  'story.story_id': 'story_id',
  'story.feature_id': 'story_feature_id',
  'story.story_name': 'story_name',
  'story.input_order': 'story_input_order',
  'story.status': 'story_status',
  'story.build_estimate_current': 'story_build_estimate_current',
  'story.build_original_estimate': 'story_build_original_estimate',
  'story.build_actual_spent': 'story_build_actual_spent',
  'story.st_estimate_current': 'story_st_estimate_current',
  'story.st_original_estimate': 'story_st_original_estimate',
  'story.st_actual_spent': 'story_st_actual_spent',
};

async function withTempDirectory(prefix, callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function createBaselineWorkbook(workbookPath) {
  const service = await WorkbookService.create({ workbookPath });
  await service.upsertTeam(
    { team_id: 'TEAM-001', team_name: 'Platform', status: 'Active' },
    { expectedVersion: await service.getWorkbookVersion() }
  );
  await service.upsertRelease(
    {
      release_id: 'REL-2026-Q3',
      release_name: 'Q3 2026',
      status: 'Planned',
      start_date: new Date('2026-07-01'),
      end_date: new Date('2026-09-30'),
      target_date: new Date('2026-08-15'),
      priority_order: 1,
    },
    { expectedVersion: await service.getWorkbookVersion() }
  );
  await service.upsertFeature(
    {
      feature_id: 'FEAT-EXISTING',
      release_id: 'REL-2026-Q3',
      feature_name: 'Existing Feature',
      priority: 2,
      input_order: 2,
      team_id: 'TEAM-001',
      status: 'Backlog',
      build_estimate_current: 5,
      build_original_estimate: 5,
      build_actual_spent: 0,
      st_estimate_current: 2,
      st_original_estimate: 2,
      st_actual_spent: 0,
    },
    { expectedVersion: await service.getWorkbookVersion() }
  );
  return service;
}

async function verifyPreviewAndNoMutation() {
  await withTempDirectory('release-scheduler-csv-preview-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'import.xlsx');
    await createBaselineWorkbook(workbookPath);

    const csvText = [
      'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
      'FEAT-1001,REL-2026-Q3,Imported Feature 1,1,1,TEAM-001,Backlog,8,3,STORY-1001,FEAT-1001,Imported Story 1,1,Backlog,9,4',
      'FEAT-1002,REL-2026-Q3,Imported Feature 2,2,2,TEAM-001,Backlog,6,2,STORY-1002,FEAT-1002,Imported Story 2,2,Backlog,7,5',
    ].join('\n');

    const originalBytes = await fs.readFile(workbookPath);
    const importService = new CSVImportService({ workbookPath });
    const preview = await importService.previewImport({
      csvText,
      mapping: FEATURE_STORY_MAPPING,
    });

    if (preview.rowCount !== 2) {
      throw new Error(`Expected preview row count 2, found ${preview.rowCount}.`);
    }
    if (!preview.records || preview.records.length !== 2) {
      throw new Error('Expected preview records to include both rows.');
    }
    if (preview.warnings && preview.warnings.length > 0) {
      throw new Error(`Unexpected preview warnings: ${JSON.stringify(preview.warnings)}`);
    }

    const workbookBytesAfterPreview = await fs.readFile(workbookPath);
    if (!workbookBytesAfterPreview.equals(originalBytes)) {
      throw new Error('Preview should not mutate the workbook file.');
    }
  });
}

async function verifyValidConfirmationImport() {
  await withTempDirectory('release-scheduler-csv-confirm-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'import.xlsx');
    const service = await createBaselineWorkbook(workbookPath);
    const importService = new CSVImportService({ workbookPath });
    const csvText = [
      'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
      'FEAT-2001,REL-2026-Q3,New Feature One,1,1,TEAM-001,Backlog,8,3,STORY-2001,FEAT-2001,New Story One,1,Backlog,9,4',
      'FEAT-2002,REL-2026-Q3,New Feature Two,2,2,TEAM-001,Backlog,6,2,STORY-2002,FEAT-2002,New Story Two,2,Backlog,7,5',
    ].join('\n');

    const expectedVersion = await service.getWorkbookVersion();
    const preview = await importService.previewImport({
      csvText,
      mapping: FEATURE_STORY_MAPPING,
    });

    const result = await importService.confirmImport({
      csvText,
      mapping: preview.mapping,
      confirmed: true,
      mode: 'add',
      workbookVersion: expectedVersion,
    });

    if (
      !result ||
      !result.imported ||
      !result.imported.features ||
      result.imported.features.length !== 2
    ) {
      throw new Error('Expected two imported features after confirmation.');
    }
    if (!result.imported.stories || result.imported.stories.length !== 2) {
      throw new Error('Expected two imported stories after confirmation.');
    }

    const reloaded = await WorkbookService.create({ workbookPath });

    if (!reloaded.getFeature('FEAT-2001')) {
      throw new Error('Confirmed import should persist Feature 2001 into the workbook.');
    }
    if (!reloaded.getUserStory('STORY-2001')) {
      throw new Error('Confirmed import should persist Story 2001 into the workbook.');
    }

    const importedFeature = reloaded.getFeature('FEAT-2001');
    const importedStory = reloaded.getUserStory('STORY-2001');
    if (Number(importedFeature.build_estimate_current) !== 8) {
      throw new Error('Feature current estimate should persist independently.');
    }
    if (Number(importedStory.build_estimate_current) !== 9) {
      throw new Error('Story current estimate should persist independently.');
    }
    if (Number(importedFeature.build_original_estimate) !== 8) {
      throw new Error('Original estimate should initialize from the feature current estimate.');
    }
    if (Number(importedStory.build_original_estimate) !== 9) {
      throw new Error('Story original estimate should initialize from the story current estimate.');
    }
    if (Number(importedFeature.build_actual_spent) !== 0) {
      throw new Error('Imported features should start with zero actual spent.');
    }
    if (Number(importedStory.build_actual_spent) !== 0) {
      throw new Error('Imported stories should start with zero actual spent.');
    }
  });
}

async function verifySeparateFeatureAndStoryEstimates() {
  await withTempDirectory('release-scheduler-csv-estimates-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'estimates.xlsx');
    await createBaselineWorkbook(workbookPath);

    const csvText = [
      'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
      'FEAT-9001,REL-2026-Q3,Feature With Different Effort,1,1,TEAM-001,Backlog,12,8,STORY-9001,FEAT-9001,Story With Different Effort,1,Backlog,7,4',
    ].join('\n');

    const importService = new CSVImportService({ workbookPath });
    const preview = await importService.previewImport({
      csvText,
      mapping: FEATURE_STORY_MAPPING,
    });
    if (preview.features[0].build_estimate_current !== 12) {
      throw new Error('Feature current Build estimate did not map correctly.');
    }
    if (preview.stories[0].build_estimate_current !== 7) {
      throw new Error('Story current Build estimate did not map correctly.');
    }
    if (preview.features[0].st_estimate_current !== 8) {
      throw new Error('Feature current ST estimate did not map correctly.');
    }
    if (preview.stories[0].st_estimate_current !== 4) {
      throw new Error('Story current ST estimate did not map correctly.');
    }

    const result = await importService.confirmImport({
      csvText,
      mapping: preview.mapping,
      confirmed: true,
      mode: 'add',
      workbookVersion: await importService
        .loadWorkbook({ createIfMissing: false })
        .then((service) => (service ? service.getWorkbookVersion() : 0)),
    });

    if (Number(result.imported.features[0].build_estimate_current) !== 12) {
      throw new Error('Feature Build estimate was not persisted independently.');
    }
    if (Number(result.imported.stories[0].build_estimate_current) !== 7) {
      throw new Error('Story Build estimate was not persisted independently.');
    }
    if (Number(result.imported.features[0].st_estimate_current) !== 8) {
      throw new Error('Feature ST estimate was not persisted independently.');
    }
    if (Number(result.imported.stories[0].st_estimate_current) !== 4) {
      throw new Error('Story ST estimate was not persisted independently.');
    }
  });
}

async function verifyInvalidRowsAndMissingFeatureReferences() {
  await withTempDirectory('release-scheduler-csv-invalid-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'invalid.xlsx');
    await createBaselineWorkbook(workbookPath);

    const csvText = [
      'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
      'FEAT-3001,REL-2026-Q3,Missing Feature,1,1,TEAM-001,Backlog,8,3,STORY-3001,FEAT-3001,Story for valid feature,1,Backlog,9,4',
      'FEAT-3002,REL-DOES-NOT-EXIST,Also Invalid,1,2,TEAM-001,Backlog,8,3,STORY-3002,FEAT-3002,Story on bad release,2,Backlog,10,5',
    ].join('\n');

    const importService = new CSVImportService({ workbookPath });
    try {
      await importService.previewImport({
        csvText,
        mapping: FEATURE_STORY_MAPPING,
      });
      throw new Error('Expected invalid preview rows to fail.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
      const messageText = String(error.message).toLowerCase();
      if (!messageText.includes('row 2') && !messageText.includes('row 3')) {
        throw new Error(`Expected row-level validation detail, got: ${error.message}`);
      }
    }
  });
}

async function verifyDuplicateAndExistingConflictModes() {
  await withTempDirectory('release-scheduler-csv-conflict-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'conflict.xlsx');
    const service = await createBaselineWorkbook(workbookPath);
    const importService = new CSVImportService({ workbookPath });

    const csvText = [
      'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
      'FEAT-EXISTING,REL-2026-Q3,Existing Feature Replacement,1,1,TEAM-001,Backlog,9,1,STORY-EXISTING,FEAT-EXISTING,Existing Story Replacement,1,Backlog,10,2',
    ].join('\n');

    try {
      await importService.confirmImport({
        csvText,
        mapping: FEATURE_STORY_MAPPING,
        confirmed: true,
        mode: 'add',
        workbookVersion: await service.getWorkbookVersion(),
      });
      throw new Error('Expected add-mode to reject duplicate feature IDs.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }

    const replaceResult = await importService.confirmImport({
      csvText,
      mapping: FEATURE_STORY_MAPPING,
      confirmed: true,
      mode: 'replace',
      workbookVersion: await service.getWorkbookVersion(),
    });

    if (!replaceResult || !replaceResult.imported || !replaceResult.imported.features.length) {
      throw new Error('Expected replace-mode import to accept replacement rows.');
    }
  });
}

async function verifyWorkbookVersionRequirements() {
  await withTempDirectory('release-scheduler-csv-version-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'version.xlsx');
    const service = await createBaselineWorkbook(workbookPath);
    const importService = new CSVImportService({ workbookPath });
    const csvText = [
      'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
      'FEAT-4001,REL-2026-Q3,Versioned Feature,1,1,TEAM-001,Backlog,4,2,STORY-4001,FEAT-4001,Versioned Story,1,Backlog,5,3',
    ].join('\n');

    for (const invalidVersion of [undefined, '', '   ', 'abc', '-1', '1.5']) {
      try {
        await importService.confirmImport({
          csvText,
          mapping: FEATURE_STORY_MAPPING,
          confirmed: true,
          mode: 'add',
          workbookVersion: invalidVersion,
        });
        throw new Error(
          `Expected invalid workbook version ${String(invalidVersion)} to be rejected.`
        );
      } catch (error) {
        if (!(error instanceof CSVImportValidationError)) {
          throw error;
        }
      }
    }

    const staleVersion = await service.getWorkbookVersion();
    await service.upsertTeam(
      { team_id: 'TEAM-NEW', team_name: 'New Team', status: 'Active' },
      { expectedVersion: await service.getWorkbookVersion() }
    );

    const originalBytes = await fs.readFile(workbookPath);
    const reloadedBefore = await WorkbookService.create({ workbookPath });
    const beforeFeatureCount = reloadedBefore.listFeatures().length;
    const beforeStoryCount = reloadedBefore.listUserStories().length;

    try {
      await importService.confirmImport({
        csvText,
        mapping: FEATURE_STORY_MAPPING,
        confirmed: true,
        mode: 'add',
        workbookVersion: staleVersion,
      });
      throw new Error('Expected stale workbook version to be rejected.');
    } catch (error) {
      if (!(error instanceof WorkbookConflictError)) {
        throw error;
      }
    }

    const workbookBytesAfterStaleAttempt = await fs.readFile(workbookPath);
    if (!workbookBytesAfterStaleAttempt.equals(originalBytes)) {
      throw new Error('Stale-version rejection should leave the workbook bytes unchanged.');
    }

    const reloadedAfter = await WorkbookService.create({ workbookPath });
    if (reloadedAfter.listFeatures().length !== beforeFeatureCount) {
      throw new Error('Stale-version rejection should leave features unchanged.');
    }
    if (reloadedAfter.listUserStories().length !== beforeStoryCount) {
      throw new Error('Stale-version rejection should leave stories unchanged.');
    }

    const currentVersion = await service.getWorkbookVersion();
    const validResult = await importService.confirmImport({
      csvText,
      mapping: FEATURE_STORY_MAPPING,
      confirmed: true,
      mode: 'add',
      workbookVersion: currentVersion,
    });

    if (!validResult || !validResult.imported || !validResult.imported.features.length) {
      throw new Error('A current workbook version should allow a confirmed import.');
    }
  });
}

async function verifyMalformedCsvAndOversizedFiles() {
  await withTempDirectory('release-scheduler-csv-malformed-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'malformed.xlsx');
    await createBaselineWorkbook(workbookPath);
    const importService = new CSVImportService({ workbookPath, maxSizeBytes: 32 });

    try {
      await importService.previewImport({
        csvText: 'feature_id,release_id\n"unterminated',
        mapping: {
          'feature.feature_id': 'feature_id',
          'feature.release_id': 'release_id',
        },
      });
      throw new Error('Expected malformed CSV to fail.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }

    try {
      await importService.previewImport({
        csvText: 'feature_id,release_id\nFEAT-5001,REL-2026-Q3\n',
        mapping: {
          'feature.feature_id': 'feature_id',
          'feature.release_id': 'release_id',
        },
        maxSizeBytes: 10,
      });
      throw new Error('Expected oversized CSV to fail.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }
  });
}

async function verifyRowsWithMissingOrExtraColumnsAreRejected() {
  await withTempDirectory('release-scheduler-csv-column-count-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'column-count.xlsx');
    await createBaselineWorkbook(workbookPath);
    const importService = new CSVImportService({ workbookPath });

    try {
      await importService.previewImport({
        csvText: [
          'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
          'FEAT-9991,REL-2026-Q3,Incomplete Row,1,1,TEAM-001,Backlog,8,3,STORY-9991,FEAT-9991,Story,1,Backlog,7',
        ].join('\n'),
        mapping: FEATURE_STORY_MAPPING,
      });
      throw new Error('Expected a row with too few columns to be rejected.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }

    try {
      await importService.previewImport({
        csvText: [
          'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current,extra',
          'FEAT-9992,REL-2026-Q3,Extra Column Row,1,1,TEAM-001,Backlog,8,3,STORY-9992,FEAT-9992,Story,1,Backlog,7,4,EXTRA,EXTRA2',
        ].join('\n'),
        mapping: FEATURE_STORY_MAPPING,
      });
      throw new Error('Expected a row with too many columns to be rejected.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }
  });
}

async function verifyDuplicateHeadersAreRejected() {
  await withTempDirectory('release-scheduler-csv-duplicate-header-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'duplicate-header.xlsx');
    await createBaselineWorkbook(workbookPath);
    const importService = new CSVImportService({ workbookPath });

    try {
      await importService.previewImport({
        csvText: [
          'feature_id,feature_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_name',
          'FEAT-8881,FEAT-8881,Feature,1,1,TEAM-001,Backlog,8,3,STORY-8881,Story',
        ].join('\n'),
        mapping: {
          'feature.feature_id': 'feature_id',
          'feature.feature_name': 'feature_name',
          'feature.priority': 'feature_priority',
          'feature.input_order': 'feature_input_order',
          'feature.team_id': 'team_id',
          'feature.status': 'feature_status',
          'feature.build_estimate_current': 'feature_build_estimate_current',
          'feature.st_estimate_current': 'feature_st_estimate_current',
          'story.story_id': 'story_id',
          'story.story_name': 'story_name',
        },
      });
      throw new Error('Expected duplicate headers to be rejected.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }
  });
}

async function verifyFailedImportLeavesWorkbookUnchanged() {
  await withTempDirectory('release-scheduler-csv-no-mutation-on-fail-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'unchanged.xlsx');
    const service = await createBaselineWorkbook(workbookPath);
    const originalBytes = await fs.readFile(workbookPath);
    const importService = new CSVImportService({ workbookPath });

    try {
      await importService.confirmImport({
        csvText: [
          'feature_id,release_id,feature_name,feature_priority,feature_input_order,team_id,feature_status,feature_build_estimate_current,feature_st_estimate_current,story_id,story_feature_id,story_name,story_input_order,story_status,story_build_estimate_current,story_st_estimate_current',
          'FEAT-7771,REL-2026-Q3,First Import,1,1,TEAM-001,Backlog,8,3,STORY-7771,FEAT-7771,Story One,1,Backlog,9,4',
          'FEAT-7771,REL-2026-Q3,Duplicate Feature,1,1,TEAM-001,Backlog,7,2,STORY-7772,FEAT-7771,Story Two,2,Backlog,8,3',
        ].join('\n'),
        mapping: FEATURE_STORY_MAPPING,
        confirmed: true,
        mode: 'add',
        workbookVersion: await service.getWorkbookVersion(),
      });
      throw new Error('Expected the failed import to reject the duplicate feature ID.');
    } catch (error) {
      if (!(error instanceof CSVImportValidationError)) {
        throw error;
      }
    }

    const workbookBytesAfterFailedImport = await fs.readFile(workbookPath);
    if (!workbookBytesAfterFailedImport.equals(originalBytes)) {
      throw new Error('Failed import should leave the workbook untouched.');
    }
  });
}

async function main() {
  await verifyPreviewAndNoMutation();
  await verifyValidConfirmationImport();
  await verifySeparateFeatureAndStoryEstimates();
  await verifyInvalidRowsAndMissingFeatureReferences();
  await verifyDuplicateAndExistingConflictModes();
  await verifyWorkbookVersionRequirements();
  await verifyMalformedCsvAndOversizedFiles();
  await verifyRowsWithMissingOrExtraColumnsAreRejected();
  await verifyDuplicateHeadersAreRejected();
  await verifyFailedImportLeavesWorkbookUnchanged();
  console.log('CSV import verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
