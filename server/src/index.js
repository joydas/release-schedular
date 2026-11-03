'use strict';

const path = require('node:path');
const express = require('express');
const multer = require('multer');

const {
  WorkbookService,
  WorkbookConflictError,
  WorkbookValidationError,
  WorkbookReferenceConflictError,
} = require('./services/WorkbookService');
const { CSVImportService, CSVImportValidationError } = require('./services/CSVImportService');
const { PlanComputationError, computePlan } = require('./planning/computePlan');
const {
  FeatureStageSchedulingError,
  scheduleFeatureStages,
} = require('./planning/featureStageScheduling');

const PORT = process.env.PORT || 3001;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_WORKBOOK_PATH = path.resolve(__dirname, '../data/release-scheduler.xlsx');
const workbookPath = process.env.WORKBOOK_PATH || DEFAULT_WORKBOOK_PATH;
const csvImportService = new CSVImportService({ workbookPath, maxSizeBytes: MAX_UPLOAD_BYTES });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
});

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

function parseJsonMapping(mappingInput) {
  if (mappingInput === undefined || mappingInput === null || mappingInput === '') {
    throw new CSVImportValidationError('CSV import mapping is required.');
  }

  if (typeof mappingInput === 'object') {
    return mappingInput;
  }

  if (typeof mappingInput === 'string') {
    try {
      const parsed = JSON.parse(mappingInput);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      throw new CSVImportValidationError('CSV import mapping is not valid JSON.');
    }
  }

  throw new CSVImportValidationError(
    'CSV import mapping must be a JSON object or a parsed object.'
  );
}

function parseExpectedVersion(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new WorkbookValidationError('expectedVersion is required for this mutation.');
  }

  const normalizedVersion = Number(value);
  if (!Number.isInteger(normalizedVersion) || normalizedVersion < 0) {
    throw new WorkbookValidationError(
      'expectedVersion must be a non-negative integer value for this mutation.'
    );
  }

  return normalizedVersion;
}

function normalizeString(value, fieldName, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw new WorkbookValidationError(`${fieldName} is required.`);
    }
    return '';
  }

  const normalized = String(value).trim();
  if (required && normalized === '') {
    throw new WorkbookValidationError(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalDate(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new WorkbookValidationError(`${fieldName} must be a valid date.`);
  }

  return parsedDate;
}

function normalizeOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new WorkbookValidationError(`${fieldName} must be a finite number.`);
  }

  return parsed;
}

function normalizeOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new WorkbookValidationError(`${fieldName} must be an integer.`);
  }

  return parsed;
}

function mapWorkbookError(error) {
  if (error instanceof WorkbookConflictError || error instanceof WorkbookReferenceConflictError) {
    return { status: 409, message: error.message };
  }

  if (error instanceof CSVImportValidationError || error instanceof WorkbookValidationError) {
    const message = String(error.message || '');
    if (/does not exist/i.test(message) || /not found/i.test(message)) {
      return { status: 404, message };
    }

    return { status: 400, message };
  }

  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, message: 'CSV upload exceeds the supported file-size limit.' };
  }

  return { status: 500, message: 'The operation failed unexpectedly.' };
}

function buildPlanningState(service) {
  return {
    teams: service.listTeams(),
    releases: service.listReleases(),
    features: service.listFeatures(),
    stories: service.listUserStories(),
    dependencies: service.listDependencies(),
    capacities: service.listTeamReleaseCapacity(),
    config: service.buildConfigMap(),
  };
}

