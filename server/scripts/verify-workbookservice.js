'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const {
  WorkbookService,
  WorkbookConflictError,
  WorkbookValidationError,
} = require('../src/services/WorkbookService');
const { SHEET_NAMES } = require('../src/workbook/workbookSchema');

async function withTempDirectory(prefix, callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function verifyBlankWorkbook() {
  await withTempDirectory('release-scheduler-workbook-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'blank-workbook.xlsx');
    const service = await WorkbookService.create({ workbookPath });
    const actualSheets = service.getWorksheetNames();

    if (JSON.stringify(actualSheets) !== JSON.stringify(SHEET_NAMES)) {
      throw new Error(
        `Expected sheet order ${SHEET_NAMES.join(', ')}, found ${actualSheets.join(', ') || '(none)'}`
      );
    }

    if (
      !(await fs
        .access(workbookPath)
        .then(() => true)
        .catch(() => false))
    ) {
      throw new Error('Blank workbook was not created on first initialization.');
    }
  });
}

async function verifyRoundTripAndValidation() {
  await withTempDirectory('release-scheduler-roundtrip-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'roundtrip.xlsx');
    const service = await WorkbookService.create({ workbookPath });

    const team = {
      team_id: 'TEAM-0001',
      team_name: 'Platform',
      status: 'Active',
      notes: 'Primary build team',
    };

    const release = {
      release_id: 'REL-2026-Q3',
      release_name: 'Q3 2026',
      status: 'Planned',
      start_date: new Date('2026-07-01'),
      end_date: new Date('2026-09-30'),
      target_date: new Date('2026-08-15'),
      priority_order: 1,
    };

    const feature = {
      feature_id: 'FEAT-0001',
      release_id: 'REL-2026-Q3',
      feature_name: 'Release scheduler basics',
      priority: 1,
      input_order: 1,
      team_id: 'TEAM-0001',
      status: 'Backlog',
      build_estimate_current: 10,
      build_original_estimate: 10,
      build_actual_spent: 0,
      st_estimate_current: 6,
      st_original_estimate: 6,
      st_actual_spent: 0,
    };

    const story = {
      story_id: 'STORY-0001',
      feature_id: 'FEAT-0001',
      story_name: 'Workbook scaffolding',
      input_order: 1,
      status: 'Backlog',
      build_estimate_current: 5,
      build_original_estimate: 5,
      build_actual_spent: 0,
      st_estimate_current: 2,
      st_original_estimate: 2,
      st_actual_spent: 0,
    };

    const capacity = {
      team_id: 'TEAM-0001',
      release_id: 'REL-2026-Q3',
      build_capacity: 40,
      st_capacity: 25,
      capacity_source: 'Manual',
    };

    const config = {
      config_key: 'SPRINT_CADENCE',
      config_value: '2x15+5',
      value_type: 'String',
      description: 'Sprint cadence config',
    };

    const versionBefore = await service.getWorkbookVersion();
    await service.upsertTeam(team, { expectedVersion: versionBefore });
    await service.upsertRelease(release, { expectedVersion: await service.getWorkbookVersion() });
    await service.upsertFeature(feature, { expectedVersion: await service.getWorkbookVersion() });
    await service.upsertUserStory(story, { expectedVersion: await service.getWorkbookVersion() });
    await service.upsertTeamReleaseCapacity(capacity, {
      expectedVersion: await service.getWorkbookVersion(),
    });
    await service.upsertConfigValue(config, {
      expectedVersion: await service.getWorkbookVersion(),
    });

    const reloaded = await WorkbookService.create({ workbookPath });

    if (!reloaded.getTeam('TEAM-0001')) {
      throw new Error('Team did not persist and reload correctly.');
    }

    if (!reloaded.getRelease('REL-2026-Q3')) {
      throw new Error('Release did not persist and reload correctly.');
    }

    if (!reloaded.getFeature('FEAT-0001')) {
      throw new Error('Feature did not persist and reload correctly.');
    }

    if (!reloaded.getUserStory('STORY-0001')) {
      throw new Error('User story did not persist and reload correctly.');
    }

    if (!reloaded.getTeamReleaseCapacity('TEAM-0001', 'REL-2026-Q3')) {
      throw new Error('Team/release capacity did not persist and reload correctly.');
    }

    if (!reloaded.getConfigValue('SPRINT_CADENCE')) {
      throw new Error('Config value did not persist and reload correctly.');
    }

    try {
      await service.upsertFeature(
        {
          ...feature,
          feature_id: 'FEAT-0002',
          release_id: 'REL-ERROR',
          feature_name: 'Broken feature',
          priority: 1,
          input_order: 1,
          team_id: 'TEAM-0001',
          status: 'Backlog',
          build_estimate_current: Number.POSITIVE_INFINITY,
          build_original_estimate: 1,
          build_actual_spent: 0,
          st_estimate_current: 0,
          st_original_estimate: 0,
          st_actual_spent: 0,
        },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      throw new Error('Expected invalid numeric value to be rejected.');
    } catch (error) {
      if (!(error instanceof WorkbookValidationError)) {
        throw error;
      }
    }

    try {
      await service.upsertTeam(
        { team_id: 'TEAM-INVALID', team_name: '  ', status: 'Active' },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      throw new Error('Expected empty string validation failure.');
    } catch (error) {
      if (!(error instanceof WorkbookValidationError)) {
        throw error;
      }
    }
  });
}

async function verifyConcurrencyAndStaleVersion() {
  await withTempDirectory('release-scheduler-concurrency-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'concurrency.xlsx');
    const service = await WorkbookService.create({ workbookPath });

    const baseVersion = await service.getWorkbookVersion();
    const mutations = [
      service.upsertTeam(
        { team_id: 'TEAM-1001', team_name: 'Alpha', status: 'Active' },
        {
          expectedVersion: baseVersion,
        }
      ),
      service.upsertTeam(
        { team_id: 'TEAM-1002', team_name: 'Beta', status: 'Active' },
        {
          expectedVersion: baseVersion,
        }
      ),
      service.upsertTeam(
        { team_id: 'TEAM-1003', team_name: 'Gamma', status: 'Active' },
        {
          expectedVersion: baseVersion,
        }
      ),
    ];

    const results = await Promise.allSettled(mutations);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const conflicts = results.filter(
      (result) => result.status === 'rejected' && result.reason instanceof WorkbookConflictError
    );

    if (fulfilled.length !== 1) {
      throw new Error(`Expected one successful concurrent mutation, found ${fulfilled.length}.`);
    }

    if (conflicts.length !== 2) {
      throw new Error(`Expected two stale-version conflicts, found ${conflicts.length}.`);
    }

    const teams = service.listTeams();
    if (teams.length !== 1) {
      throw new Error(
        `Expected one persisted team after concurrent writes, found ${teams.length}.`
      );
    }

    if (teams[0].team_id !== 'TEAM-1001') {
      throw new Error(`Unexpected surviving team: ${JSON.stringify(teams[0])}`);
    }

    const staleError = await service
      .upsertTeam(
        { team_id: 'TEAM-9999', team_name: 'Stale', status: 'Active' },
        {
          expectedVersion: baseVersion,
        }
      )
      .then(() => null)
      .catch((error) => error);

    if (!(staleError instanceof WorkbookConflictError)) {
      throw new Error('Expected stale-version rejection after concurrent mutation batch.');
    }
  });
}

