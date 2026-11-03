import React, { useCallback, useEffect, useRef, useState } from 'react';
import { canMutateFromSnapshot, loadConsistentSnapshot } from './teamSnapshot';
import { acquireRequestLock, formatApiError, releaseRequestLock } from './apiErrors';
import {
  replaceRecordFromServer,
  runOptimisticMutation,
  upsertOptimisticRecord,
} from './optimisticRecords';

const FEATURE_ENDPOINTS = ['/api/features', '/api/teams'];

function emptyFeatureForm() {
  return {
    feature_id: '',
    feature_name: '',
    priority: '',
    input_order: '',
    team_id: '',
    status: '',
    build_estimate_current: '',
    st_estimate_current: '',
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function formatEffort(value) {
  if (value === null || value === undefined || value === '') return '—';
  return value;
}

function nextInputOrder(features, teamId) {
  return (
    features
      .filter((feature) => String(feature.team_id ?? '') === String(teamId ?? ''))
      .reduce((highest, feature) => Math.max(highest, Number(feature.input_order) || 0), 0) + 1
  );
}

function validNonNegativeNumber(value) {
  if (value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function validInteger(value) {
  return value !== '' && Number.isInteger(Number(value));
}

export default function FeaturesPage() {
  const [features, setFeatures] = useState([]);
  const [teams, setTeams] = useState([]);
  const [workbookVersion, setWorkbookVersion] = useState(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const snapshotReadyRef = useRef(false);
  const mutationLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyFeatureForm);
  const [editingId, setEditingId] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [expandedStoryIds, setExpandedStoryIds] = useState([]);
  const [storiesByFeature, setStoriesByFeature] = useState({});
  const [loadingStoriesId, setLoadingStoriesId] = useState(null);
  const [storyError, setStoryError] = useState('');

  const loadFeatures = useCallback(async ({ clearError = true } = {}) => {
    setLoading(true);
    if (clearError) setLoadError('');
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setWorkbookVersion(null);
    setForm(emptyFeatureForm());
    setEditingId(null);
    setExpandedStoryIds([]);
    setStoriesByFeature({});
    setStoryError('');

    try {
      const snapshot = await loadConsistentSnapshot(requestJson, FEATURE_ENDPOINTS);
      const [featureResponse, teamResponse] = snapshot.responses;
      setFeatures(Array.isArray(featureResponse.data) ? featureResponse.data : []);
      setTeams(Array.isArray(teamResponse.data) ? teamResponse.data : []);
      setWorkbookVersion(snapshot.workbookVersion);
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
    } catch (error) {
      setLoadError(formatApiError(error, 'Could not load features.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadFeatures({ clearError: false }), 0);
    return () => window.clearTimeout(timer);
  }, [loadFeatures]);

  function clearMessages() {
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function beginCreate() {
    setForm({
      ...emptyFeatureForm(),
      input_order: String(nextInputOrder(features, '')),
    });
    setEditingId(null);
    clearMessages();
  }

  function beginEdit(feature) {
    setForm({
      feature_id: feature.feature_id ?? '',
      feature_name: feature.feature_name ?? '',
      priority: feature.priority ?? '',
      input_order: feature.input_order ?? '',
      team_id: feature.team_id ?? '',
      status: feature.status ?? '',
      build_estimate_current: feature.build_estimate_current ?? 0,
      st_estimate_current: feature.st_estimate_current ?? 0,
    });
    setEditingId(feature.feature_id);
    clearMessages();
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => {
      const updated = { ...current, [name]: value };
      if (name === 'team_id' && !editingId) {
        updated.input_order = String(nextInputOrder(features, value));
      }
      return updated;
    });
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function validateForm() {
    if (!form.feature_id.trim() || !form.feature_name.trim() || !form.status.trim()) {
      return 'Enter a feature ID and name, and provide a status.';
    }
    if (!validInteger(form.priority) || !validInteger(form.input_order)) {
      return 'Priority and input order must be whole numbers.';
    }
    if (
      !validNonNegativeNumber(form.build_estimate_current) ||
      !validNonNegativeNumber(form.st_estimate_current)
    ) {
      return 'Build and ST estimates must be valid non-negative numbers.';
    }
    return '';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearMessages();
    const message = validateForm();
    if (message) {
      setValidationError(message);
      return;
    }
    if (!canMutateFromSnapshot(snapshotReadyRef.current, workbookVersion)) {
      setApiError(
        'A consistent current workbook snapshot is not available. Refresh before saving.'
      );
      return;
    }
    if (!acquireRequestLock(mutationLock)) return;

    const body = {
      expectedVersion: workbookVersion,
      feature_name: form.feature_name.trim(),
      priority: Number(form.priority),
      input_order: Number(form.input_order),
      team_id: form.team_id,
      status: form.status.trim(),
      build_estimate_current: Number(form.build_estimate_current),
      st_estimate_current: Number(form.st_estimate_current),
    };
    const path = editingId ? `/api/features/${encodeURIComponent(editingId)}` : '/api/features';
    const method = editingId ? 'PUT' : 'POST';
    if (!editingId) {
      body.feature_id = form.feature_id.trim();
      body.build_original_estimate = Number(form.build_estimate_current);
      body.build_actual_spent = 0;
      body.st_original_estimate = Number(form.st_estimate_current);
      body.st_actual_spent = 0;
    }

    const previousFeatures = features;
    const submittedForm = form;
    const submittedEditingId = editingId;
    const featureFields = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'expectedVersion')
    );
    const optimisticFeature = {
      ...(editingId ? features.find((feature) => feature.feature_id === editingId) : {}),
      feature_id: editingId || form.feature_id.trim(),
      ...featureFields,
    };
    setSaving(true);
    try {
      await runOptimisticMutation({
        applyOptimistic: () =>
          setFeatures((current) =>
            upsertOptimisticRecord(current, optimisticFeature, 'feature_id')
          ),
        sendMutation: () => requestJson(path, { method, body: JSON.stringify(body) }),
        reconcile: (response) => {
          if (response.data) {
            setFeatures((current) => replaceRecordFromServer(current, response.data, 'feature_id'));
          }
        },
        rollback: () => setFeatures(previousFeatures),
      });
      setSuccessMessage(editingId ? 'Feature updated.' : 'Feature added.');
      await loadFeatures();
    } catch (error) {
      if (error.status === 409) {
        setApiError(
          editingId
            ? 'The workbook changed before this save. Features and team options were refreshed; review the latest feature before reopening Edit.'
            : 'The workbook changed before this save. Features and team options were refreshed; review the latest IDs before retrying.'
        );
        await loadFeatures();
        setForm(submittedForm);
        setEditingId(submittedEditingId);
      } else {
        setApiError(formatApiError(error, 'Could not save the feature.'));
      }
    } finally {
      releaseRequestLock(mutationLock);
      setSaving(false);
    }
  }

  async function toggleStories(feature) {
    const isExpanded = expandedStoryIds.includes(feature.feature_id);
    if (isExpanded) {
      setExpandedStoryIds((current) => current.filter((id) => id !== feature.feature_id));
      return;
    }

    setExpandedStoryIds((current) => [...current, feature.feature_id]);
    setStoryError('');
    const cachedStories = storiesByFeature[feature.feature_id];
    if (cachedStories?.workbookVersion === workbookVersion) return;

    setLoadingStoriesId(feature.feature_id);
    try {
      const result = await requestJson(
        `/api/features/${encodeURIComponent(feature.feature_id)}/stories`
      );
      if (!snapshotReadyRef.current || result.workbookVersion !== workbookVersion) {
        await loadFeatures();
        setStoryError(
          'The workbook changed while loading this story list. Features have been refreshed; expand the story list again to retry.'
        );
        return;
      }
      setStoriesByFeature((current) => ({
        ...current,
        [feature.feature_id]: {
          data: Array.isArray(result.data) ? result.data : [],
          workbookVersion: result.workbookVersion,
        },
      }));
    } catch (error) {
      setStoryError(formatApiError(error, 'Could not load the user stories for this feature.'));
    } finally {
      setLoadingStoriesId(null);
    }
  }

  return (
    <section className="teams-page features-page" aria-labelledby="features-title">
      <div className="page-eyebrow">PLANNING</div>
      <div className="teams-heading-row">
        <div>
          <h1 id="features-title">Features</h1>
          <p className="page-subtitle">
            Plan feature priorities, ownership, and Build/ST estimates.
          </p>
        </div>
        <div className="teams-toolbar">
          <span className="version-label" aria-live="polite">
            Workbook version:{' '}
            {snapshotReady ? workbookVersion : loading ? 'Loading…' : 'Unavailable'}
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => loadFeatures()}
            disabled={loading || saving}
          >
            Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <div className="teams-alert error" role="alert">
          <span>{loadError}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => loadFeatures()}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      <form className="team-form" onSubmit={handleSubmit} noValidate>
        <div className="team-form-heading">
          <div>
            <h2>{editingId ? `Edit ${editingId}` : 'Add a feature'}</h2>
            <p>
              {editingId
                ? 'Update team, priority, ordering, status, and current estimates.'
                : 'The planner predicts release placement from release order, team capacity, dependencies, and team priority.'}
            </p>
          </div>
          {editingId ? (
            <button
              className="text-button"
              type="button"
              onClick={beginCreate}
              disabled={saving || !snapshotReady}
            >
              Cancel edit
            </button>
          ) : (
            <button
              className="text-button"
              type="button"
              onClick={beginCreate}
              disabled={loading || !snapshotReady}
            >
              New feature
            </button>
          )}
        </div>

        {validationError && (
          <div className="form-message error" role="alert">
            {validationError}
          </div>
        )}
        {apiError && (
          <div className="form-message error" role="alert">
            {apiError}
          </div>
        )}
        {successMessage && (
          <div className="form-message success" role="status">
            {successMessage}
          </div>
        )}

        <div className="feature-form-grid">
          <label className="form-field">
            <span>
              Feature ID <span className="required-mark">*</span>
            </span>
            <input
              autoComplete="off"
              disabled={Boolean(editingId) || saving || loading || !snapshotReady}
              name="feature_id"
              onChange={handleChange}
              required
              value={form.feature_id}
            />
          </label>
          <label className="form-field">
            <span>
              Feature name <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              name="feature_name"
              onChange={handleChange}
              required
              value={form.feature_name}
            />
          </label>
          <label className="form-field">
            <span>
              Team <span className="optional-label">Optional</span>
            </span>
            <select
              disabled={saving || loading || !snapshotReady}
              name="team_id"
              onChange={handleChange}
              value={form.team_id}
            >
              <option value="">Unassigned</option>
              {teams.map((team) => (
                <option key={team.team_id} value={team.team_id}>
                  {team.team_name} ({team.team_id})
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>
              Priority <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              name="priority"
              onChange={handleChange}
              required
              step="1"
              type="number"
              value={form.priority}
            />
            <small className="field-note">
              Lower numbers run first across the team&apos;s release plan.
            </small>
          </label>
          <label className="form-field">
            <span>
              Input order in team <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              name="input_order"
              onChange={handleChange}
              required
              step="1"
              type="number"
              value={form.input_order}
            />
            <small className="field-note">
              Assigned automatically for new features; adjust to break priority ties.
            </small>
          </label>
          <label className="form-field">
            <span>
              Status <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              name="status"
              onChange={handleChange}
              required
              value={form.status}
            />
          </label>
          <div className="effort-editor-group">
            <h3>Current estimates</h3>
            <div className="effort-inputs">
              <label className="form-field">
                <span>
                  Build estimate <span className="required-mark">*</span>
                </span>
                <input
                  disabled={saving || loading || !snapshotReady}
                  min="0"
                  name="build_estimate_current"
                  onChange={handleChange}
                  required
                  step="any"
                  type="number"
                  value={form.build_estimate_current}
                />
              </label>
              <label className="form-field">
                <span>
                  ST estimate <span className="required-mark">*</span>
                </span>
                <input
                  disabled={saving || loading || !snapshotReady}
                  min="0"
                  name="st_estimate_current"
                  onChange={handleChange}
                  required
                  step="any"
                  type="number"
                  value={form.st_estimate_current}
                />
              </label>
            </div>
          </div>
          <div className="effort-readonly-group">
            <h3>
              Original baseline <span>Read only</span>
            </h3>
            <div className="effort-readonly-grid">
              <span>
                Build{' '}
                <strong>
                  {editingId
                    ? formatEffort(
                        features.find((item) => item.feature_id === editingId)
                          ?.build_original_estimate
                      )
                    : formatEffort(
                        form.build_estimate_current === ''
                          ? ''
                          : Number(form.build_estimate_current)
                      )}
                </strong>
              </span>
              <span>
                ST{' '}
                <strong>
                  {editingId
                    ? formatEffort(
                        features.find((item) => item.feature_id === editingId)?.st_original_estimate
                      )
                    : formatEffort(
                        form.st_estimate_current === '' ? '' : Number(form.st_estimate_current)
                      )}
                </strong>
              </span>
            </div>
          </div>
          <div className="effort-readonly-group">
            <h3>
              Actual spent <span>Read only</span>
            </h3>
            <div className="effort-readonly-grid">
              <span>
                Build{' '}
                <strong>
                  {editingId
                    ? formatEffort(
                        features.find((item) => item.feature_id === editingId)?.build_actual_spent
                      )
                    : '0'}
                </strong>
              </span>
              <span>
                ST{' '}
                <strong>
                  {editingId
                    ? formatEffort(
                        features.find((item) => item.feature_id === editingId)?.st_actual_spent
                      )
                    : '0'}
                </strong>
              </span>
            </div>
          </div>
        </div>
        <div className="team-form-actions">
          {editingId && (
            <button
              className="secondary-button"
              type="button"
              onClick={beginCreate}
              disabled={saving}
            >
              Cancel
            </button>
          )}
          <button
            className="primary-button"
            type="submit"
            disabled={saving || loading || !snapshotReady || Boolean(loadError)}
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add feature'}
          </button>
        </div>
      </form>

      {storyError && (
        <div className="teams-alert error" role="alert">
          {storyError}
        </div>
      )}

      <section className="team-list-section" aria-labelledby="feature-list-title">
        <div className="team-list-heading">
          <div>
            <h2 id="feature-list-title">Feature plan</h2>
            <p>
              {features.length} {features.length === 1 ? 'feature' : 'features'} · workbook order
            </p>
          </div>
        </div>
        {loading ? (
          <div className="teams-state" role="status">
            Loading features…
          </div>
        ) : features.length === 0 ? (
          <div className="teams-state empty-state">
            <span className="empty-symbol" aria-hidden="true">
              ＋
            </span>
            <strong>No features yet</strong>
            <p>Add a feature above to begin planning work.</p>
          </div>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table feature-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Team</th>
                  <th scope="col">Priority / order</th>
                  <th scope="col">Status</th>
                  <th scope="col">Build current / original / spent</th>
                  <th scope="col">ST current / original / spent</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature) => {
                  const team = teams.find((item) => item.team_id === feature.team_id);
                  const isExpanded = expandedStoryIds.includes(feature.feature_id);
                  const storyResult = storiesByFeature[feature.feature_id];
                  return (
                    <React.Fragment key={feature.feature_id}>
                      <tr>
                        <td data-label="Feature">
                          <strong>{feature.feature_name}</strong>
                          <small className="release-id">{feature.feature_id}</small>
                        </td>
                        <td data-label="Team">{team?.team_name ?? 'Unassigned'}</td>
                        <td data-label="Priority / order">
                          {feature.priority} / {feature.input_order}
                        </td>
                        <td data-label="Status">
                          <span className="team-status">{feature.status}</span>
                        </td>
                        <td data-label="Build current / original / spent">
                          {formatEffort(feature.build_estimate_current)} /{' '}
                          {formatEffort(feature.build_original_estimate)} /{' '}
                          {formatEffort(feature.build_actual_spent)}
                        </td>
                        <td data-label="ST current / original / spent">
                          {formatEffort(feature.st_estimate_current)} /{' '}
                          {formatEffort(feature.st_original_estimate)} /{' '}
                          {formatEffort(feature.st_actual_spent)}
                        </td>
                        <td className="feature-actions" data-label="Actions">
                          <button
                            className="row-action"
                            type="button"
                            onClick={() => beginEdit(feature)}
                            disabled={saving || !snapshotReady}
                            aria-label={`Edit ${feature.feature_name}`}
                          >
                            Edit
                          </button>
                          <button
                            className="row-action"
                            type="button"
                            onClick={() => toggleStories(feature)}
                            disabled={!snapshotReady || loadingStoriesId === feature.feature_id}
                            aria-expanded={isExpanded}
                            aria-controls={`stories-${feature.feature_id}`}
                          >
                            {isExpanded ? 'Hide stories' : 'Stories'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="story-detail-row">
                          <td colSpan="8" id={`stories-${feature.feature_id}`}>
                            {loadingStoriesId === feature.feature_id ? (
                              <div className="teams-state" role="status">
                                Loading user stories…
                              </div>
                            ) : storyResult?.workbookVersion === workbookVersion ? (
                              storyResult.data.length ? (
                                <div className="story-list">
                                  <h3>
                                    User stories <span>Read only</span>
                                  </h3>
                                  {storyResult.data.map((story) => (
                                    <div className="story-item" key={story.story_id}>
                                      <div>
                                        <strong>{story.story_name}</strong>
                                        <small>
                                          {story.story_id} · {story.status}
                                        </small>
                                      </div>
                                      <span>
                                        Build {formatEffort(story.build_estimate_current)}
                                      </span>
                                      <span>ST {formatEffort(story.st_estimate_current)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="teams-state">
                                  No user stories are linked to this feature.
                                </div>
                              )
                            ) : (
                              <div className="teams-state">
                                Story details are not available in this workbook snapshot. Collapse
                                and retry after refreshing.
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
