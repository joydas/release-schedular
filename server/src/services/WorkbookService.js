'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const ExcelJS = require('exceljs');
const lockfile = require('proper-lockfile');

const { SHEETS, SHEET_NAMES, getSheetDefinition } = require('../workbook/workbookSchema');

class WorkbookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkbookError';
  }
}

class WorkbookConflictError extends WorkbookError {
  constructor(expectedVersion, actualVersion) {
    super(`Workbook version conflict: expected ${expectedVersion}, found ${actualVersion}.`);
    this.name = 'WorkbookConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

class WorkbookReferenceConflictError extends WorkbookConflictError {
  constructor(message) {
    super('reference conflict', 'current workbook state');
    this.name = 'WorkbookReferenceConflictError';
    this.message = message;
  }
}

class WorkbookValidationError extends WorkbookError {
  constructor(message) {
    super(message);
    this.name = 'WorkbookValidationError';
  }
}

class WorkbookService {
  constructor({ workbookPath } = {}) {
    if (!workbookPath) {
      throw new WorkbookValidationError('A workbook path is required.');
    }

    this.workbookPath = workbookPath;
    this.workbookDirectory = path.dirname(workbookPath);
    this.workbook = null;
    this.workbookVersion = 0;
    this.lastKnownWorkbookSignature = null;
    this.writeQueue = Promise.resolve();
  }

  static async create(options = {}) {
    const service = new WorkbookService(options);
    await service.initialize();
    return service;
  }

  async initialize() {
    await fs.mkdir(this.workbookDirectory, { recursive: true });

    const exists = await fs
      .access(this.workbookPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      this.workbook = this.createBlankWorkbook();
      this.workbookVersion = 0;
      await this.persistWorkbook({ skipVersionCheck: true, initialWrite: true });
      return;
    }

    this.workbook = await this.loadWorkbook();
    this.workbookVersion = this.readWorkbookVersionFromConfig();
    this.lastKnownWorkbookSignature = await this.readWorkbookSignature(this.workbookPath);
  }

  createBlankWorkbook() {
    const workbook = new ExcelJS.Workbook();

    for (const sheet of SHEETS) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.addRow(sheet.columns);
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    return workbook;
  }

  async loadWorkbook() {
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.readFile(this.workbookPath);
    } catch (error) {
      throw new WorkbookValidationError(
        `Unable to read workbook at ${this.workbookPath}: ${error.message}`
      );
    }

    this.validateWorkbookCompatibility(workbook);
    this.validateWorkbookRowsForWorkbook(workbook);
    this.workbook = workbook;
    this.workbookVersion = this.readWorkbookVersionFromConfig();
    this.lastKnownWorkbookSignature = await this.readWorkbookSignature(this.workbookPath);
    return workbook;
  }

  readWorkbookVersionFromConfig() {
    if (!this.workbook) {
      return 1;
    }

    const versionEntry = this.getConfigValue('workbook_version');
    if (
      !versionEntry ||
      versionEntry.config_value === null ||
      versionEntry.config_value === undefined
    ) {
      return 1;
    }

    const value = Number(versionEntry.config_value);
    return Number.isFinite(value) ? value : 1;
  }

  async readWorkbookSignature(filePath = this.workbookPath) {
    try {
      const workbookBytes = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(workbookBytes).digest('hex');
    } catch {
      return null;
    }
  }

  async assertWorkbookNotStale({ expectedVersion = this.workbookVersion } = {}) {
    const currentSignature = await this.readWorkbookSignature(this.workbookPath);

    if (
      this.lastKnownWorkbookSignature !== null &&
      currentSignature !== this.lastKnownWorkbookSignature
    ) {
      throw new WorkbookConflictError(expectedVersion, this.workbookVersion);
    }

    return currentSignature;
  }

  isBlankValue(value) {
    return (
      value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
    );
  }

  assertValidDate(value, label) {
    if (this.isBlankValue(value)) {
      return;
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new WorkbookValidationError(`${label} must be a valid date.`);
    }
  }

  validateWorkbookCompatibility(workbook) {
    const actualSheetNames = workbook.worksheets.map((sheet) => sheet.name);

    if (
      actualSheetNames.length !== SHEET_NAMES.length ||
      actualSheetNames.some((name, index) => name !== SHEET_NAMES[index])
    ) {
      throw new WorkbookValidationError(
        `Workbook is incompatible: expected ${SHEET_NAMES.join(', ')} in order. Found ${actualSheetNames.join(', ') || '(none)'} .`
      );
    }

    for (const [index, sheet] of SHEETS.entries()) {
      const worksheet = workbook.getWorksheet(sheet.name);

      if (!worksheet) {
        throw new WorkbookValidationError(`Workbook is missing required worksheet: ${sheet.name}`);
      }

      if (workbook.worksheets[index].name !== sheet.name) {
        throw new WorkbookValidationError(
          `Workbook sheet order is incompatible. Expected ${SHEET_NAMES.join(', ')}. Found ${actualSheetNames.join(', ') || '(none)'}.`
        );
      }

      const headers = worksheet
        .getRow(1)
        .values.slice(1)
        .map((value) => String(value ?? '').trim());

      if (
        headers.length !== sheet.columns.length ||
        headers.some((header, headerIndex) => header !== sheet.columns[headerIndex])
      ) {
        throw new WorkbookValidationError(
          `Worksheet ${sheet.name} has incompatible headers. Expected ${sheet.columns.join(', ')}. Found ${headers.join(', ') || '(none)'}.`
        );
      }
    }
  }

  validateRowValues(sheetName, values) {
    const definition = getSheetDefinition(sheetName);
    const row = {};

    definition.columns.forEach((column, index) => {
      row[column] = values[index] ?? null;
    });

    switch (sheetName) {
      case 'Teams': {
        this.assertText(row.team_id, 'team_id');
        this.assertText(row.team_name, 'team_name');
        if (!this.isBlankValue(row.status)) {
          this.assertText(row.status, 'status');
        }
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Releases': {
        this.assertText(row.release_id, 'release_id');
        this.assertText(row.release_name, 'release_name');
        this.assertValidDate(row.start_date, 'start_date');
        this.assertValidDate(row.end_date, 'end_date');
        this.assertValidDate(row.target_date, 'target_date');
        if (!this.isBlankValue(row.start_date) && !this.isBlankValue(row.end_date)) {
          const startDate = new Date(row.start_date);
          const endDate = new Date(row.end_date);
          if (startDate > endDate) {
            throw new WorkbookValidationError('start_date must be on or before end_date.');
          }
        }
        if (!this.isBlankValue(row.priority_order))
          this.assertInteger(row.priority_order, 'priority_order');
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Features': {
        this.assertText(row.feature_id, 'feature_id');
        if (!this.isBlankValue(row.release_id)) {
          this.assertText(row.release_id, 'release_id');
          this.assertReference('Releases', 'release_id', row.release_id, 'feature.release_id');
        }
        this.assertText(row.feature_name, 'feature_name');
        if (!this.isBlankValue(row.team_id)) {
          this.assertReference('Teams', 'team_id', row.team_id, 'feature.team_id');
        }
        if (!this.isBlankValue(row.priority)) this.assertInteger(row.priority, 'priority');
        if (!this.isBlankValue(row.input_order)) this.assertInteger(row.input_order, 'input_order');
        if (!this.isBlankValue(row.build_estimate_current))
          this.assertNumber(row.build_estimate_current, 'build_estimate_current');
        if (!this.isBlankValue(row.build_original_estimate))
          this.assertNumber(row.build_original_estimate, 'build_original_estimate');
        if (!this.isBlankValue(row.build_actual_spent))
          this.assertNumber(row.build_actual_spent, 'build_actual_spent');
        if (!this.isBlankValue(row.st_estimate_current))
          this.assertNumber(row.st_estimate_current, 'st_estimate_current');
        if (!this.isBlankValue(row.st_original_estimate))
          this.assertNumber(row.st_original_estimate, 'st_original_estimate');
        if (!this.isBlankValue(row.st_actual_spent))
          this.assertNumber(row.st_actual_spent, 'st_actual_spent');
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'User Stories': {
        this.assertText(row.story_id, 'story_id');
        this.assertText(row.feature_id, 'feature_id');
        this.assertReference('Features', 'feature_id', row.feature_id, 'story.feature_id');
        this.assertText(row.story_name, 'story_name');
        if (!this.isBlankValue(row.input_order)) this.assertInteger(row.input_order, 'input_order');
        if (!this.isBlankValue(row.build_estimate_current))
          this.assertNumber(row.build_estimate_current, 'build_estimate_current');
        if (!this.isBlankValue(row.build_original_estimate))
          this.assertNumber(row.build_original_estimate, 'build_original_estimate');
        if (!this.isBlankValue(row.build_actual_spent))
          this.assertNumber(row.build_actual_spent, 'build_actual_spent');
        if (!this.isBlankValue(row.st_estimate_current))
          this.assertNumber(row.st_estimate_current, 'st_estimate_current');
        if (!this.isBlankValue(row.st_original_estimate))
          this.assertNumber(row.st_original_estimate, 'st_original_estimate');
        if (!this.isBlankValue(row.st_actual_spent))
          this.assertNumber(row.st_actual_spent, 'st_actual_spent');
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Dependencies': {
        this.assertText(row.dependency_id, 'dependency_id');
        this.assertText(row.predecessor_feature_id, 'predecessor_feature_id');
        this.assertText(row.dependent_feature_id, 'dependent_feature_id');
        if (String(row.predecessor_feature_id).trim() === String(row.dependent_feature_id).trim()) {
          throw new WorkbookValidationError(
            'A dependency cannot reference the same feature as both predecessor and dependent.'
          );
        }
        this.assertReference(
          'Features',
          'feature_id',
          row.predecessor_feature_id,
          'dependency.predecessor_feature_id'
        );
        this.assertReference(
          'Features',
          'feature_id',
          row.dependent_feature_id,
          'dependency.dependent_feature_id'
        );
        const dependencyType = String(row.dependency_type || '').trim();
        if (!['Hard', 'Normal'].includes(dependencyType)) {
          throw new WorkbookValidationError('dependency_type must be Hard or Normal.');
        }
        if (!this.isBlankValue(row.affected_activity)) {
          const activity = String(row.affected_activity).trim();
          if (!['Build', 'ST', 'Both'].includes(activity)) {
            throw new WorkbookValidationError('affected_activity must be Build, ST, or Both.');
          }
        }
        if (dependencyType === 'Hard' && this.isBlankValue(row.affected_activity)) {
          throw new WorkbookValidationError('affected_activity is required for Hard dependencies.');
        }
        if (dependencyType === 'Hard' && this.isBlankValue(row.blocking_pct)) {
          throw new WorkbookValidationError('blocking_pct is required for Hard dependencies.');
        }
        if (!this.isBlankValue(row.blocking_pct)) {
          const pct = Number(row.blocking_pct);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            throw new WorkbookValidationError('blocking_pct must be between 0 and 100.');
          }
        }
        const dependencyStatus = String(row.dependency_status || '').trim();
        if (!['Unresolved', 'Resolved'].includes(dependencyStatus)) {
          throw new WorkbookValidationError('dependency_status must be Unresolved or Resolved.');
        }
        if (!this.isBlankValue(row.responsible_team_id)) {
          this.assertReference(
            'Teams',
            'team_id',
            row.responsible_team_id,
            'dependency.responsible_team_id'
          );
        }
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Scenarios': {
        this.assertText(row.scenario_id, 'scenario_id');
        this.assertText(row.scenario_name, 'scenario_name');
        if (!this.isBlankValue(row.global_pct)) {
          const globalPct = Number(row.global_pct);
          if (!Number.isFinite(globalPct) || globalPct < 5 || globalPct > 50) {
            throw new WorkbookValidationError('global_pct must be between 5 and 50.');
          }
        }
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Scenario Overrides': {
        this.assertText(row.scenario_id, 'scenario_id');
        this.assertReference(
          'Scenarios',
          'scenario_id',
          row.scenario_id,
          'scenario_override.scenario_id'
        );
        this.assertText(row.feature_id, 'feature_id');
        this.assertReference(
          'Features',
          'feature_id',
          row.feature_id,
          'scenario_override.feature_id'
        );
        if (!this.isBlankValue(row.override_pct)) {
          const overridePct = Number(row.override_pct);
          if (!Number.isFinite(overridePct) || overridePct < 0 || overridePct > 100) {
            throw new WorkbookValidationError('override_pct must be between 0 and 100.');
          }
        }
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Scenario Projections': {
        this.assertText(row.projection_id, 'projection_id');
        this.assertText(row.scenario_id, 'scenario_id');
        this.assertReference(
          'Scenarios',
          'scenario_id',
          row.scenario_id,
          'scenario_projection.scenario_id'
        );
        this.assertText(row.projection_name, 'projection_name');
        this.assertValidDate(row.saved_at, 'saved_at');
        if (!this.isBlankValue(row.plan_result_json)) {
          try {
            JSON.parse(row.plan_result_json);
          } catch {
            throw new WorkbookValidationError('plan_result_json must contain valid JSON.');
          }
        }
        break;
      }
      case 'TeamReleaseCapacity': {
        this.assertText(row.team_id, 'team_id');
        this.assertReference('Teams', 'team_id', row.team_id, 'team_release_capacity.team_id');
        this.assertText(row.release_id, 'release_id');
        this.assertReference(
          'Releases',
          'release_id',
          row.release_id,
          'team_release_capacity.release_id'
        );
        if (!this.isBlankValue(row.build_capacity))
          this.assertNumber(row.build_capacity, 'build_capacity');
        if (!this.isBlankValue(row.st_capacity)) this.assertNumber(row.st_capacity, 'st_capacity');
        if (!this.isBlankValue(row.capacity_source))
          this.assertText(row.capacity_source, 'capacity_source');
        this.assertValidDate(row.created_at, 'created_at');
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      case 'Config': {
        this.assertText(row.config_key, 'config_key');
        if (!this.isBlankValue(row.config_value)) this.assertText(row.config_value, 'config_value');
        if (!this.isBlankValue(row.value_type)) {
          const valueType = String(row.value_type).trim();
          if (!['String', 'Number', 'Boolean', 'Date', 'JSON'].includes(valueType)) {
            throw new WorkbookValidationError(
              'value_type must be String, Number, Boolean, Date, or JSON.'
            );
          }
        }
        this.assertValidDate(row.updated_at, 'updated_at');
        break;
      }
      default:
        break;
    }
  }

  validateWorkbookRowsForWorkbook(workbook) {
    const previousWorkbook = this.workbook;
    this.workbook = workbook;

    try {
      for (const sheet of SHEETS) {
        const worksheet = workbook.getWorksheet(sheet.name);
        if (!worksheet) continue;

        const rows = worksheet.getRows(2, Math.max(worksheet.rowCount - 1, 0)) || [];

        for (const row of rows) {
          if (!row || !row.values) continue;

          const values = row.values.slice(1);
          const hasData = values.some(
            (value) => value !== null && value !== undefined && String(value).trim() !== ''
          );

          if (!hasData) continue;

          this.validateRowValues(sheet.name, values);
        }
      }
    } finally {
      this.workbook = previousWorkbook;
    }
  }

  validateWorkbookRows() {
    this.validateWorkbookRowsForWorkbook(this.workbook);
  }

  async persistWorkbook({
    expectedVersion = null,
    skipVersionCheck = false,
    initialWrite = false,
  } = {}) {
    if (!this.workbook) {
      throw new WorkbookValidationError('Workbook is not initialized.');
    }

    if (!skipVersionCheck && expectedVersion !== null && expectedVersion !== this.workbookVersion) {
      throw new WorkbookConflictError(expectedVersion, this.workbookVersion);
    }

    const nextVersion = initialWrite ? 1 : this.workbookVersion + 1;
    const versionConfigRow = {
      config_key: 'workbook_version',
      config_value: String(nextVersion),
      value_type: 'Number',
      description: 'Workbook revision counter for optimistic concurrency checks.',
      updated_at: new Date(),
    };

    const existingVersionConfigIndex = this.findRowIndex(
      'Config',
      (row) => row.config_key === 'workbook_version'
    );
    if (existingVersionConfigIndex !== -1) {
      this.writeRow('Config', existingVersionConfigIndex, versionConfigRow);
    } else {
      this.appendRow('Config', versionConfigRow);
    }

    const tempPath = path.join(
      this.workbookDirectory,
      `.${path.basename(this.workbookPath, path.extname(this.workbookPath))}.tmp.${process.pid}.${Date.now()}.xlsx`
    );
    const backupPath = `${this.workbookPath}.bak.${process.pid}.${Date.now()}`;
    const lockPath = path.join(this.workbookDirectory, '.release-scheduler.lock');

    let releaseLock = null;
    let backupCreated = false;
    let tempRenamed = false;
    let targetExists = false;
    let backupRestored = false;
    let backupPreserved = false;

    try {
      await fs.mkdir(this.workbookDirectory, { recursive: true });

      // This service supports a single server process and a single canonical in-memory workbook per path.
      // The local file lock serializes writes on this machine, and the signature check ensures a stale
      // service instance cannot silently overwrite the current on-disk workbook state after it was changed.
      releaseLock = await lockfile.lock(this.workbookPath, {
        realpath: false,
        lockfilePath: lockPath,
        retries: {
          retries: 10,
          factor: 2,
          minTimeout: 50,
          maxTimeout: 200,
        },
      });

      await this.assertWorkbookNotStale({ expectedVersion });
      this.validateCurrentWorkbookState();
      await this.workbook.xlsx.writeFile(tempPath);

      const checkedWorkbook = new ExcelJS.Workbook();
      await checkedWorkbook.xlsx.readFile(tempPath);
      this.validateWorkbookCompatibility(checkedWorkbook);

      targetExists = await fs
        .access(this.workbookPath)
        .then(() => true)
        .catch(() => false);

      // Safe replacement strategy for Windows: keep a recoverable backup until the new file is
      // fully validated and renamed into place. This is recoverable but not strictly atomic if the
      // filesystem or OS blocks a rename while the active file exists.
      if (targetExists) {
        await fs.copyFile(this.workbookPath, backupPath);
        backupCreated = true;
      }

      try {
        await fs.rename(tempPath, this.workbookPath);
        tempRenamed = true;
      } catch (error) {
        if (backupCreated && targetExists) {
          try {
            await fs.copyFile(backupPath, this.workbookPath);
            backupRestored = true;
            throw new WorkbookValidationError(
              `Workbook persistence failed while replacing ${this.workbookPath}. The original workbook was restored successfully from ${backupPath}. Original error: ${error.message}`
            );
          } catch (restoreError) {
            backupPreserved = true;
            throw new WorkbookValidationError(
              `Workbook persistence failed while replacing ${this.workbookPath}. Automatic recovery from backup failed. Backup retained at ${backupPath}. Original error: ${error.message}. Recovery error: ${restoreError.message}`
            );
          }
        }
        throw error;
      }

      if (backupCreated) {
        await fs.rm(backupPath, { force: true }).catch(() => {});
      }

      this.workbookVersion = nextVersion;
      this.lastKnownWorkbookSignature = await this.readWorkbookSignature(this.workbookPath);
    } catch (error) {
      if (!tempRenamed) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
      }

      if (backupCreated && targetExists && !tempRenamed && !backupRestored) {
        try {
          await fs.copyFile(backupPath, this.workbookPath);
          backupRestored = true;
          throw new WorkbookValidationError(
            `Workbook persistence failed while replacing ${this.workbookPath}. The original workbook was restored successfully from ${backupPath}. Original error: ${error.message}`
          );
        } catch (restoreError) {
          if (restoreError instanceof WorkbookValidationError) {
            throw restoreError;
          }

          backupPreserved = true;
          throw new WorkbookValidationError(
            `Workbook persistence failed while replacing ${this.workbookPath}. Automatic recovery from backup failed. Backup retained at ${backupPath}. Original error: ${error.message}. Recovery error: ${restoreError.message}`
          );
        }
      }

      if (backupCreated && targetExists && !tempRenamed && backupRestored) {
        await fs.rm(backupPath, { force: true }).catch(() => {});
      }

      throw error;
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});

      if (backupCreated && targetExists && !tempRenamed && !backupPreserved && backupRestored) {
        await fs.rm(backupPath, { force: true }).catch(() => {});
      }

      if (releaseLock) {
        await releaseLock().catch(() => {});
      }
    }
  }

  async snapshotWorkbook() {
    if (!this.workbook) {
      return null;
    }

    const buffer = await this.workbook.xlsx.writeBuffer();
    return buffer;
  }

  async restoreWorkbookFromSnapshot(snapshotBuffer) {
    if (!snapshotBuffer) {
      return;
    }

    try {
      const restoredWorkbook = new ExcelJS.Workbook();
      await restoredWorkbook.xlsx.load(snapshotBuffer);
      this.validateWorkbookCompatibility(restoredWorkbook);
      this.workbook = restoredWorkbook;
    } catch (error) {
      this.workbook = null;
      throw new WorkbookValidationError(
        `Workbook snapshot restoration failed after a mutation error. In-memory workbook state is no longer trustworthy. Recovery error: ${error.message}`
      );
    }
  }

  async runMutation(mutator, { expectedVersion = null } = {}) {
    if (!this.workbook) {
      throw new WorkbookValidationError('Workbook is not initialized.');
    }

    const queuedMutation = async () => {
      const previousVersion = this.workbookVersion;

      if (expectedVersion !== null && expectedVersion !== previousVersion) {
        throw new WorkbookConflictError(expectedVersion, previousVersion);
      }

      const snapshotBuffer = await this.snapshotWorkbook();

      try {
        const result = await mutator(this.workbook);
        this.validateCurrentWorkbookState();
        await this.persistWorkbook({ skipVersionCheck: true });
        return result;
      } catch (error) {
        if (snapshotBuffer) {
          try {
            await this.restoreWorkbookFromSnapshot(snapshotBuffer);
          } catch (restoreError) {
            this.workbookVersion = previousVersion;
            throw new WorkbookValidationError(
              `Mutation failed and snapshot restoration also failed. In-memory workbook state is not trustworthy. Original error: ${error.message}. Recovery error: ${restoreError.message}`
            );
          }
        }
        this.workbookVersion = previousVersion;
        throw error;
      }
    };

    const operation = this.writeQueue.then(queuedMutation, queuedMutation);
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  validateCurrentWorkbookState() {
    this.validateWorkbookCompatibility(this.workbook);
    this.validateWorkbookRows();
  }

  async getWorkbookVersion() {
    return this.workbookVersion;
  }

  getWorksheet(sheetName) {
    const worksheet = this.workbook.getWorksheet(sheetName);

    if (!worksheet) {
      throw new WorkbookValidationError(`Worksheet ${sheetName} does not exist.`);
    }

    return worksheet;
  }

  getWorksheetNames() {
    return this.workbook.worksheets.map((worksheet) => worksheet.name);
  }

  readRows(sheetName) {
    const definition = getSheetDefinition(sheetName);
    const worksheet = this.getWorksheet(sheetName);
    const rows = worksheet.getRows(2, Math.max(worksheet.rowCount - 1, 0)) || [];

    return rows
      .filter(
        (row) =>
          row &&
          row.values &&
          row.values.some((value) => value !== null && value !== undefined && value !== '')
      )
      .map((row) => {
        const values = row.values.slice(1);
        const object = {};

        definition.columns.forEach((column, index) => {
          object[column] = values[index] ?? null;
        });

        return object;
      });
  }

  writeRow(sheetName, rowNumber, values) {
    const definition = getSheetDefinition(sheetName);
    const worksheet = this.getWorksheet(sheetName);
    const row = worksheet.getRow(rowNumber);

    definition.columns.forEach((column, index) => {
      row.getCell(index + 1).value = values[column] ?? null;
    });

    row.commit();
  }

  appendRow(sheetName, values) {
    const definition = getSheetDefinition(sheetName);
    const worksheet = this.getWorksheet(sheetName);
    const rowValues = definition.columns.map((column) => values[column] ?? null);
    worksheet.addRow(rowValues);
  }

  findRowIndex(sheetName, predicate) {
    const rows = this.readRows(sheetName);
    const index = rows.findIndex(predicate);
    return index === -1 ? -1 : index + 2;
  }

  assertText(value, label) {
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new WorkbookValidationError(`${label} is required.`);
    }
  }

  assertNumber(value, label, allowZero = true) {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      throw new WorkbookValidationError(`${label} must be a number.`);
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new WorkbookValidationError(`${label} must be a finite number.`);
    }

    if (!allowZero && numericValue === 0) {
      throw new WorkbookValidationError(`${label} cannot be zero.`);
    }

    if (numericValue < 0) {
      throw new WorkbookValidationError(`${label} must be non-negative.`);
    }
  }

  assertInteger(value, label) {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      throw new WorkbookValidationError(`${label} must be an integer.`);
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
      throw new WorkbookValidationError(`${label} must be an integer.`);
    }
  }

  assertReference(sheetName, columnName, value, label) {
    if (value === null || value === undefined || value === '') {
      return;
    }

    const rows = this.readRows(sheetName);
    const exists = rows.some((row) => row[columnName] === value);

    if (!exists) {
      throw new WorkbookValidationError(
        `${label} references a missing ${sheetName} row for ${columnName}=${value}.`
      );
    }
  }

  ensureUniqueRecord(sheetName, keyFields, row) {
    const rows = this.readRows(sheetName);
    const matches = rows.filter((existing) => {
      return keyFields.every((field) => existing[field] === row[field]);
    });

    if (matches.length > 0) {
      const keyDescription = keyFields.map((field) => `${field}=${row[field]}`).join(', ');
      throw new WorkbookValidationError(`Duplicate record in ${sheetName} for ${keyDescription}.`);
    }
  }

  listTeams() {
    return this.readRows('Teams');
  }

  getTeam(teamId) {
    const rows = this.readRows('Teams');
    return rows.find((row) => row.team_id === teamId) || null;
  }

  async upsertTeam(teamRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Teams';
        this.assertText(teamRecord.team_id, 'team_id');
        this.assertText(teamRecord.team_name, 'team_name');

        if (
          teamRecord.status !== undefined &&
          teamRecord.status !== null &&
          String(teamRecord.status).trim() === ''
        ) {
          throw new WorkbookValidationError('status is required.');
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex((row) => row.team_id === teamRecord.team_id);

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['team_id'], teamRecord);
          this.appendRow(sheetName, {
            ...teamRecord,
            created_at: teamRecord.created_at ?? new Date(),
            updated_at: teamRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...teamRecord,
            updated_at: teamRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getTeam(teamRecord.team_id);
      },
      { expectedVersion }
    );
  }

  async deleteTeam(teamId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex('Teams', (row) => row.team_id === teamId);
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Team ${teamId} does not exist.`);
        }

        const featureReferences = this.readRows('Features').filter((row) => row.team_id === teamId);
        if (featureReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Team ${teamId} because features still reference it.`
          );
        }

        const capacityReferences = this.readRows('TeamReleaseCapacity').filter(
          (row) => row.team_id === teamId
        );
        if (capacityReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Team ${teamId} because release capacity rows still reference it.`
          );
        }

        const dependencyReferences = this.readRows('Dependencies').filter(
          (row) => row.responsible_team_id === teamId
        );
        if (dependencyReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Team ${teamId} because dependencies still reference it.`
          );
        }

        this.getWorksheet('Teams').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listReleases() {
    return this.readRows('Releases');
  }

  getRelease(releaseId) {
    const rows = this.readRows('Releases');
    return rows.find((row) => row.release_id === releaseId) || null;
  }

  async upsertRelease(releaseRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Releases';
        this.assertText(releaseRecord.release_id, 'release_id');
        this.assertText(releaseRecord.release_name, 'release_name');
        if (
          releaseRecord.start_date &&
          releaseRecord.end_date &&
          new Date(releaseRecord.start_date) > new Date(releaseRecord.end_date)
        ) {
          throw new WorkbookValidationError('start_date must be on or before end_date.');
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex((row) => row.release_id === releaseRecord.release_id);

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['release_id'], releaseRecord);
          this.appendRow(sheetName, {
            ...releaseRecord,
            created_at: releaseRecord.created_at ?? new Date(),
            updated_at: releaseRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...releaseRecord,
            updated_at: releaseRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getRelease(releaseRecord.release_id);
      },
      { expectedVersion }
    );
  }

  async deleteRelease(releaseId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex('Releases', (row) => row.release_id === releaseId);
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Release ${releaseId} does not exist.`);
        }

        const featureReferences = this.readRows('Features').filter(
          (row) => row.release_id === releaseId
        );
        if (featureReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Release ${releaseId} because features still belong to it.`
          );
        }

        const capacityReferences = this.readRows('TeamReleaseCapacity').filter(
          (row) => row.release_id === releaseId
        );
        if (capacityReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Release ${releaseId} because team capacity rows still reference it.`
          );
        }

        this.getWorksheet('Releases').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listFeatures() {
    return this.readRows('Features');
  }

  getFeature(featureId) {
    const rows = this.readRows('Features');
    return rows.find((row) => row.feature_id === featureId) || null;
  }

  async upsertFeature(featureRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Features';
        this.assertText(featureRecord.feature_id, 'feature_id');
        const releaseId = String(featureRecord.release_id ?? '').trim();
        if (releaseId) this.assertText(releaseId, 'release_id');
        this.assertText(featureRecord.feature_name, 'feature_name');
        if (releaseId)
          this.assertReference('Releases', 'release_id', releaseId, 'feature.release_id');

        if (featureRecord.team_id) {
          this.assertReference('Teams', 'team_id', featureRecord.team_id, 'feature.team_id');
        }

        this.assertInteger(featureRecord.priority, 'priority');
        this.assertInteger(featureRecord.input_order, 'input_order');
        this.assertNumber(featureRecord.build_estimate_current, 'build_estimate_current');
        this.assertNumber(featureRecord.build_original_estimate, 'build_original_estimate');
        this.assertNumber(featureRecord.build_actual_spent, 'build_actual_spent');
        this.assertNumber(featureRecord.st_estimate_current, 'st_estimate_current');
        this.assertNumber(featureRecord.st_original_estimate, 'st_original_estimate');
        this.assertNumber(featureRecord.st_actual_spent, 'st_actual_spent');

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex((row) => row.feature_id === featureRecord.feature_id);

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['feature_id'], featureRecord);
          this.appendRow(sheetName, {
            ...featureRecord,
            release_id: releaseId,
            created_at: featureRecord.created_at ?? new Date(),
            updated_at: featureRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...featureRecord,
            release_id: releaseId || existingRow.release_id || '',
            updated_at: featureRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getFeature(featureRecord.feature_id);
      },
      { expectedVersion }
    );
  }

  async deleteFeature(featureId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex('Features', (row) => row.feature_id === featureId);
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Feature ${featureId} does not exist.`);
        }

        const storyReferences = this.readRows('User Stories').filter(
          (row) => row.feature_id === featureId
        );
        if (storyReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Feature ${featureId} because user stories still reference it.`
          );
        }

        const dependencyReferences = this.readRows('Dependencies').filter(
          (row) =>
            row.predecessor_feature_id === featureId || row.dependent_feature_id === featureId
        );
        if (dependencyReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Feature ${featureId} because dependencies still reference it.`
          );
        }

        const overrideReferences = this.readRows('Scenario Overrides').filter(
          (row) => row.feature_id === featureId
        );
        if (overrideReferences.length > 0) {
          throw new WorkbookReferenceConflictError(
            `Cannot delete Feature ${featureId} because scenario overrides still reference it.`
          );
        }

        this.getWorksheet('Features').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listUserStories() {
    return this.readRows('User Stories');
  }

  getUserStory(storyId) {
    const rows = this.readRows('User Stories');
    return rows.find((row) => row.story_id === storyId) || null;
  }

  async upsertUserStory(storyRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'User Stories';
        this.assertText(storyRecord.story_id, 'story_id');
        this.assertText(storyRecord.feature_id, 'feature_id');
        this.assertText(storyRecord.story_name, 'story_name');
        this.assertReference('Features', 'feature_id', storyRecord.feature_id, 'story.feature_id');
        this.assertInteger(storyRecord.input_order, 'input_order');
        this.assertNumber(storyRecord.build_estimate_current, 'build_estimate_current');
        this.assertNumber(storyRecord.build_original_estimate, 'build_original_estimate');
        this.assertNumber(storyRecord.build_actual_spent, 'build_actual_spent');
        this.assertNumber(storyRecord.st_estimate_current, 'st_estimate_current');
        this.assertNumber(storyRecord.st_original_estimate, 'st_original_estimate');
        this.assertNumber(storyRecord.st_actual_spent, 'st_actual_spent');

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex((row) => row.story_id === storyRecord.story_id);

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['story_id'], storyRecord);
          this.appendRow(sheetName, {
            ...storyRecord,
            created_at: storyRecord.created_at ?? new Date(),
            updated_at: storyRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...storyRecord,
            updated_at: storyRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getUserStory(storyRecord.story_id);
      },
      { expectedVersion }
    );
  }

  async deleteUserStory(storyId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex('User Stories', (row) => row.story_id === storyId);
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`User story ${storyId} does not exist.`);
        }

        this.getWorksheet('User Stories').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  async applyFeatureStoryImport({
    features = [],
    stories = [],
    mode = 'add',
    expectedVersion = null,
  } = {}) {
    return this.runMutation(
      () => {
        if (!['add', 'replace'].includes(mode)) {
          throw new WorkbookValidationError("Import mode must be either 'add' or 'replace'.");
        }

        const featureRows = this.readRows('Features');
        const storyRows = this.readRows('User Stories');
        const featureIdsInImport = new Set();
        const storyIdsInImport = new Set();

        for (const featureRecord of features) {
          const featureId = String(featureRecord.feature_id ?? '').trim();

          if (!featureId) {
            throw new WorkbookValidationError('Each imported feature requires a feature_id.');
          }

          if (featureIdsInImport.has(featureId)) {
            throw new WorkbookValidationError(
              `Duplicate feature_id ${featureId} in the import payload.`
            );
          }
          featureIdsInImport.add(featureId);

          if (mode === 'add' && featureRows.some((row) => row.feature_id === featureId)) {
            throw new WorkbookValidationError(
              `Feature ${featureId} already exists in the workbook. Use mode='replace' to overwrite it.`
            );
          }

          this.assertText(featureRecord.feature_id, 'feature_id');
          const releaseId = String(featureRecord.release_id ?? '').trim();
          if (releaseId) this.assertText(releaseId, 'release_id');
          this.assertText(featureRecord.feature_name, 'feature_name');
          if (releaseId)
            this.assertReference('Releases', 'release_id', releaseId, 'feature.release_id');
          this.assertInteger(featureRecord.priority, 'priority');
          this.assertInteger(featureRecord.input_order, 'input_order');
          this.assertNumber(featureRecord.build_estimate_current, 'build_estimate_current');
          this.assertNumber(featureRecord.build_original_estimate, 'build_original_estimate');
          this.assertNumber(featureRecord.build_actual_spent, 'build_actual_spent');
          this.assertNumber(featureRecord.st_estimate_current, 'st_estimate_current');
          this.assertNumber(featureRecord.st_original_estimate, 'st_original_estimate');
          this.assertNumber(featureRecord.st_actual_spent, 'st_actual_spent');

          if (featureRecord.team_id) {
            this.assertReference('Teams', 'team_id', featureRecord.team_id, 'feature.team_id');
          }

          this.validateRowValues('Features', [
            featureRecord.feature_id,
            releaseId,
            featureRecord.feature_name,
            featureRecord.priority,
            featureRecord.input_order,
            featureRecord.team_id ?? null,
            featureRecord.status ?? 'Backlog',
            featureRecord.build_estimate_current,
            featureRecord.build_original_estimate,
            featureRecord.build_actual_spent,
            featureRecord.st_estimate_current,
            featureRecord.st_original_estimate,
            featureRecord.st_actual_spent,
            featureRecord.created_at ?? new Date(),
            featureRecord.updated_at ?? new Date(),
          ]);
        }

        if (mode === 'replace') {
          for (const featureId of featureIdsInImport) {
            const existingFeatureIndex = this.findRowIndex(
              'Features',
              (row) => row.feature_id === featureId
            );
            if (existingFeatureIndex !== -1) {
              this.getWorksheet('Features').spliceRows(existingFeatureIndex, 1);
            }

            for (const row of this.readRows('User Stories')) {
              if (row.feature_id === featureId) {
                const storyIndex = this.findRowIndex(
                  'User Stories',
                  (storyRow) => storyRow.story_id === row.story_id
                );
                if (storyIndex !== -1) {
                  this.getWorksheet('User Stories').spliceRows(storyIndex, 1);
                }
              }
            }
          }
        }

        for (const storyRecord of stories) {
          const storyId = String(storyRecord.story_id ?? '').trim();

          if (!storyId) {
            throw new WorkbookValidationError('Each imported story requires a story_id.');
          }

          if (storyIdsInImport.has(storyId)) {
            throw new WorkbookValidationError(
              `Duplicate story_id ${storyId} in the import payload.`
            );
          }
          storyIdsInImport.add(storyId);

          if (mode === 'add' && storyRows.some((row) => row.story_id === storyId)) {
            throw new WorkbookValidationError(
              `User story ${storyId} already exists in the workbook. Use mode='replace' to overwrite it.`
            );
          }

          this.assertText(storyRecord.story_id, 'story_id');
          this.assertText(storyRecord.feature_id, 'feature_id');
          if (!featureIdsInImport.has(storyRecord.feature_id)) {
            this.assertReference(
              'Features',
              'feature_id',
              storyRecord.feature_id,
              'story.feature_id'
            );
          }
          this.assertText(storyRecord.story_name, 'story_name');
          this.assertInteger(storyRecord.input_order, 'input_order');
          this.assertNumber(storyRecord.build_estimate_current, 'build_estimate_current');
          this.assertNumber(storyRecord.build_original_estimate, 'build_original_estimate');
          this.assertNumber(storyRecord.build_actual_spent, 'build_actual_spent');
          this.assertNumber(storyRecord.st_estimate_current, 'st_estimate_current');
          this.assertNumber(storyRecord.st_original_estimate, 'st_original_estimate');
          this.assertNumber(storyRecord.st_actual_spent, 'st_actual_spent');

          if (mode === 'replace') {
            const existingStoryIndex = this.findRowIndex(
              'User Stories',
              (row) => row.story_id === storyId
            );
            if (existingStoryIndex !== -1) {
              this.getWorksheet('User Stories').spliceRows(existingStoryIndex, 1);
            }
          }

          if (!featureIdsInImport.has(storyRecord.feature_id)) {
            this.assertReference(
              'Features',
              'feature_id',
              storyRecord.feature_id,
              'story.feature_id'
            );
          }

          this.assertText(storyRecord.story_name, 'story_name');
          this.assertInteger(storyRecord.input_order, 'input_order');
          this.assertNumber(storyRecord.build_estimate_current, 'build_estimate_current');
          this.assertNumber(storyRecord.build_original_estimate, 'build_original_estimate');
          this.assertNumber(storyRecord.build_actual_spent, 'build_actual_spent');
          this.assertNumber(storyRecord.st_estimate_current, 'st_estimate_current');
          this.assertNumber(storyRecord.st_original_estimate, 'st_original_estimate');
          this.assertNumber(storyRecord.st_actual_spent, 'st_actual_spent');
        }

        for (const featureRecord of features) {
          this.appendRow('Features', {
            ...featureRecord,
            created_at: featureRecord.created_at ?? new Date(),
            updated_at: featureRecord.updated_at ?? new Date(),
          });
        }

        for (const storyRecord of stories) {
          this.appendRow('User Stories', {
            ...storyRecord,
            created_at: storyRecord.created_at ?? new Date(),
            updated_at: storyRecord.updated_at ?? new Date(),
          });
        }

        return {
          features: features.map((record) => ({ ...record })),
          stories: stories.map((record) => ({ ...record })),
        };
      },
      { expectedVersion }
    );
  }

  listDependencies() {
    return this.readRows('Dependencies');
  }

  getDependency(dependencyId) {
    const rows = this.readRows('Dependencies');
    return rows.find((row) => row.dependency_id === dependencyId) || null;
  }

  async upsertDependency(dependencyRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Dependencies';
        this.assertText(dependencyRecord.dependency_id, 'dependency_id');
        this.assertText(dependencyRecord.predecessor_feature_id, 'predecessor_feature_id');
        this.assertText(dependencyRecord.dependent_feature_id, 'dependent_feature_id');

        if (
          String(dependencyRecord.predecessor_feature_id).trim() ===
          String(dependencyRecord.dependent_feature_id).trim()
        ) {
          throw new WorkbookValidationError(
            'A dependency cannot reference the same feature as both predecessor and dependent.'
          );
        }

        this.assertReference(
          'Features',
          'feature_id',
          dependencyRecord.predecessor_feature_id,
          'dependency.predecessor_feature_id'
        );
        this.assertReference(
          'Features',
          'feature_id',
          dependencyRecord.dependent_feature_id,
          'dependency.dependent_feature_id'
        );

        const dependencyType = String(dependencyRecord.dependency_type || '').trim();
        if (!['Hard', 'Normal'].includes(dependencyType)) {
          throw new WorkbookValidationError('dependency_type must be Hard or Normal.');
        }

        if (dependencyType === 'Hard' && this.isBlankValue(dependencyRecord.affected_activity)) {
          throw new WorkbookValidationError('affected_activity is required for Hard dependencies.');
        }
        if (dependencyRecord.affected_activity) {
          const activity = String(dependencyRecord.affected_activity).trim();
          if (!['Build', 'ST', 'Both'].includes(activity)) {
            throw new WorkbookValidationError('affected_activity must be Build, ST, or Both.');
          }
        }

        if (dependencyType === 'Hard' && this.isBlankValue(dependencyRecord.blocking_pct)) {
          throw new WorkbookValidationError('blocking_pct is required for Hard dependencies.');
        }

        if (dependencyRecord.blocking_pct !== null && dependencyRecord.blocking_pct !== undefined) {
          const rawPct = dependencyRecord.blocking_pct;
          if (rawPct === '' || (typeof rawPct === 'string' && rawPct.trim() === '')) {
            throw new WorkbookValidationError('blocking_pct cannot be empty.');
          }

          const pct = Number(rawPct);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            throw new WorkbookValidationError('blocking_pct must be between 0 and 100.');
          }
        }

        if (dependencyRecord.responsible_team_id) {
          this.assertReference(
            'Teams',
            'team_id',
            dependencyRecord.responsible_team_id,
            'dependency.responsible_team_id'
          );
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex(
          (row) => row.dependency_id === dependencyRecord.dependency_id
        );

        const predecessorId = String(dependencyRecord.predecessor_feature_id).trim();
        const dependentId = String(dependencyRecord.dependent_feature_id).trim();
        const duplicateRelationship = rows.find(
          (row, index) =>
            index !== existingIndex &&
            String(row.predecessor_feature_id).trim() === predecessorId &&
            String(row.dependent_feature_id).trim() === dependentId
        );
        if (duplicateRelationship) {
          throw new WorkbookValidationError(
            `A dependency from feature ${predecessorId} to ${dependentId} already exists (${duplicateRelationship.dependency_id}).`
          );
        }

        const currentRecord = existingIndex === -1 ? null : rows[existingIndex];
        const endpointsChanged =
          !currentRecord ||
          String(currentRecord.predecessor_feature_id).trim() !== predecessorId ||
          String(currentRecord.dependent_feature_id).trim() !== dependentId;
        if (endpointsChanged) {
          const adjacency = new Map();
          rows.forEach((row, index) => {
            if (index === existingIndex) return;
            const source = String(row.predecessor_feature_id).trim();
            const target = String(row.dependent_feature_id).trim();
            if (!adjacency.has(source)) adjacency.set(source, []);
            adjacency.get(source).push(target);
          });

          const pending = [dependentId];
          const visited = new Set();
          while (pending.length > 0) {
            const featureId = pending.pop();
            if (featureId === predecessorId) {
              throw new WorkbookValidationError(
                `This dependency would create a directed cycle from feature ${predecessorId} to ${dependentId}.`
              );
            }
            if (visited.has(featureId)) continue;
            visited.add(featureId);
            pending.push(...(adjacency.get(featureId) || []));
          }
        }

        const dependencyStatus = String(dependencyRecord.dependency_status || '').trim();
        if (!['Unresolved', 'Resolved'].includes(dependencyStatus)) {
          throw new WorkbookValidationError('dependency_status must be Unresolved or Resolved.');
        }

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['dependency_id'], dependencyRecord);
          this.appendRow(sheetName, {
            ...dependencyRecord,
            created_at: dependencyRecord.created_at ?? new Date(),
            updated_at: dependencyRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...dependencyRecord,
            updated_at: dependencyRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getDependency(dependencyRecord.dependency_id);
      },
      { expectedVersion }
    );
  }

  async deleteDependency(dependencyId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex(
          'Dependencies',
          (row) => row.dependency_id === dependencyId
        );
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Dependency ${dependencyId} does not exist.`);
        }

        this.getWorksheet('Dependencies').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listScenarios() {
    return this.readRows('Scenarios');
  }

  getScenario(scenarioId) {
    const rows = this.readRows('Scenarios');
    return rows.find((row) => row.scenario_id === scenarioId) || null;
  }

  async upsertScenario(scenarioRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Scenarios';
        this.assertText(scenarioRecord.scenario_id, 'scenario_id');
        this.assertText(scenarioRecord.scenario_name, 'scenario_name');
        const rawGlobalPct = scenarioRecord.global_pct;
        if (rawGlobalPct === null || rawGlobalPct === undefined) {
          throw new WorkbookValidationError('global_pct is required.');
        }
        if (
          rawGlobalPct === '' ||
          (typeof rawGlobalPct === 'string' && rawGlobalPct.trim() === '')
        ) {
          throw new WorkbookValidationError('global_pct cannot be empty.');
        }

        const globalPct = Number(rawGlobalPct);
        if (!Number.isFinite(globalPct) || globalPct < 5 || globalPct > 50) {
          throw new WorkbookValidationError('global_pct must be between 5 and 50.');
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex(
          (row) => row.scenario_id === scenarioRecord.scenario_id
        );

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['scenario_id'], scenarioRecord);
          this.appendRow(sheetName, {
            ...scenarioRecord,
            created_at: scenarioRecord.created_at ?? new Date(),
            updated_at: scenarioRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...scenarioRecord,
            updated_at: scenarioRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getScenario(scenarioRecord.scenario_id);
      },
      { expectedVersion }
    );
  }

  async deleteScenario(scenarioId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex('Scenarios', (row) => row.scenario_id === scenarioId);
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Scenario ${scenarioId} does not exist.`);
        }

        this.getWorksheet('Scenarios').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listScenarioOverrides() {
    return this.readRows('Scenario Overrides');
  }

  getScenarioOverride(scenarioId, featureId) {
    const rows = this.readRows('Scenario Overrides');
    return (
      rows.find((row) => row.scenario_id === scenarioId && row.feature_id === featureId) || null
    );
  }

  async upsertScenarioOverride(overrideRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Scenario Overrides';
        this.assertText(overrideRecord.scenario_id, 'scenario_id');
        this.assertText(overrideRecord.feature_id, 'feature_id');
        this.assertReference(
          'Scenarios',
          'scenario_id',
          overrideRecord.scenario_id,
          'scenario_override.scenario_id'
        );
        this.assertReference(
          'Features',
          'feature_id',
          overrideRecord.feature_id,
          'scenario_override.feature_id'
        );
        const rawOverridePct = overrideRecord.override_pct;
        if (rawOverridePct === null || rawOverridePct === undefined) {
          throw new WorkbookValidationError('override_pct is required.');
        }
        if (
          rawOverridePct === '' ||
          (typeof rawOverridePct === 'string' && rawOverridePct.trim() === '')
        ) {
          throw new WorkbookValidationError('override_pct cannot be empty.');
        }

        const overridePct = Number(rawOverridePct);
        if (!Number.isFinite(overridePct) || overridePct < 0 || overridePct > 100) {
          throw new WorkbookValidationError('override_pct must be between 0 and 100.');
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex(
          (row) =>
            row.scenario_id === overrideRecord.scenario_id &&
            row.feature_id === overrideRecord.feature_id
        );

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['scenario_id', 'feature_id'], overrideRecord);
          this.appendRow(sheetName, {
            ...overrideRecord,
            created_at: overrideRecord.created_at ?? new Date(),
            updated_at: overrideRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...overrideRecord,
            updated_at: overrideRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getScenarioOverride(overrideRecord.scenario_id, overrideRecord.feature_id);
      },
      { expectedVersion }
    );
  }

  async deleteScenarioOverride(scenarioId, featureId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex(
          'Scenario Overrides',
          (row) => row.scenario_id === scenarioId && row.feature_id === featureId
        );
        if (rowIndex === -1) {
          throw new WorkbookValidationError(
            `Scenario override for scenario ${scenarioId} and feature ${featureId} does not exist.`
          );
        }

        this.getWorksheet('Scenario Overrides').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listScenarioProjections() {
    return this.readRows('Scenario Projections');
  }

  getScenarioProjection(projectionId) {
    const rows = this.readRows('Scenario Projections');
    return rows.find((row) => row.projection_id === projectionId) || null;
  }

  async upsertScenarioProjection(projectionRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Scenario Projections';
        this.assertText(projectionRecord.projection_id, 'projection_id');
        this.assertText(projectionRecord.scenario_id, 'scenario_id');
        this.assertText(projectionRecord.projection_name, 'projection_name');
        this.assertReference(
          'Scenarios',
          'scenario_id',
          projectionRecord.scenario_id,
          'scenario_projection.scenario_id'
        );
        this.assertText(projectionRecord.plan_result_json, 'plan_result_json');
        try {
          JSON.parse(projectionRecord.plan_result_json);
        } catch {
          throw new WorkbookValidationError('plan_result_json must contain valid JSON.');
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex(
          (row) => row.projection_id === projectionRecord.projection_id
        );

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['projection_id'], projectionRecord);
          this.appendRow(sheetName, {
            ...projectionRecord,
            saved_at: projectionRecord.saved_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...projectionRecord,
            saved_at: projectionRecord.saved_at ?? existingRow.saved_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getScenarioProjection(projectionRecord.projection_id);
      },
      { expectedVersion }
    );
  }

  async deleteScenarioProjection(projectionId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex(
          'Scenario Projections',
          (row) => row.projection_id === projectionId
        );
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Scenario projection ${projectionId} does not exist.`);
        }

        this.getWorksheet('Scenario Projections').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listTeamReleaseCapacity() {
    return this.readRows('TeamReleaseCapacity');
  }

  getTeamReleaseCapacity(teamId, releaseId) {
    const rows = this.readRows('TeamReleaseCapacity');
    return rows.find((row) => row.team_id === teamId && row.release_id === releaseId) || null;
  }

  async upsertTeamReleaseCapacity(record, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'TeamReleaseCapacity';
        this.assertText(record.team_id, 'team_id');
        this.assertText(record.release_id, 'release_id');
        this.assertReference('Teams', 'team_id', record.team_id, 'team_release_capacity.team_id');
        this.assertReference(
          'Releases',
          'release_id',
          record.release_id,
          'team_release_capacity.release_id'
        );
        this.assertNumber(record.build_capacity, 'build_capacity');
        this.assertNumber(record.st_capacity, 'st_capacity');

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex(
          (row) => row.team_id === record.team_id && row.release_id === record.release_id
        );

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['team_id', 'release_id'], record);
          this.appendRow(sheetName, {
            ...record,
            created_at: record.created_at ?? new Date(),
            updated_at: record.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...record,
            updated_at: record.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getTeamReleaseCapacity(record.team_id, record.release_id);
      },
      { expectedVersion }
    );
  }

  async deleteTeamReleaseCapacity(teamId, releaseId, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex(
          'TeamReleaseCapacity',
          (row) => row.team_id === teamId && row.release_id === releaseId
        );
        if (rowIndex === -1) {
          throw new WorkbookValidationError(
            `Team/release capacity for team ${teamId} and release ${releaseId} does not exist.`
          );
        }

        this.getWorksheet('TeamReleaseCapacity').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }

  listConfig() {
    return this.readRows('Config');
  }

  buildConfigMap() {
    return Object.fromEntries(
      this.listConfig()
        .filter((row) => row.config_key !== 'workbook_version')
        .map((row) => [row.config_key, this.deserializeConfigValue(row)])
    );
  }

  deserializeConfigValue(row) {
    if (!row) {
      return null;
    }

    const valueType = String(row.value_type || 'String').trim();
    const rawValue = row.config_value;

    switch (valueType) {
      case 'Number':
        return Number(rawValue);
      case 'Boolean':
        return String(rawValue).toLowerCase() === 'true';
      case 'Date':
        return rawValue ? new Date(rawValue).toISOString() : null;
      case 'JSON': {
        if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
          return null;
        }
        try {
          return JSON.parse(String(rawValue));
        } catch {
          return rawValue;
        }
      }
      case 'String':
      default:
        return rawValue === null || rawValue === undefined ? null : String(rawValue);
    }
  }

  inferConfigValueType(value) {
    if (value === null || value === undefined) {
      return 'String';
    }

    if (typeof value === 'boolean') {
      return 'Boolean';
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return 'Number';
    }

    if (value instanceof Date) {
      return 'Date';
    }

    if (typeof value === 'object') {
      return 'JSON';
    }

    return 'String';
  }

  normalizeConfigValue(value, valueType, fieldName) {
    switch (valueType) {
      case 'Number': {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          throw new WorkbookValidationError(`${fieldName} must be a finite number.`);
        }
        return numericValue;
      }
      case 'Boolean': {
        if (typeof value === 'boolean') {
          return value;
        }

        if (value === 'true' || value === 'false') {
          return value === 'true';
        }

        throw new WorkbookValidationError(`${fieldName} must be a boolean.`);
      }
      case 'Date': {
        if (value instanceof Date) {
          return value.toISOString();
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new WorkbookValidationError(`${fieldName} must be a valid date.`);
        }

        return parsed.toISOString();
      }
      case 'JSON': {
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            throw new WorkbookValidationError(`${fieldName} must be valid JSON.`);
          }
        }

        if (value !== null && typeof value === 'object') {
          return value;
        }

        throw new WorkbookValidationError(`${fieldName} must be valid JSON.`);
      }
      case 'String':
      default:
        return String(value);
    }
  }

  serializeConfigValue(value, valueType) {
    switch (valueType) {
      case 'Number':
        return String(Number(value));
      case 'Boolean':
        return value ? 'true' : 'false';
      case 'Date':
        return new Date(value).toISOString();
      case 'JSON':
        return typeof value === 'string' ? value : JSON.stringify(value);
      case 'String':
      default:
        return String(value ?? '');
    }
  }

  getConfigValue(configKey) {
    const rows = this.readRows('Config');
    return rows.find((row) => row.config_key === configKey) || null;
  }

  async updateConfigValues(updates, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const patch =
          updates && typeof updates === 'object' && !Array.isArray(updates) ? { ...updates } : {};

        if (Object.keys(patch).length === 0) {
          throw new WorkbookValidationError('At least one config value must be provided.');
        }

        const currentRows = this.readRows('Config');
        const currentByKey = new Map(currentRows.map((row) => [row.config_key, row]));
        const knownKeys = new Set([
          'SCHEMA_VERSION',
          'LAST_UPDATED_AT',
          'LAST_IMPORTED_AT',
          'SPRINT_CADENCE',
          ...Array.from(currentByKey.keys()),
        ]);
        const protectedKeys = new Set(['SCHEMA_VERSION', 'LAST_UPDATED_AT', 'LAST_IMPORTED_AT']);

        for (const [key, rawValue] of Object.entries(patch)) {
          if (!knownKeys.has(key)) {
            throw new WorkbookValidationError(`Config key ${key} is not supported.`);
          }

          if (protectedKeys.has(key)) {
            throw new WorkbookValidationError(
              `Config key ${key} is system-managed and cannot be changed.`
            );
          }

          if (rawValue === null || rawValue === undefined) {
            throw new WorkbookValidationError(`${key} must be a valid value.`);
          }

          const existingRow = currentByKey.get(key) || {
            config_key: key,
            config_value: '',
            value_type: 'String',
            description: `${key} configuration`,
            updated_at: new Date(),
          };
          const expectedType = String(
            existingRow.value_type || this.inferConfigValueType(rawValue)
          );
          const normalizedValue = this.normalizeConfigValue(rawValue, expectedType, key);
          const serializedValue = this.serializeConfigValue(normalizedValue, expectedType);

          currentByKey.set(key, {
            ...existingRow,
            config_key: key,
            config_value: serializedValue,
            value_type: expectedType,
            description: existingRow.description || `${key} configuration`,
            updated_at: new Date(),
          });
        }

        const lastUpdatedAt = new Date();
        const lastUpdatedRow = currentByKey.get('LAST_UPDATED_AT') || {
          config_key: 'LAST_UPDATED_AT',
          config_value: '',
          value_type: 'Date',
          description: 'Last workbook update timestamp.',
          updated_at: lastUpdatedAt,
        };

        currentByKey.set('LAST_UPDATED_AT', {
          ...lastUpdatedRow,
          config_key: 'LAST_UPDATED_AT',
          config_value: lastUpdatedAt.toISOString(),
          value_type: 'Date',
          description: lastUpdatedRow.description || 'Last workbook update timestamp.',
          updated_at: lastUpdatedAt,
        });

        const rows = this.readRows('Config');

        rows.forEach((row, index) => {
          const nextRow = currentByKey.get(row.config_key);
          if (nextRow) {
            this.writeRow('Config', index + 2, nextRow);
          }
        });

        for (const [key, nextRow] of currentByKey.entries()) {
          if (!rows.some((row) => row.config_key === key)) {
            this.appendRow('Config', nextRow);
          }
        }

        const configMap = Object.fromEntries(
          this.listConfig()
            .filter((row) => row.config_key !== 'workbook_version')
            .map((row) => [row.config_key, this.deserializeConfigValue(row)])
        );

        return configMap;
      },
      { expectedVersion }
    );
  }

  async upsertConfigValue(configRecord, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const sheetName = 'Config';
        this.assertText(configRecord.config_key, 'config_key');
        this.assertText(configRecord.config_value, 'config_value');
        const valueType = String(configRecord.value_type || '').trim();
        if (!['String', 'Number', 'Boolean', 'Date', 'JSON'].includes(valueType)) {
          throw new WorkbookValidationError(
            'value_type must be String, Number, Boolean, Date, or JSON.'
          );
        }

        const rows = this.readRows(sheetName);
        const existingIndex = rows.findIndex((row) => row.config_key === configRecord.config_key);

        if (existingIndex === -1) {
          this.ensureUniqueRecord(sheetName, ['config_key'], configRecord);
          this.appendRow(sheetName, {
            ...configRecord,
            updated_at: configRecord.updated_at ?? new Date(),
          });
        } else {
          const rowNumber = existingIndex + 2;
          const existingRow = rows[existingIndex];
          const mergedRow = {
            ...existingRow,
            ...configRecord,
            updated_at: configRecord.updated_at ?? new Date(),
          };
          this.writeRow(sheetName, rowNumber, mergedRow);
        }

        return this.getConfigValue(configRecord.config_key);
      },
      { expectedVersion }
    );
  }

  async deleteConfigValue(configKey, { expectedVersion = null } = {}) {
    return this.runMutation(
      () => {
        const rowIndex = this.findRowIndex('Config', (row) => row.config_key === configKey);
        if (rowIndex === -1) {
          throw new WorkbookValidationError(`Config entry ${configKey} does not exist.`);
        }

        this.getWorksheet('Config').spliceRows(rowIndex, 1);
        return true;
      },
      { expectedVersion }
    );
  }
}

module.exports = {
  WorkbookService,
  WorkbookError,
  WorkbookConflictError,
  WorkbookReferenceConflictError,
  WorkbookValidationError,
};