async function verifyIntegerValidationAndPercentages() {
  await withTempDirectory('release-scheduler-validation-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'validation.xlsx');
    const service = await WorkbookService.create({ workbookPath });

    await service.upsertTeam(
      { team_id: 'TEAM-VALID', team_name: 'Validation Team', status: 'Active' },
      { expectedVersion: await service.getWorkbookVersion() }
    );
    await service.upsertRelease(
      {
        release_id: 'REL-2026-Q3',
        release_name: 'Validation Release',
        status: 'Planned',
        start_date: new Date('2026-07-01'),
        end_date: new Date('2026-09-30'),
        target_date: new Date('2026-08-15'),
        priority_order: 1,
      },
      { expectedVersion: await service.getWorkbookVersion() }
    );

    const validFeature = {
      feature_id: 'FEAT-VALID-BASE',
      release_id: 'REL-2026-Q3',
      feature_name: 'Validation Feature',
      priority: 1,
      input_order: 1,
      team_id: 'TEAM-VALID',
      status: 'Backlog',
      build_estimate_current: 5,
      build_original_estimate: 5,
      build_actual_spent: 0,
      st_estimate_current: 2,
      st_original_estimate: 2,
      st_actual_spent: 0,
    };

    const invalidIntegerValues = [
      null,
      undefined,
      '',
      '   ',
      '3.5',
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (const value of invalidIntegerValues) {
      try {
        await service.upsertFeature(
          {
            ...validFeature,
            feature_id: `FEAT-INVALID-${String(value).replace(/[^a-z0-9]/gi, 'X') || 'EMPTY'}`,
            priority: value,
          },
          { expectedVersion: await service.getWorkbookVersion() }
        );
        throw new Error(`Expected invalid integer value ${JSON.stringify(value)} to be rejected.`);
      } catch (error) {
        if (!(error instanceof WorkbookValidationError)) {
          throw error;
        }
      }
    }

    const validFeatureResult = await service.upsertFeature(
      {
        ...validFeature,
        feature_id: 'FEAT-VALID-OK',
        priority: 0,
      },
      { expectedVersion: await service.getWorkbookVersion() }
    );

    if (!validFeatureResult || validFeatureResult.feature_id !== 'FEAT-VALID-OK') {
      throw new Error('Expected valid integer input to still be accepted.');
    }

    const invalidPercentCases = [
      '',
      '   ',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const value of invalidPercentCases) {
      try {
        await service.upsertDependency(
          {
            dependency_id: `DEP-${String(value).replace(/[^a-z0-9]/gi, 'X') || 'EMPTY'}`,
            predecessor_feature_id: 'FEAT-VALID-OK',
            dependent_feature_id: 'FEAT-VALID-OK',
            dependency_type: 'Hard',
            affected_activity: 'Build',
            blocking_pct: value,
            dependency_status: 'Open',
            responsible_team_id: null,
          },
          { expectedVersion: await service.getWorkbookVersion() }
        );
        throw new Error(`Expected invalid blocking_pct ${JSON.stringify(value)} to be rejected.`);
      } catch (error) {
        if (!(error instanceof WorkbookValidationError)) {
          throw error;
        }
      }
    }

    for (const value of invalidPercentCases) {
      try {
        await service.upsertScenario(
          {
            scenario_id: `SCN-${String(value).replace(/[^a-z0-9]/gi, 'X') || 'EMPTY'}`,
            scenario_name: 'Scenario Validation',
            global_pct: value,
            description: 'check validation',
          },
          { expectedVersion: await service.getWorkbookVersion() }
        );
        throw new Error(`Expected invalid global_pct ${JSON.stringify(value)} to be rejected.`);
      } catch (error) {
        if (!(error instanceof WorkbookValidationError)) {
          throw error;
        }
      }
    }

    for (const value of invalidPercentCases) {
      try {
        await service.upsertScenarioOverride(
          {
            scenario_id: 'SCN-VALID',
            feature_id: 'FEAT-VALID-OK',
            override_pct: value,
          },
          { expectedVersion: await service.getWorkbookVersion() }
        );
        throw new Error(`Expected invalid override_pct ${JSON.stringify(value)} to be rejected.`);
      } catch (error) {
        if (!(error instanceof WorkbookValidationError)) {
          throw error;
        }
      }
    }
  });
}

