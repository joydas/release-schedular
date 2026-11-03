'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const {
  WorkbookService,
  WorkbookConflictError,
  WorkbookValidationError,
} = require('./WorkbookService');

const FEATURE_FIELDS = new Set([
  'feature_id',
  'release_id',
  'feature_name',
  'priority',
  'input_order',
  'team_id',
  'status',
  'build_estimate_current',
  'build_original_estimate',
  'build_actual_spent',
  'st_estimate_current',
  'st_original_estimate',
  'st_actual_spent',
]);

const STORY_FIELDS = new Set([
  'story_id',
  'feature_id',
  'story_name',
  'input_order',
  'status',
  'build_estimate_current',
  'build_original_estimate',
  'build_actual_spent',
  'st_estimate_current',
  'st_original_estimate',
  'st_actual_spent',
]);

const SHARED_FIELD_NAMES = new Set([...FEATURE_FIELDS, ...STORY_FIELDS]);

class CSVImportValidationError extends WorkbookValidationError {
  constructor(message) {
    super(message);
    this.name = 'CSVImportValidationError';
  }
}

class CSVImportService {
  constructor({ workbookPath, maxSizeBytes = 5 * 1024 * 1024 } = {}) {
    this.workbookPath =
      workbookPath || path.resolve(__dirname, '../../data/release-scheduler.xlsx');
    this.maxSizeBytes = maxSizeBytes;
  }

  async loadWorkbook({ createIfMissing = false } = {}) {
    const service = new WorkbookService({ workbookPath: this.workbookPath });
    const exists = await fs
      .access(this.workbookPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      if (!createIfMissing) {
        return null;
      }
      await service.initialize();
      return service;
    }

    await service.loadWorkbook();
    return service;
  }

  parseMappingTarget(targetField) {
    const cleanTarget = String(targetField ?? '').trim();
    if (!cleanTarget) {
      throw new CSVImportValidationError('CSV import mapping contains an empty target field.');
    }

    if (cleanTarget.includes('.')) {
      const [entityName, fieldName] = cleanTarget.split('.');
      const entity = String(entityName ?? '')
        .trim()
        .toLowerCase();
      const field = String(fieldName ?? '').trim();

      if (!entity || !field) {
        throw new CSVImportValidationError(
          `Invalid mapping target "${cleanTarget}". Use "feature.<field>" or "story.<field>".`
        );
      }

      if (entity !== 'feature' && entity !== 'story') {
        throw new CSVImportValidationError(
          `Unsupported mapping entity "${entity}" in "${cleanTarget}". Use feature.<field> or story.<field>.`
        );
      }

      const allowedFields = entity === 'feature' ? FEATURE_FIELDS : STORY_FIELDS;
      if (!allowedFields.has(field)) {
        throw new CSVImportValidationError(
          `Field "${field}" is not valid for ${entity} records in mapping target "${cleanTarget}".`
        );
      }

      return { entity, field };
    }

    const featureMatch = FEATURE_FIELDS.has(cleanTarget);
    const storyMatch = STORY_FIELDS.has(cleanTarget);

    if (featureMatch && storyMatch) {
      throw new CSVImportValidationError(
        `Ambiguous mapping target "${cleanTarget}". Use "feature.${cleanTarget}" or "story.${cleanTarget}".`
      );
    }

    if (featureMatch) {
      return { entity: 'feature', field: cleanTarget };
    }

    if (storyMatch) {
      return { entity: 'story', field: cleanTarget };
    }

    if (SHARED_FIELD_NAMES.has(cleanTarget)) {
      throw new CSVImportValidationError(
        `Ambiguous mapping target "${cleanTarget}". Use "feature.${cleanTarget}" or "story.${cleanTarget}".`
      );
    }

    throw new CSVImportValidationError(
      `Unsupported mapping target "${cleanTarget}". Use "feature.<field>" or "story.<field>".`
    );
  }

  normalizeMapping(rawMapping) {
    if (!rawMapping || typeof rawMapping !== 'object' || Array.isArray(rawMapping)) {
      throw new CSVImportValidationError(
        'CSV import mapping is required and must be an object of CSV columns to workbook fields.'
      );
    }

    const normalized = {};

    for (const [targetField, sourceColumn] of Object.entries(rawMapping)) {
      const cleanTarget = String(targetField ?? '').trim();
      const cleanSource = String(sourceColumn ?? '').trim();

      if (!cleanTarget || !cleanSource) {
        continue;
      }

      const { entity, field } = this.parseMappingTarget(cleanTarget);
      normalized[`${entity}.${field}`] = cleanSource;
    }

    if (Object.keys(normalized).length === 0) {
      throw new CSVImportValidationError(
        'CSV import mapping does not contain any valid column assignments.'
      );
    }

    return normalized;
  }