function sendPlanningError(res, error) {
  if (error instanceof WorkbookConflictError || error instanceof WorkbookReferenceConflictError) {
    return res.status(409).json({
      ok: false,
      code: 'WORKBOOK_CONFLICT',
      error: error.message,
      details: {
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      },
    });
  }

  if (error instanceof PlanComputationError) {
    if (error.code === 'PLAN_COMPUTATION_ERROR') {
      return res.status(500).json({
        ok: false,
        code: 'PLAN_COMPUTATION_ERROR',
        error: 'The plan could not be computed because of an internal error.',
      });
    }
    return res.status(400).json({
      ok: false,
      code: error.code,
      error: error.message,
      stage: error.stage,
      details: error.details,
    });
  }

  if (error instanceof FeatureStageSchedulingError) {
    return res.status(500).json({
      ok: false,
      code: 'SCHEDULE_COMPUTATION_ERROR',
      error: 'The feature schedule could not be computed.',
    });
  }

  if (error instanceof WorkbookValidationError) {
    const message = /unable to read workbook|filesystem|enoent|eacces|eperm/i.test(error.message)
      ? 'Workbook data could not be read.'
      : error.message;
    return res.status(400).json({
      ok: false,
      code: 'INVALID_WORKBOOK_STATE',
      error: message,
    });
  }

  return res.status(500).json({
    ok: false,
    code: 'INTERNAL_SERVER_ERROR',
    error: 'The plan could not be computed because of an internal error.',
  });
}

// ─── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/plan/compute', async (req, res) => {
  try {
    if (
      req.body !== undefined &&
      (!req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length > 0)
    ) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error:
          'POST /api/plan/compute reads the current workbook and does not accept planning state in the request body.',
      });
    }

    const service = await WorkbookService.create({ workbookPath });
    await service.assertWorkbookNotStale();
    const workbookVersion = await service.getWorkbookVersion();
    const state = buildPlanningState(service);
    const plan = computePlan(state);
    await service.assertWorkbookNotStale({ expectedVersion: workbookVersion });

    return res.status(200).json({ ok: true, data: plan, workbookVersion });
  } catch (error) {
    return sendPlanningError(res, error);
  }
});

app.post('/api/plan/scenario', async (req, res) => {
  try {
    const body = req.body;
    const overrides = body?.featureOverrides ?? {};
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['globalPercent', 'featureOverrides'].includes(key)) ||
      !Number.isFinite(body.globalPercent) ||
      body.globalPercent < 0 ||
      body.globalPercent > 50 ||
      !overrides ||
      typeof overrides !== 'object' ||
      Array.isArray(overrides) ||
      Object.values(overrides).some(
        (value) => !Number.isFinite(value) || value < 0 || value > 50
      )
    ) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_SCENARIO_INPUT',
        error: 'globalPercent and feature override percentages must be between 0 and 50.',
      });
    }

    const service = await WorkbookService.create({ workbookPath });
    await service.assertWorkbookNotStale();
    const workbookVersion = await service.getWorkbookVersion();
    const state = buildPlanningState(service);
    const featureIds = new Set(state.features.map((feature) => String(feature.feature_id)));
    if (Object.keys(overrides).some((featureId) => !featureIds.has(String(featureId)))) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_SCENARIO_FEATURE',
        error: 'A feature override refers to a feature that does not exist.',
      });
    }
    const scenarioState = {
      ...state,
      features: state.features.map((feature) => {
        const percent = Object.hasOwn(overrides, String(feature.feature_id))
          ? overrides[String(feature.feature_id)]
          : body.globalPercent;
        const multiplier = 1 + percent / 100;
        return {
          ...feature,
          build_estimate_current: Number(feature.build_estimate_current) * multiplier,
          st_estimate_current: Number(feature.st_estimate_current) * multiplier,
        };
      }),
    };
    const plan = computePlan(scenarioState);
    const data = scheduleFeatureStages(plan, {
      releases: state.releases,
      capacities: state.capacities,
    });
    await service.assertWorkbookNotStale({ expectedVersion: workbookVersion });
    return res.status(200).json({ ok: true, data: { plan, featureSchedule: data }, workbookVersion });
  } catch (error) {
    return sendPlanningError(res, error);
  }
});