async function verifyCrossInstanceConcurrencyBoundary() {
  await withTempDirectory('release-scheduler-cross-instance-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'shared.xlsx');
    const firstService = await WorkbookService.create({ workbookPath });
    const secondService = await WorkbookService.create({ workbookPath });

    const firstVersion = await firstService.getWorkbookVersion();
    await firstService.upsertTeam(
      { team_id: 'TEAM-CROSS-1', team_name: 'First Writer', status: 'Active' },
      { expectedVersion: firstVersion }
    );

    const secondVersion = await secondService.getWorkbookVersion();
    const staleResult = await secondService
      .upsertTeam(
        { team_id: 'TEAM-CROSS-2', team_name: 'Stale Writer', status: 'Active' },
        { expectedVersion: secondVersion }
      )
      .then(() => 'unexpected-success')
      .catch((error) => error);

    if (!(staleResult instanceof WorkbookConflictError)) {
      throw new Error(
        `Expected stale second service instance to be rejected with WorkbookConflictError, got ${staleResult}`
      );
    }

    const reloaded = await WorkbookService.create({ workbookPath });
    const teamIds = reloaded
      .listTeams()
      .map((team) => team.team_id)
      .sort();

    if (teamIds.length !== 1 || teamIds[0] !== 'TEAM-CROSS-1') {
      throw new Error(
        `Expected the first writer's change to remain on disk after stale rejection, found ${JSON.stringify(teamIds)}.`
      );
    }
  });
}