  parseCsvText(csvText, { maxSizeBytes = this.maxSizeBytes } = {}) {
    const buffer = Buffer.isBuffer(csvText) ? csvText : Buffer.from(String(csvText ?? ''), 'utf8');

    if (!buffer.length) {
      throw new CSVImportValidationError('CSV upload is empty.');
    }

    if (maxSizeBytes && buffer.length > maxSizeBytes) {
      throw new CSVImportValidationError(`CSV upload exceeds the ${maxSizeBytes} byte limit.`);
    }

    let rows;
    try {
      rows = parse(buffer, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
        quote: '"',
        escape: '"',
      });
    } catch (error) {
      throw new CSVImportValidationError(`Malformed CSV upload: ${error.message}`);
    }

    if (!rows || rows.length === 0) {
      throw new CSVImportValidationError('CSV upload contains no data rows.');
    }

    const headers = rows[0].map((header) => String(header ?? '').trim());

    if (!headers.length || headers.some((header) => header === '')) {
      throw new CSVImportValidationError(
        'CSV upload must include a header row with non-empty names.'
      );
    }

    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
    if (duplicateHeaders.length > 0) {
      throw new CSVImportValidationError(
        `CSV upload contains duplicate header names: ${[...new Set(duplicateHeaders)].join(', ')}.`
      );
    }

    const normalizedRows = rows.slice(1).map((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      if (!Array.isArray(row) || row.length !== headers.length) {
        throw new CSVImportValidationError(
          `Row ${rowNumber} has ${Array.isArray(row) ? row.length : 0} columns; expected ${headers.length}.`
        );
      }

      const normalizedRow = {};
      headers.forEach((header, columnIndex) => {
        normalizedRow[header] = row[columnIndex] ?? '';
      });
      return normalizedRow;
    });