app.post('/api/plan/schedule', async (req, res) => {
  try {
    const body = req.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'expectedVersion,plan' ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0 ||
      !body.plan ||
      typeof body.plan !== 'object' ||
      Array.isArray(body.plan)
    ) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'POST /api/plan/schedule requires the computed plan and its workbookVersion.',
      });
    }

    const service = await WorkbookService.create({ workbookPath });
    await service.assertWorkbookNotStale();
    const workbookVersion = await service.getWorkbookVersion();
    if (body.expectedVersion !== workbookVersion) {
      return res.status(409).json({
        ok: false,
        code: 'WORKBOOK_CONFLICT',
        error: 'The workbook changed after this plan was computed. Refresh the plan and retry.',
        details: { expectedVersion: body.expectedVersion, actualVersion: workbookVersion },
      });
    }

    const state = buildPlanningState(service);
    const canonicalPlan = computePlan(state);
    if (JSON.stringify(body.plan) !== JSON.stringify(canonicalPlan)) {
      return res.status(409).json({
        ok: false,
        code: 'PLAN_SNAPSHOT_MISMATCH',
        error:
          'The submitted plan does not match the current workbook snapshot. Refresh and retry.',
        details: { expectedVersion: body.expectedVersion, actualVersion: workbookVersion },
      });
    }

    const data = scheduleFeatureStages(canonicalPlan, {
      releases: state.releases,
      capacities: state.capacities,
    });
    await service.assertWorkbookNotStale({ expectedVersion: workbookVersion });
    return res.status(200).json({ ok: true, data, workbookVersion });
  } catch (error) {
    return sendPlanningError(res, error);
  }
});

/**
 * GET /api/health
 * Liveness check — confirms the server process is running and accepting requests.
 * Returns HTTP 200 with a small JSON payload.
 */
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'release-scheduler-server',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', async (_req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const data = Object.fromEntries(
      service
        .listConfig()
        .filter((row) => row.config_key !== 'workbook_version')
        .map((row) => [row.config_key, service.deserializeConfigValue(row)])
    );

    res.status(200).json({ ok: true, data, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/config', async (req, res) => {
  try {
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? { ...req.body } : {};
    const expectedVersion = parseExpectedVersion(payload.expectedVersion);
    const updatePayload =
      payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config)
        ? { ...payload.config }
        : payload;
    delete updatePayload.expectedVersion;

    if (Object.keys(updatePayload).length === 0) {
      throw new WorkbookValidationError('At least one config value must be provided.');
    }

    const service = await WorkbookService.create({ workbookPath });
    const data = await service.updateConfigValues(updatePayload, { expectedVersion });

    res.status(200).json({ ok: true, data, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.post('/api/import/csv/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      throw new CSVImportValidationError('A CSV file upload is required.');
    }

    const mapping = parseJsonMapping(req.body?.mapping ?? req.body?.columns ?? req.body?.fieldMap);
    const preview = await csvImportService.previewImport({
      csvText: req.file.buffer,
      mapping,
      workbookPath,
      maxSizeBytes: MAX_UPLOAD_BYTES,
    });

    res.status(200).json({
      ok: true,
      ...preview,
    });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({
      ok: false,
      error: mapped.message,
    });
  }
});

app.post('/api/import/csv/confirm', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      throw new CSVImportValidationError('A CSV file upload is required for confirmation.');
    }

    const mapping = parseJsonMapping(req.body?.mapping ?? req.body?.columns ?? req.body?.fieldMap);
    const mode = String(req.body?.mode ?? '').trim();
    const confirmed =
      req.body?.confirmed === true ||
      req.body?.confirm === true ||
      String(req.body?.confirmed ?? req.body?.confirm ?? '').toLowerCase() === 'true';
    const workbookVersion = csvImportService.validateWorkbookVersion(req.body?.workbookVersion);

    if (!confirmed) {
      throw new CSVImportValidationError(
        'Explicit confirmation is required before the CSV import is persisted.'
      );
    }

    if (!['add', 'replace'].includes(mode)) {
      throw new CSVImportValidationError(
        "Import mode is required and must be either 'add' or 'replace'."
      );
    }

    const result = await csvImportService.confirmImport({
      csvText: req.file.buffer,
      mapping,
      confirmed,
      mode,
      workbookVersion,
      workbookPath,
      maxSizeBytes: MAX_UPLOAD_BYTES,
    });

    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({
      ok: false,
      error: mapped.message,
    });
  }
});