async function verifyPersistenceFailureRollback() {
  await withTempDirectory('release-scheduler-failure-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'failure.xlsx');
    const service = await WorkbookService.create({ workbookPath });
    const originalVersion = await service.getWorkbookVersion();
    const originalBytes = await fs.readFile(workbookPath);

    const originalWriteFile = service.workbook.xlsx.writeFile.bind(service.workbook.xlsx);
    let caughtError = null;

    service.workbook.xlsx.writeFile = async () => {
      const simulatedError = new Error('simulated persistence failure');
      throw simulatedError;
    };

    try {
      await service.upsertTeam(
        { team_id: 'TEAM-FAIL', team_name: 'Should fail', status: 'Active' },
        { expectedVersion: originalVersion }
      );
      throw new Error('Expected simulated persistence failure to be surfaced.');
    } catch (error) {
      caughtError = error;
      if (!(error instanceof Error)) {
        throw new Error('Expected a real Error object from the simulated failure.');
      }
      if (error.message !== 'simulated persistence failure') {
        throw new Error(
          `Expected the simulated persistence error, but got: ${error.message || String(error)}`
        );
      }
    } finally {
      service.workbook.xlsx.writeFile = originalWriteFile;
    }

    if (!caughtError || caughtError.message !== 'simulated persistence failure') {
      throw new Error('The simulated persistence error was not the one being asserted.');
    }

    if (service.getTeam('TEAM-FAIL')) {
      throw new Error('Failed mutation should not leave a record in memory.');
    }

    if ((await service.getWorkbookVersion()) !== originalVersion) {
      throw new Error('Failed write should not advance version counter.');
    }

    const afterFailureBytes = await fs.readFile(workbookPath);
    if (!afterFailureBytes.equals(originalBytes)) {
      throw new Error('Workbook bytes changed after a failed persistence attempt.');
    }

    const reloaded = await WorkbookService.create({ workbookPath });
    if (reloaded.getTeam('TEAM-FAIL')) {
      throw new Error('Failed mutation should be absent after reloading the workbook from disk.');
    }

    const tempEntries = await fs.readdir(tempRoot);
    const staleArtifacts = tempEntries.filter(
      (entry) => entry.includes('.tmp') || entry.includes('.lock') || entry.includes('.bak')
    );
    if (staleArtifacts.length > 0) {
      throw new Error(
        `Temporary persistence artifacts were not cleaned up after failure: ${staleArtifacts.join(', ')}`
      );
    }
  });
}