    return { headers, rows: normalizedRows };
  }

  toNumber(value, fieldName, rowNumber) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new CSVImportValidationError(`Row ${rowNumber}: ${fieldName} must be a finite number.`);
    }

    return numericValue;
  }

  toInteger(value, fieldName, rowNumber) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }

    const integerValue = Number(value);
    if (!Number.isInteger(integerValue)) {
      throw new CSVImportValidationError(`Row ${rowNumber}: ${fieldName} must be an integer.`);
    }

    return integerValue;
  }

  normalizeValue(value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    return value;
  }

  buildPreparedRows({ rows, mapping, workbookService }) {
    const normalizedMapping = this.normalizeMapping(mapping);
    const preparedFeatures = [];
    const preparedStories = [];
    const errors = [];
    const warnings = [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const rowNumber = rowIndex + 2;
      const featureRecord = {};
      const storyRecord = {};

      for (const [targetField, csvColumn] of Object.entries(normalizedMapping)) {
        if (!Object.prototype.hasOwnProperty.call(row, csvColumn)) {
          continue;
        }

        const rawValue = row[csvColumn];
        const normalizedValue = this.normalizeValue(rawValue);
        const { entity, field } = this.parseMappingTarget(targetField);

        if (entity === 'feature') {
          featureRecord[field] = normalizedValue;
        }

        if (entity === 'story') {
          storyRecord[field] = normalizedValue;
        }
      }

      const hasFeatureData = Object.keys(featureRecord).length > 0;
      const hasStoryData = Object.keys(storyRecord).length > 0;

      if (!hasFeatureData && !hasStoryData) {
        continue;
      }

      try {
        if (hasFeatureData) {
          const featureId = featureRecord.feature_id;
          if (featureId === null || featureId === undefined || String(featureId).trim() === '') {
            throw new CSVImportValidationError('Row requires a feature_id.');
          }

          featureRecord.feature_id = String(featureId).trim();
          featureRecord.release_id = this.normalizeValue(featureRecord.release_id) ?? '';
          featureRecord.feature_name = this.normalizeValue(featureRecord.feature_name);
          featureRecord.status = this.normalizeValue(featureRecord.status) ?? 'Backlog';
          featureRecord.team_id = this.normalizeValue(featureRecord.team_id);
          featureRecord.priority =
            this.toInteger(featureRecord.priority, 'priority', rowNumber) ?? 1;
          featureRecord.input_order =
            this.toInteger(featureRecord.input_order, 'input_order', rowNumber) ?? 1;

          if (featureRecord.release_id) {
            const release = workbookService
              ? workbookService.getRelease(featureRecord.release_id)
              : null;
            if (!release && workbookService) {
              throw new CSVImportValidationError(
                `Row ${rowNumber}: release_id ${featureRecord.release_id} does not exist in the workbook.`
              );
            }
          }

          if (featureRecord.team_id) {
            const team = workbookService ? workbookService.getTeam(featureRecord.team_id) : null;
            if (!team && workbookService) {
              throw new CSVImportValidationError(
                `Row ${rowNumber}: team_id ${featureRecord.team_id} does not exist in the workbook.`
              );
            }
          }

          const buildEstimateCurrent = this.toNumber(
            featureRecord.build_estimate_current,
            'build_estimate_current',
            rowNumber
          );
          const stEstimateCurrent = this.toNumber(
            featureRecord.st_estimate_current,
            'st_estimate_current',
            rowNumber
          );

          featureRecord.build_estimate_current = buildEstimateCurrent ?? 0;
          featureRecord.build_original_estimate =
            this.toNumber(
              featureRecord.build_original_estimate,
              'build_original_estimate',
              rowNumber
            ) ?? featureRecord.build_estimate_current;
          featureRecord.build_actual_spent =
            this.toNumber(featureRecord.build_actual_spent, 'build_actual_spent', rowNumber) ?? 0;
          featureRecord.st_estimate_current = stEstimateCurrent ?? 0;
          featureRecord.st_original_estimate =
            this.toNumber(featureRecord.st_original_estimate, 'st_original_estimate', rowNumber) ??
            featureRecord.st_estimate_current;
          featureRecord.st_actual_spent =
            this.toNumber(featureRecord.st_actual_spent, 'st_actual_spent', rowNumber) ?? 0;

          if (featureRecord.feature_name === null || featureRecord.feature_name === '') {
            throw new CSVImportValidationError(`Row ${rowNumber}: feature_name is required.`);
          }
        }

        if (hasStoryData) {
          const storyId = storyRecord.story_id;
          if (storyId === null || storyId === undefined || String(storyId).trim() === '') {
            if (hasFeatureData && featureRecord.feature_id) {
              warnings.push(
                `Row ${rowNumber}: no story_id provided; no user story row will be imported for feature ${featureRecord.feature_id}.`
              );
            } else {
              throw new CSVImportValidationError(
                `Row ${rowNumber}: story_id is required when story data is provided.`
              );
            }
          } else {
            storyRecord.story_id = String(storyId).trim();
          }

          storyRecord.feature_id =
            this.normalizeValue(storyRecord.feature_id) ?? featureRecord.feature_id;
          storyRecord.story_name = this.normalizeValue(storyRecord.story_name);
          if (storyRecord.story_name === null || storyRecord.story_name === '') {
            throw new CSVImportValidationError(`Row ${rowNumber}: story_name is required.`);
          }

          if (storyRecord.feature_id) {
            const featureExists =
              storyRecord.feature_id === featureRecord.feature_id ||
              (workbookService && workbookService.getFeature(storyRecord.feature_id)) ||
              preparedFeatures.some((record) => record.feature_id === storyRecord.feature_id);

            if (!featureExists) {
              throw new CSVImportValidationError(
                `Row ${rowNumber}: story.feature_id ${storyRecord.feature_id} is missing from the target workbook or this import.`
              );
            }
          }

          storyRecord.input_order =
            this.toInteger(storyRecord.input_order, 'input_order', rowNumber) ?? 1;
          storyRecord.status = this.normalizeValue(storyRecord.status) ?? 'Backlog';
          storyRecord.build_estimate_current = this.toNumber(
            storyRecord.build_estimate_current,
            'build_estimate_current',
            rowNumber
          );
          storyRecord.build_original_estimate =
            this.toNumber(
              storyRecord.build_original_estimate,
              'build_original_estimate',
              rowNumber
            ) ??
            storyRecord.build_estimate_current ??
            0;
          storyRecord.build_actual_spent =
            this.toNumber(storyRecord.build_actual_spent, 'build_actual_spent', rowNumber) ?? 0;
          storyRecord.st_estimate_current =
            this.toNumber(storyRecord.st_estimate_current, 'st_estimate_current', rowNumber) ?? 0;
          storyRecord.st_original_estimate =
            this.toNumber(storyRecord.st_original_estimate, 'st_original_estimate', rowNumber) ??
            storyRecord.st_estimate_current ??
            0;
          storyRecord.st_actual_spent =
            this.toNumber(storyRecord.st_actual_spent, 'st_actual_spent', rowNumber) ?? 0;
        }
      } catch (error) {
        errors.push({ rowNumber, message: error.message || String(error) });
        continue;
      }

      if (hasFeatureData) {
        preparedFeatures.push(featureRecord);
      }

      if (hasStoryData && storyRecord.story_id !== null && storyRecord.story_id !== undefined) {
        preparedStories.push(storyRecord);
      }
    }

    return { preparedFeatures, preparedStories, errors, warnings };
  }

  validateWorkbookVersion(workbookVersion) {
    if (workbookVersion === undefined || workbookVersion === null) {
      throw new CSVImportValidationError('workbookVersion is required for CSV confirmation.');
    }

    const valueText = String(workbookVersion).trim();
    if (valueText === '') {
      throw new CSVImportValidationError('workbookVersion is required for CSV confirmation.');
    }

    const normalizedVersion = Number(valueText);
    if (!Number.isInteger(normalizedVersion) || normalizedVersion < 0) {
      throw new CSVImportValidationError(
        'workbookVersion must be a non-negative integer value for CSV confirmation.'
      );
    }

    return normalizedVersion;
  }

  async previewImport({
    csvText,
    mapping,
    _workbookPath = this.workbookPath,
    maxSizeBytes = this.maxSizeBytes,
  }) {
    const workbookService = await this.loadWorkbook({ createIfMissing: false });
    const { headers, rows } = this.parseCsvText(csvText, { maxSizeBytes });
    const { preparedFeatures, preparedStories, errors, warnings } = this.buildPreparedRows({
      rows,
      mapping,
      workbookService,
    });

    if (errors.length > 0) {
      const detail = errors.map((entry) => `${entry.message}`).join('; ');
      throw new CSVImportValidationError(`CSV preview validation failed: ${detail}`);
    }

    const version = workbookService ? await workbookService.getWorkbookVersion() : 0;
    const records = preparedFeatures.map((featureRecord, index) => ({
      feature: featureRecord,
      story: preparedStories[index] ?? null,
    }));

    return {
      headers,
      rowCount: rows.length,
      mapping: this.normalizeMapping(mapping),
      records,
      features: preparedFeatures,
      stories: preparedStories,
      warnings,
      workbookVersion: version,
    };
  }

  async confirmImport({
    csvText,
    mapping,
    confirmed = false,
    mode = 'add',
    workbookVersion = null,
    _workbookPath = this.workbookPath,
    maxSizeBytes = this.maxSizeBytes,
  } = {}) {
    if (!confirmed) {
      throw new CSVImportValidationError(
        'CSV import confirmation is required before persisting changes.'
      );
    }

    if (!['add', 'replace'].includes(mode)) {
      throw new CSVImportValidationError("Import mode must be either 'add' or 'replace'.");
    }

    const normalizedWorkbookVersion = this.validateWorkbookVersion(workbookVersion);

    const workbookService = await this.loadWorkbook({ createIfMissing: true });
    const { rows } = this.parseCsvText(csvText, { maxSizeBytes });
    const { preparedFeatures, preparedStories, errors, warnings } = this.buildPreparedRows({
      rows,
      mapping,
      workbookService,
    });

    if (errors.length > 0) {
      const detail = errors.map((entry) => `${entry.message}`).join('; ');
      throw new CSVImportValidationError(`CSV import validation failed: ${detail}`);
    }

    const actualVersion = await workbookService.getWorkbookVersion();
    if (normalizedWorkbookVersion !== actualVersion) {
      throw new WorkbookConflictError(normalizedWorkbookVersion, actualVersion);
    }

    try {
      const imported = await workbookService.applyFeatureStoryImport({
        features: preparedFeatures,
        stories: preparedStories,
        mode,
        expectedVersion: actualVersion,
      });

      return {
        confirmed: true,
        mode,
        workbookVersion: actualVersion,
        warnings,
        imported,
      };
    } catch (error) {
      if (error instanceof WorkbookValidationError && !(error instanceof WorkbookConflictError)) {
        throw new CSVImportValidationError(error.message);
      }
      throw error;
    }
  }
}

module.exports = {
  CSVImportService,
  CSVImportValidationError,
};