app.get('/api/teams', async (_req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const data = service.listTeams();
    res.status(200).json({ ok: true, data, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const teamId = normalizeString(req.body?.team_id, 'team_id');
    const teamName = normalizeString(req.body?.team_name, 'team_name');
    const status = normalizeString(req.body?.status, 'status');

    if (service.getTeam(teamId)) {
      throw new WorkbookConflictError(expectedVersion, await service.getWorkbookVersion());
    }

    const teamRecord = {
      team_id: teamId,
      team_name: teamName,
      status,
      notes: req.body?.notes ?? null,
      created_at: req.body?.created_at ?? new Date(),
      updated_at: req.body?.updated_at ?? new Date(),
    };

    const result = await service.upsertTeam(teamRecord, { expectedVersion });
    res
      .status(201)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/teams/:id', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const team = service.getTeam(req.params.id);
    if (!team) {
      throw new WorkbookValidationError(`Team ${req.params.id} does not exist.`);
    }

    res
      .status(200)
      .json({ ok: true, data: team, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/teams/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getTeam(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Team ${req.params.id} does not exist.`);
    }

    const nextRecord = {
      ...current,
      ...req.body,
      team_id: req.params.id,
      team_name: normalizeString(req.body?.team_name ?? current.team_name, 'team_name'),
      status: normalizeString(req.body?.status ?? current.status, 'status'),
      notes: req.body?.notes === undefined ? current.notes : req.body.notes,
      updated_at: new Date(),
    };

    const result = await service.upsertTeam(nextRecord, { expectedVersion });
    res
      .status(200)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getTeam(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Team ${req.params.id} does not exist.`);
    }

    await service.deleteTeam(req.params.id, { expectedVersion });
    res.status(200).json({ ok: true, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/releases', async (_req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    res.status(200).json({
      ok: true,
      data: service.listReleases(),
      workbookVersion: await service.getWorkbookVersion(),
    });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/releases/:id', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const release = service.getRelease(req.params.id);
    if (!release) {
      throw new WorkbookValidationError(`Release ${req.params.id} does not exist.`);
    }

    res
      .status(200)
      .json({ ok: true, data: release, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.post('/api/releases', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const releaseId = normalizeString(req.body?.release_id, 'release_id');
    const releaseName = normalizeString(req.body?.release_name, 'release_name');
    const status = normalizeString(req.body?.status, 'status');
    const startDate = normalizeOptionalDate(req.body?.start_date, 'start_date');
    const endDate = normalizeOptionalDate(req.body?.end_date, 'end_date');
    const targetDate = normalizeOptionalDate(req.body?.target_date, 'target_date');
    const priorityOrder = normalizeOptionalInteger(req.body?.priority_order, 'priority_order');

    if (startDate && endDate && startDate > endDate) {
      throw new WorkbookValidationError('start_date must be on or before end_date.');
    }

    if (service.getRelease(releaseId)) {
      throw new WorkbookConflictError(expectedVersion, await service.getWorkbookVersion());
    }

    const releaseRecord = {
      release_id: releaseId,
      release_name: releaseName,
      status,
      start_date: startDate,
      end_date: endDate,
      target_date: targetDate,
      priority_order: priorityOrder,
      created_at: req.body?.created_at ?? new Date(),
      updated_at: req.body?.updated_at ?? new Date(),
    };

    const result = await service.upsertRelease(releaseRecord, { expectedVersion });
    res
      .status(201)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/releases/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getRelease(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Release ${req.params.id} does not exist.`);
    }

    const merged = {
      ...current,
      ...req.body,
      release_id: req.params.id,
      release_name: normalizeString(req.body?.release_name ?? current.release_name, 'release_name'),
      status: normalizeString(req.body?.status ?? current.status, 'status'),
      start_date: normalizeOptionalDate(req.body?.start_date ?? current.start_date, 'start_date'),
      end_date: normalizeOptionalDate(req.body?.end_date ?? current.end_date, 'end_date'),
      target_date: normalizeOptionalDate(
        req.body?.target_date ?? current.target_date,
        'target_date'
      ),
      priority_order:
        normalizeOptionalInteger(
          req.body?.priority_order ?? current.priority_order,
          'priority_order'
        ) ?? current.priority_order,
      updated_at: new Date(),
    };

    if (
      merged.start_date &&
      merged.end_date &&
      new Date(merged.start_date) > new Date(merged.end_date)
    ) {
      throw new WorkbookValidationError('start_date must be on or before end_date.');
    }

    const result = await service.upsertRelease(merged, { expectedVersion });
    res
      .status(200)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.delete('/api/releases/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getRelease(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Release ${req.params.id} does not exist.`);
    }
    await service.deleteRelease(req.params.id, { expectedVersion });
    res.status(200).json({ ok: true, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/features', async (_req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    res.status(200).json({
      ok: true,
      data: service.listFeatures(),
      workbookVersion: await service.getWorkbookVersion(),
    });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/features/:id', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const feature = service.getFeature(req.params.id);
    if (!feature) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    res
      .status(200)
      .json({ ok: true, data: feature, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.post('/api/features', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const featureId = normalizeString(req.body?.feature_id, 'feature_id');
    if (service.getFeature(featureId)) {
      throw new WorkbookConflictError(expectedVersion, await service.getWorkbookVersion());
    }

    const featureRecord = {
      feature_id: featureId,
      release_id: normalizeString(req.body?.release_id, 'release_id', { required: false }),
      feature_name: normalizeString(req.body?.feature_name, 'feature_name'),
      priority: normalizeOptionalInteger(req.body?.priority, 'priority'),
      input_order: normalizeOptionalInteger(req.body?.input_order, 'input_order'),
      team_id:
        req.body?.team_id === undefined ||
        req.body?.team_id === null ||
        String(req.body.team_id).trim() === ''
          ? null
          : String(req.body.team_id).trim(),
      status: normalizeString(req.body?.status, 'status'),
      build_estimate_current:
        normalizeOptionalNumber(req.body?.build_estimate_current, 'build_estimate_current') ?? 0,
      build_original_estimate:
        normalizeOptionalNumber(req.body?.build_original_estimate, 'build_original_estimate') ?? 0,
      build_actual_spent:
        normalizeOptionalNumber(req.body?.build_actual_spent, 'build_actual_spent') ?? 0,
      st_estimate_current:
        normalizeOptionalNumber(req.body?.st_estimate_current, 'st_estimate_current') ?? 0,
      st_original_estimate:
        normalizeOptionalNumber(req.body?.st_original_estimate, 'st_original_estimate') ?? 0,
      st_actual_spent: normalizeOptionalNumber(req.body?.st_actual_spent, 'st_actual_spent') ?? 0,
      created_at: req.body?.created_at ?? new Date(),
      updated_at: req.body?.updated_at ?? new Date(),
    };

    const result = await service.upsertFeature(featureRecord, { expectedVersion });
    res
      .status(201)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/features/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getFeature(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    const nextRecord = {
      ...current,
      ...req.body,
      feature_id: req.params.id,
      release_id: normalizeString(req.body?.release_id ?? current.release_id, 'release_id', {
        required: false,
      }),
      feature_name: normalizeString(req.body?.feature_name ?? current.feature_name, 'feature_name'),
      priority:
        normalizeOptionalInteger(req.body?.priority ?? current.priority, 'priority') ??
        current.priority,
      input_order:
        normalizeOptionalInteger(req.body?.input_order ?? current.input_order, 'input_order') ??
        current.input_order,
      team_id:
        req.body?.team_id === undefined
          ? current.team_id
          : String(req.body.team_id).trim() === ''
            ? null
            : String(req.body.team_id).trim(),
      status: normalizeString(req.body?.status ?? current.status, 'status'),
      build_estimate_current:
        normalizeOptionalNumber(
          req.body?.build_estimate_current ?? current.build_estimate_current,
          'build_estimate_current'
        ) ?? current.build_estimate_current,
      build_original_estimate:
        normalizeOptionalNumber(
          req.body?.build_original_estimate ?? current.build_original_estimate,
          'build_original_estimate'
        ) ?? current.build_original_estimate,
      build_actual_spent:
        normalizeOptionalNumber(
          req.body?.build_actual_spent ?? current.build_actual_spent,
          'build_actual_spent'
        ) ?? current.build_actual_spent,
      st_estimate_current:
        normalizeOptionalNumber(
          req.body?.st_estimate_current ?? current.st_estimate_current,
          'st_estimate_current'
        ) ?? current.st_estimate_current,
      st_original_estimate:
        normalizeOptionalNumber(
          req.body?.st_original_estimate ?? current.st_original_estimate,
          'st_original_estimate'
        ) ?? current.st_original_estimate,
      st_actual_spent:
        normalizeOptionalNumber(
          req.body?.st_actual_spent ?? current.st_actual_spent,
          'st_actual_spent'
        ) ?? current.st_actual_spent,
      updated_at: new Date(),
    };

    const result = await service.upsertFeature(nextRecord, { expectedVersion });
    res
      .status(200)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.delete('/api/features/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getFeature(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }
    await service.deleteFeature(req.params.id, { expectedVersion });
    res.status(200).json({ ok: true, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/features/:id/stories', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const feature = service.getFeature(req.params.id);
    if (!feature) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    const stories = service.listUserStories().filter((story) => story.feature_id === req.params.id);
    res
      .status(200)
      .json({ ok: true, data: stories, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/features/:id/stories/:storyId', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const feature = service.getFeature(req.params.id);
    if (!feature) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    const story = service.getUserStory(req.params.storyId);
    if (!story) {
      throw new WorkbookValidationError(`User story ${req.params.storyId} does not exist.`);
    }

    if (story.feature_id !== req.params.id) {
      throw new WorkbookValidationError(
        `User story ${req.params.storyId} does not belong to feature ${req.params.id}.`
      );
    }

    res
      .status(200)
      .json({ ok: true, data: story, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.post('/api/features/:id/stories', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const feature = service.getFeature(req.params.id);
    if (!feature) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    const storyId = normalizeString(req.body?.story_id, 'story_id');
    const storyName = normalizeString(req.body?.story_name, 'story_name');
    if (service.getUserStory(storyId)) {
      throw new WorkbookConflictError(expectedVersion, await service.getWorkbookVersion());
    }

    const storyRecord = {
      story_id: storyId,
      feature_id: req.params.id,
      story_name: storyName,
      input_order: normalizeOptionalInteger(req.body?.input_order, 'input_order') ?? 1,
      status: normalizeString(req.body?.status, 'status'),
      build_estimate_current:
        normalizeOptionalNumber(req.body?.build_estimate_current, 'build_estimate_current') ?? 0,
      build_original_estimate:
        normalizeOptionalNumber(req.body?.build_original_estimate, 'build_original_estimate') ?? 0,
      build_actual_spent:
        normalizeOptionalNumber(req.body?.build_actual_spent, 'build_actual_spent') ?? 0,
      st_estimate_current:
        normalizeOptionalNumber(req.body?.st_estimate_current, 'st_estimate_current') ?? 0,
      st_original_estimate:
        normalizeOptionalNumber(req.body?.st_original_estimate, 'st_original_estimate') ?? 0,
      st_actual_spent: normalizeOptionalNumber(req.body?.st_actual_spent, 'st_actual_spent') ?? 0,
      created_at: req.body?.created_at ?? new Date(),
      updated_at: req.body?.updated_at ?? new Date(),
    };

    const result = await service.upsertUserStory(storyRecord, { expectedVersion });
    res
      .status(201)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/features/:id/stories/:storyId', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const feature = service.getFeature(req.params.id);
    if (!feature) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    const current = service.getUserStory(req.params.storyId);
    if (!current) {
      throw new WorkbookValidationError(`User story ${req.params.storyId} does not exist.`);
    }

    if (current.feature_id !== req.params.id) {
      throw new WorkbookValidationError(
        `User story ${req.params.storyId} does not belong to feature ${req.params.id}.`
      );
    }

    const nextRecord = {
      ...current,
      ...req.body,
      story_id: req.params.storyId,
      feature_id: req.params.id,
      story_name: normalizeString(req.body?.story_name ?? current.story_name, 'story_name'),
      input_order:
        normalizeOptionalInteger(req.body?.input_order ?? current.input_order, 'input_order') ??
        current.input_order,
      status: normalizeString(req.body?.status ?? current.status, 'status'),
      build_estimate_current:
        normalizeOptionalNumber(
          req.body?.build_estimate_current ?? current.build_estimate_current,
          'build_estimate_current'
        ) ?? current.build_estimate_current,
      build_original_estimate:
        normalizeOptionalNumber(
          req.body?.build_original_estimate ?? current.build_original_estimate,
          'build_original_estimate'
        ) ?? current.build_original_estimate,
      build_actual_spent:
        normalizeOptionalNumber(
          req.body?.build_actual_spent ?? current.build_actual_spent,
          'build_actual_spent'
        ) ?? current.build_actual_spent,
      st_estimate_current:
        normalizeOptionalNumber(
          req.body?.st_estimate_current ?? current.st_estimate_current,
          'st_estimate_current'
        ) ?? current.st_estimate_current,
      st_original_estimate:
        normalizeOptionalNumber(
          req.body?.st_original_estimate ?? current.st_original_estimate,
          'st_original_estimate'
        ) ?? current.st_original_estimate,
      st_actual_spent:
        normalizeOptionalNumber(
          req.body?.st_actual_spent ?? current.st_actual_spent,
          'st_actual_spent'
        ) ?? current.st_actual_spent,
      updated_at: new Date(),
    };

    const result = await service.upsertUserStory(nextRecord, { expectedVersion });
    res
      .status(200)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.delete('/api/features/:id/stories/:storyId', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const feature = service.getFeature(req.params.id);
    if (!feature) {
      throw new WorkbookValidationError(`Feature ${req.params.id} does not exist.`);
    }

    const current = service.getUserStory(req.params.storyId);
    if (!current) {
      throw new WorkbookValidationError(`User story ${req.params.storyId} does not exist.`);
    }
    if (current.feature_id !== req.params.id) {
      throw new WorkbookValidationError(
        `User story ${req.params.storyId} does not belong to feature ${req.params.id}.`
      );
    }

    await service.deleteUserStory(req.params.storyId, { expectedVersion });
    res.status(200).json({ ok: true, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/dependencies', async (_req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    res.status(200).json({
      ok: true,
      data: service.listDependencies(),
      workbookVersion: await service.getWorkbookVersion(),
    });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/dependencies/:id', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const dependency = service.getDependency(req.params.id);
    if (!dependency) {
      throw new WorkbookValidationError(`Dependency ${req.params.id} does not exist.`);
    }

    res
      .status(200)
      .json({ ok: true, data: dependency, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.post('/api/dependencies', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const dependencyId = normalizeString(req.body?.dependency_id, 'dependency_id');
    if (service.getDependency(dependencyId)) {
      throw new WorkbookConflictError(expectedVersion, await service.getWorkbookVersion());
    }

    const dependencyRecord = {
      dependency_id: dependencyId,
      predecessor_feature_id: normalizeString(
        req.body?.predecessor_feature_id,
        'predecessor_feature_id'
      ),
      dependent_feature_id: normalizeString(req.body?.dependent_feature_id, 'dependent_feature_id'),
      dependency_type: normalizeString(req.body?.dependency_type, 'dependency_type'),
      affected_activity: req.body?.affected_activity ?? null,
      blocking_pct: req.body?.blocking_pct ?? null,
      dependency_status: normalizeString(req.body?.dependency_status, 'dependency_status'),
      responsible_team_id: req.body?.responsible_team_id ?? null,
      notes: req.body?.notes ?? null,
      created_at: req.body?.created_at ?? new Date(),
      updated_at: req.body?.updated_at ?? new Date(),
    };

    const result = await service.upsertDependency(dependencyRecord, { expectedVersion });
    res
      .status(201)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/dependencies/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getDependency(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Dependency ${req.params.id} does not exist.`);
    }

    const nextRecord = {
      ...current,
      ...req.body,
      dependency_id: req.params.id,
      predecessor_feature_id: normalizeString(
        req.body?.predecessor_feature_id ?? current.predecessor_feature_id,
        'predecessor_feature_id'
      ),
      dependent_feature_id: normalizeString(
        req.body?.dependent_feature_id ?? current.dependent_feature_id,
        'dependent_feature_id'
      ),
      dependency_type: normalizeString(
        req.body?.dependency_type ?? current.dependency_type,
        'dependency_type'
      ),
      dependency_status: normalizeString(
        req.body?.dependency_status ?? current.dependency_status,
        'dependency_status'
      ),
      affected_activity:
        req.body?.affected_activity === undefined
          ? current.affected_activity
          : req.body.affected_activity,
      blocking_pct:
        req.body?.blocking_pct === undefined ? current.blocking_pct : req.body.blocking_pct,
      responsible_team_id:
        req.body?.responsible_team_id === undefined
          ? current.responsible_team_id
          : req.body.responsible_team_id,
      notes: req.body?.notes === undefined ? current.notes : req.body.notes,
      updated_at: new Date(),
    };

    const result = await service.upsertDependency(nextRecord, { expectedVersion });
    res
      .status(200)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.delete('/api/dependencies/:id', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });
    const current = service.getDependency(req.params.id);
    if (!current) {
      throw new WorkbookValidationError(`Dependency ${req.params.id} does not exist.`);
    }
    await service.deleteDependency(req.params.id, { expectedVersion });
    res.status(200).json({ ok: true, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/capacities', async (_req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    res.status(200).json({
      ok: true,
      data: service.listTeamReleaseCapacity(),
      workbookVersion: await service.getWorkbookVersion(),
    });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.get('/api/capacities/:teamId/:releaseId', async (req, res) => {
  try {
    const service = await WorkbookService.create({ workbookPath });
    const team = service.getTeam(req.params.teamId);
    if (!team) {
      throw new WorkbookValidationError(`Team ${req.params.teamId} does not exist.`);
    }

    const release = service.getRelease(req.params.releaseId);
    if (!release) {
      throw new WorkbookValidationError(`Release ${req.params.releaseId} does not exist.`);
    }

    const capacity = service.getTeamReleaseCapacity(req.params.teamId, req.params.releaseId);
    if (!capacity) {
      throw new WorkbookValidationError(
        `Team/release capacity for team ${req.params.teamId} and release ${req.params.releaseId} does not exist.`
      );
    }

    res
      .status(200)
      .json({ ok: true, data: capacity, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

app.put('/api/capacities/:teamId/:releaseId', async (req, res) => {
  try {
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const service = await WorkbookService.create({ workbookPath });

    const team = service.getTeam(req.params.teamId);
    if (!team) {
      throw new WorkbookValidationError(`Team ${req.params.teamId} does not exist.`);
    }

    const release = service.getRelease(req.params.releaseId);
    if (!release) {
      throw new WorkbookValidationError(`Release ${req.params.releaseId} does not exist.`);
    }

    const buildCapacity = normalizeOptionalNumber(req.body?.build_capacity, 'build_capacity');
    if (buildCapacity === null || buildCapacity === undefined) {
      throw new WorkbookValidationError('build_capacity is required.');
    }
    if (!Number.isFinite(buildCapacity) || buildCapacity < 0) {
      throw new WorkbookValidationError('build_capacity must be a finite non-negative number.');
    }

    const stCapacity = normalizeOptionalNumber(req.body?.st_capacity, 'st_capacity');
    if (stCapacity === null || stCapacity === undefined) {
      throw new WorkbookValidationError('st_capacity is required.');
    }
    if (!Number.isFinite(stCapacity) || stCapacity < 0) {
      throw new WorkbookValidationError('st_capacity must be a finite non-negative number.');
    }

    const existing = service.getTeamReleaseCapacity(req.params.teamId, req.params.releaseId);
    const capacityRecord = {
      team_id: req.params.teamId,
      release_id: req.params.releaseId,
      build_capacity: buildCapacity,
      st_capacity: stCapacity,
      capacity_source: req.body?.capacity_source ?? existing?.capacity_source ?? 'Manual',
      created_at: req.body?.created_at ?? existing?.created_at ?? new Date(),
      updated_at: new Date(),
    };

    const result = await service.upsertTeamReleaseCapacity(capacityRecord, { expectedVersion });
    res
      .status(200)
      .json({ ok: true, data: result, workbookVersion: await service.getWorkbookVersion() });
  } catch (error) {
    const mapped = mapWorkbookError(error);
    res.status(mapped.status).json({ ok: false, error: mapped.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Release Scheduler server listening on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