async function verifyReplacementFailureRestoresOriginalWorkbook() {
  await withTempDirectory('release-scheduler-replace-restore-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'replace-restore.xlsx');
    const service = await WorkbookService.create({ workbookPath });

    await service.upsertTeam(
      { team_id: 'TEAM-BASE', team_name: 'Base Team', status: 'Active' },
      { expectedVersion: await service.getWorkbookVersion() }
    );

    const originalBytes = await fs.readFile(workbookPath);
    const originalRead = await WorkbookService.create({ workbookPath });
    const originalTeamCount = originalRead.listTeams().length;

    const originalRename = fs.rename;
    const originalCopyFile = fs.copyFile;

    fs.rename = async (from, to) => {
      if (to === workbookPath && from.includes('.tmp')) {
        throw new Error('simulated replace failure');
      }
      return originalRename(from, to);
    };

    fs.copyFile = async (from, to) => {
      if (from === workbookPath && to !== workbookPath && String(to).includes('.bak.')) {
        return originalCopyFile(from, to);
      }
      if (from !== workbookPath && String(from).includes('.bak.') && to === workbookPath) {
        return originalCopyFile(from, to);
      }
      return originalCopyFile(from, to);
    };

    try {
      await service.upsertTeam(
        { team_id: 'TEAM-RECOVERY', team_name: 'Recovery Team', status: 'Active' },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      throw new Error('Expected replacement failure to be surfaced.');
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error('Expected a real Error object from a failed replacement.');
      }
      if (!/restored successfully/i.test(error.message)) {
        throw new Error(
          `Expected successful backup restore message, got: ${error.message || String(error)}`
        );
      }
    } finally {
      fs.rename = originalRename;
      fs.copyFile = originalCopyFile;
    }

    const updatedBytes = await fs.readFile(workbookPath);
    if (!updatedBytes.equals(originalBytes)) {
      throw new Error('Replacement failure should preserve the original workbook bytes.');
    }

    const reloaded = await WorkbookService.create({ workbookPath });
    if (reloaded.listTeams().length !== originalTeamCount) {
      throw new Error('Backup restoration should leave the original workbook contents intact.');
    }
    if (reloaded.getTeam('TEAM-RECOVERY')) {
      throw new Error('Restored workbook should not include the failed write.');
    }

    const tempEntries = await fs.readdir(tempRoot);
    const staleArtifacts = tempEntries.filter(
      (entry) => entry.includes('.tmp') || entry.includes('.bak')
    );
    if (staleArtifacts.length > 0) {
      throw new Error(
        `Expected no stale temp or backup artifacts after successful recovery: ${staleArtifacts.join(', ')}`
      );
    }
  });
}

async function verifyReplacementFailureAndBackupRetention() {
  await withTempDirectory('release-scheduler-backup-retain-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'backup-retain.xlsx');
    const service = await WorkbookService.create({ workbookPath });
    const originalBytes = await fs.readFile(workbookPath);

    const originalRename = fs.rename;
    const originalCopyFile = fs.copyFile;

    fs.rename = async (from, to) => {
      if (to === workbookPath && from.includes('.tmp')) {
        throw new Error('simulated rename failure');
      }
      return originalRename(from, to);
    };

    fs.copyFile = async (from, to) => {
      if (from === workbookPath && String(to).includes('.bak.')) {
        return originalCopyFile(from, to);
      }
      if (String(from).includes('.bak.') && to === workbookPath) {
        throw new Error('simulated restore failure');
      }
      return originalCopyFile(from, to);
    };

    try {
      await service.upsertTeam(
        { team_id: 'TEAM-BACKUP-KEEP', team_name: 'Keep Backup', status: 'Active' },
        { expectedVersion: await service.getWorkbookVersion() }
      );
      throw new Error(
        'Expected replacement failure with backup restoration failure to be surfaced.'
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error('Expected a real Error object from the backup restoration failure.');
      }
      if (!/Backup retained at/i.test(error.message)) {
        throw new Error(
          `Expected recovery failure to mention the retained backup, got: ${error.message || String(error)}`
        );
      }
      if (!/simulated rename failure/i.test(error.message)) {
        throw new Error(
          `Expected the original failure message to be preserved, got: ${error.message || String(error)}`
        );
      }
      if (!/simulated restore failure/i.test(error.message)) {
        throw new Error(
          `Expected the restore failure message to be preserved, got: ${error.message || String(error)}`
        );
      }
    } finally {
      fs.rename = originalRename;
      fs.copyFile = originalCopyFile;
    }

    const finalBytes = await fs.readFile(workbookPath);
    if (!finalBytes.equals(originalBytes)) {
      throw new Error(
        'Failed replacement should preserve the original workbook bytes even when restore fails.'
      );
    }

    const backupMatches = (await fs.readdir(tempRoot)).filter((entry) => entry.includes('.bak.'));
    if (backupMatches.length !== 1) {
      throw new Error('Expected a retained backup file after failed recovery.');
    }

    const backupPath = path.join(tempRoot, backupMatches[0]);
    const backupBytes = await fs.readFile(backupPath);
    if (!backupBytes.equals(originalBytes)) {
      throw new Error('The retained backup should contain the original workbook bytes.');
    }

    const reloaded = await WorkbookService.create({ workbookPath });
    if (reloaded.getTeam('TEAM-BACKUP-KEEP')) {
      throw new Error('The failed write must not appear in the workbook after failed replacement.');
    }
  });
}

async function verifyExistingRowValidationRejectsInvalidWorkbook() {
  await withTempDirectory('release-scheduler-invalid-row-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'invalid-row.xlsx');
    const workbook = new ExcelJS.Workbook();

    for (const sheet of require('../src/workbook/workbookSchema').SHEETS) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.addRow(sheet.columns);
    }

    workbook
      .getWorksheet('Teams')
      .addRow(['', 'Name is missing', 'Active', new Date(), new Date(), '']);

    await workbook.xlsx.writeFile(workbookPath);
    const originalBytes = await fs.readFile(workbookPath);

    try {
      await WorkbookService.create({ workbookPath });
      throw new Error('Expected workbook initialization to reject invalid existing rows.');
    } catch (error) {
      if (!(error instanceof WorkbookValidationError)) {
        throw error;
      }
    }

    const finalBytes = await fs.readFile(workbookPath);
    if (!finalBytes.equals(originalBytes)) {
      throw new Error('Invalid workbook must be left untouched after validation fails.');
    }
  });
}

async function verifyIncompatibleWorkbookRemainsUntouched() {
  await withTempDirectory('release-scheduler-incompatible-', async (tempRoot) => {
    const workbookPath = path.join(tempRoot, 'incompatible.xlsx');
    const invalidWorkbook = new ExcelJS.Workbook();
    const worksheet = invalidWorkbook.addWorksheet('WrongSheet');
    worksheet.addRow(['not_the_expected_headers']);
    await invalidWorkbook.xlsx.writeFile(workbookPath);

    const originalBytes = await fs.readFile(workbookPath);

    try {
      await WorkbookService.create({ workbookPath });
      throw new Error('Expected incompatible workbook initialization to fail.');
    } catch (error) {
      if (!(error instanceof WorkbookValidationError)) {
        throw error;
      }
    }

    const currentBytes = await fs.readFile(workbookPath);
    if (!currentBytes.equals(originalBytes)) {
      throw new Error('Incompatible workbook was overwritten during failed initialization.');
    }
  });
}

async function main() {
  await verifyBlankWorkbook();
  await verifyRoundTripAndValidation();
  await verifyIntegerValidationAndPercentages();
  await verifyConcurrencyAndStaleVersion();
  await verifyCrossInstanceConcurrencyBoundary();
  await verifyPersistenceFailureRollback();
  await verifyReplacementFailureRestoresOriginalWorkbook();
  await verifyReplacementFailureAndBackupRetention();
  await verifyExistingRowValidationRejectsInvalidWorkbook();
  await verifyIncompatibleWorkbookRemainsUntouched();

  console.log('WorkbookService verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
