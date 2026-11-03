import React, { useCallback, useEffect, useRef, useState } from 'react';
import { canMutateFromSnapshot, loadConsistentSnapshot } from './teamSnapshot';
import { acquireRequestLock, formatApiError, releaseRequestLock } from './apiErrors';
import {
  replaceRecordFromServer,
  runOptimisticMutation,
  upsertOptimisticRecord,
} from './optimisticRecords';

function emptyStoryForm() {
  return {
    story_id: '',
    story_name: '',
    input_order: '',
    status: 'Draft',
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
  if (value === null || value === undefined || value === '') return '�';
  return value;
}

function nextInputOrder(stories) {
  return (
    stories.reduce((highest, story) => Math.max(highest, Number(story.input_order) || 0), 0) + 1
  );
}

function orderedStories(stories) {
  return stories
    .map((story, index) => ({ story, index }))
    .sort(
      (left, right) =>
        Number(left.story.input_order) - Number(right.story.input_order) || left.index - right.index
    )
    .map(({ story }) => story);
}

function validNonNegativeNumber(value) {
  if (value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function validInteger(value) {
  return value !== '' && Number.isInteger(Number(value));
}

export default function StoriesPage() {
  const [features, setFeatures] = useState([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState('');
  const [stories, setStories] = useState([]);
  const [workbookVersion, setWorkbookVersion] = useState(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const snapshotReadyRef = useRef(false);
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyStoryForm);
  const [editingId, setEditingId] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadWorkspace = useCallback(async (featureId = '', { clearError = true } = {}) => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    if (clearError) setLoadError('');
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setWorkbookVersion(null);
    setSelectedFeatureId(featureId);
    setStories([]);
    setForm(emptyStoryForm());
    setEditingId(null);
    setValidationError('');
    setApiError('');
    setSuccessMessage('');

    const endpoints = ['/api/features'];
    if (featureId) {
      endpoints.push(`/api/features/${encodeURIComponent(featureId)}/stories`);
    }

    try {
      const snapshot = await loadConsistentSnapshot(requestJson, endpoints);
      if (sequence !== loadSequence.current) return;
      const [featureResponse, storyResponse] = snapshot.responses;
      const nextFeatures = Array.isArray(featureResponse.data) ? featureResponse.data : [];
      if (featureId && !nextFeatures.some((feature) => feature.feature_id === featureId)) {
        throw new Error(
          'The selected feature is no longer available. Refresh and select a feature again.'
        );
      }
      setFeatures(nextFeatures);
      setStories(Array.isArray(storyResponse?.data) ? storyResponse.data : []);
      setWorkbookVersion(snapshot.workbookVersion);
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
    } catch (error) {
      if (sequence === loadSequence.current) {
        setLoadError(formatApiError(error, 'Could not load user stories.'));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadWorkspace('', { clearError: false }), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  function clearMessages() {
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function beginCreate() {
    setForm({ ...emptyStoryForm(), input_order: String(nextInputOrder(stories)) });
    setEditingId(null);
    clearMessages();
  }

  function beginEdit(story) {
    setForm({
      story_id: story.story_id ?? '',
      story_name: story.story_name ?? '',
      input_order: story.input_order ?? '',
      status: story.status ?? '',
      build_estimate_current: story.build_estimate_current ?? 0,
      st_estimate_current: story.st_estimate_current ?? 0,
    });
    setEditingId(story.story_id);
    clearMessages();
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function validateForm() {
    if (
      !selectedFeatureId ||
      !form.story_id.trim() ||
      !form.story_name.trim() ||
      !form.status.trim()
    ) {
      return 'Select a parent feature and enter a story ID, name, and status.';
    }
    if (!validInteger(form.input_order)) return 'Input order must be a whole number.';
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
      story_name: form.story_name.trim(),
      input_order: Number(form.input_order),
      status: form.status.trim(),
      build_estimate_current: Number(form.build_estimate_current),
      st_estimate_current: Number(form.st_estimate_current),
    };
    const basePath = `/api/features/${encodeURIComponent(selectedFeatureId)}/stories`;
    const path = editingId ? `${basePath}/${encodeURIComponent(editingId)}` : basePath;
    const method = editingId ? 'PUT' : 'POST';
    if (!editingId) {
      body.story_id = form.story_id.trim();
      body.build_original_estimate = Number(form.build_estimate_current);
      body.build_actual_spent = 0;
      body.st_original_estimate = Number(form.st_estimate_current);
      body.st_actual_spent = 0;
    }

    const previousStories = stories;
    const submittedForm = form;
    const submittedEditingId = editingId;
    const storyFields = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'expectedVersion')
    );
    const optimisticStory = {
      ...(editingId ? stories.find((story) => story.story_id === editingId) : {}),
      story_id: editingId || form.story_id.trim(),
      feature_id: selectedFeatureId,
      ...storyFields,
    };
    setSaving(true);
    try {
      await runOptimisticMutation({
        applyOptimistic: () =>
          setStories((current) => upsertOptimisticRecord(current, optimisticStory, 'story_id')),
        sendMutation: () => requestJson(path, { method, body: JSON.stringify(body) }),
        reconcile: (response) => {
          if (response.data) {
            setStories((current) => replaceRecordFromServer(current, response.data, 'story_id'));
          }
        },
        rollback: () => setStories(previousStories),
      });
      await loadWorkspace(selectedFeatureId);
      setSuccessMessage(editingId ? 'User story updated.' : 'User story added.');
    } catch (error) {
      if (error.status === 409) {
        const conflictMessage = editingId
          ? 'The workbook changed before this save. Stories were refreshed; review the latest story before reopening Edit.'
          : 'The workbook changed before this save. Stories and workbook version were refreshed; review the current list before retrying.';
        await loadWorkspace(selectedFeatureId);
        setForm(submittedForm);
        setEditingId(submittedEditingId);
        setApiError(conflictMessage);
      } else {
        setApiError(formatApiError(error, 'Could not save the user story.'));
      }
    } finally {
      releaseRequestLock(mutationLock);
      setSaving(false);
    }
  }

  const selectedFeature = features.find((feature) => feature.feature_id === selectedFeatureId);
  const displayedStories = orderedStories(stories);

  return (
    <section className="teams-page stories-page" aria-labelledby="stories-title">
      <div className="page-eyebrow">PLANNING</div>
      <div className="teams-heading-row">
        <div>
          <h1 id="stories-title">User Stories</h1>
          <p className="page-subtitle">Track story-level effort within each feature.</p>
        </div>
        <div className="teams-toolbar">
          <span className="version-label" aria-live="polite">
            Workbook version:{' '}
            {snapshotReady ? workbookVersion : loading ? 'Loading�' : 'Unavailable'}
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => loadWorkspace(selectedFeatureId)}
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
            onClick={() => loadWorkspace(selectedFeatureId)}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      <div className="story-filter-card">
        <label className="form-field" htmlFor="story-feature-filter">
          <span>Parent feature</span>
          <select
            id="story-feature-filter"
            value={selectedFeatureId}
            onChange={(event) => loadWorkspace(event.target.value)}
            disabled={loading || saving || features.length === 0}
          >
            <option value="">Choose a feature</option>
            {features.map((feature) => (
              <option key={feature.feature_id} value={feature.feature_id}>
                {feature.feature_name} ({feature.feature_id})
              </option>
            ))}
          </select>
        </label>
        {selectedFeature && (
          <div className="selected-feature-summary">
            <strong>{selectedFeature.feature_name}</strong>
            <span>Feature ID: {selectedFeature.feature_id}</span>
          </div>
        )}
      </div>

      <form className="team-form" onSubmit={handleSubmit} noValidate>
        <div className="team-form-heading">
          <div>
            <h2>{editingId ? `Edit ${editingId}` : 'Add a user story'}</h2>
            <p>
              {editingId
                ? 'Update the story details and current estimates.'
                : 'Create a story within the selected feature.'}
            </p>
          </div>
          {editingId && (
            <button
              className="text-button"
              type="button"
              onClick={beginCreate}
              disabled={saving || !snapshotReady}
            >
              Cancel edit
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

        <div className="story-form-grid">
          <label className="form-field">
            <span>
              Story ID <span className="required-mark">*</span>
            </span>
            <input
              autoComplete="off"
              disabled={
                Boolean(editingId) || saving || loading || !snapshotReady || !selectedFeatureId
              }
              name="story_id"
              onChange={handleChange}
              required
              value={form.story_id}
            />
          </label>
          <label className="form-field">
            <span>
              Story name <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady || !selectedFeatureId}
              name="story_name"
              onChange={handleChange}
              required
              value={form.story_name}
            />
          </label>
          <label className="form-field">
            <span>
              Status <span className="required-mark">*</span>
            </span>
            <select
              disabled={saving || loading || !snapshotReady || !selectedFeatureId}
              name="status"
              onChange={handleChange}
              required
              value={form.status}
            >
              {!['Draft', 'Ready', 'WIP', 'Done'].includes(form.status) && form.status && (
                <option value={form.status}>{form.status}</option>
              )}
              <option value="Draft">Draft</option>
              <option value="Ready">Ready</option>
              <option value="WIP">WIP</option>
              <option value="Done">Done</option>
            </select>
          </label>
          <label className="form-field">
            <span>
              Input order <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady || !selectedFeatureId}
              name="input_order"
              onChange={handleChange}
              required
              step="1"
              type="number"
              value={form.input_order}
            />
            <small className="field-note">
              Lower values appear first; adjust to reorder stories.
            </small>
          </label>
          <div className="effort-editor-group">
            <h3>Current estimates</h3>
            <div className="effort-inputs">
              <label className="form-field">
                <span>
                  Build estimate <span className="required-mark">*</span>
                </span>
                <input
                  disabled={saving || loading || !snapshotReady || !selectedFeatureId}
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
                  disabled={saving || loading || !snapshotReady || !selectedFeatureId}
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
                        stories.find((story) => story.story_id === editingId)
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
                        stories.find((story) => story.story_id === editingId)?.st_original_estimate
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
                        stories.find((story) => story.story_id === editingId)?.build_actual_spent
                      )
                    : '0'}
                </strong>
              </span>
              <span>
                ST{' '}
                <strong>
                  {editingId
                    ? formatEffort(
                        stories.find((story) => story.story_id === editingId)?.st_actual_spent
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
            disabled={
              saving || loading || !snapshotReady || !selectedFeatureId || Boolean(loadError)
            }
          >
            {saving ? 'Saving�' : editingId ? 'Save changes' : 'Add story'}
          </button>
        </div>
      </form>

      <section className="team-list-section" aria-labelledby="story-list-title">
        <div className="team-list-heading">
          <div>
            <h2 id="story-list-title">Story list</h2>
            <p>
              {selectedFeature
                ? `${selectedFeature.feature_name} � ${displayedStories.length} ${displayedStories.length === 1 ? 'story' : 'stories'}`
                : 'Select a parent feature to browse its stories.'}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="teams-state" role="status">
            Loading user stories�
          </div>
        ) : features.length === 0 ? (
          <div className="teams-state empty-state">
            <strong>No features are available</strong>
            <p>Create a feature before adding user stories.</p>
          </div>
        ) : !selectedFeatureId ? (
          <div className="teams-state">Choose a parent feature above to view its stories.</div>
        ) : displayedStories.length === 0 ? (
          <div className="teams-state empty-state">
            <span className="empty-symbol" aria-hidden="true">
              +
            </span>
            <strong>No stories for this feature yet</strong>
            <p>Add a user story above to begin tracking work.</p>
          </div>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table story-table">
              <thead>
                <tr>
                  <th scope="col">User story</th>
                  <th scope="col">Parent feature</th>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col">Build current / original / spent</th>
                  <th scope="col">ST current / original / spent</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedStories.map((story) => (
                  <tr key={story.story_id}>
                    <td data-label="User story">
                      <strong>{story.story_name}</strong>
                      <small className="release-id">{story.story_id}</small>
                    </td>
                    <td data-label="Parent feature">
                      {selectedFeature?.feature_name ?? selectedFeatureId}
                      <small className="release-id">{selectedFeatureId}</small>
                    </td>
                    <td data-label="Order">{story.input_order}</td>
                    <td data-label="Status">
                      <span className="team-status">{story.status}</span>
                    </td>
                    <td data-label="Build current / original / spent">
                      {formatEffort(story.build_estimate_current)} /{' '}
                      {formatEffort(story.build_original_estimate)} /{' '}
                      {formatEffort(story.build_actual_spent)}
                    </td>
                    <td data-label="ST current / original / spent">
                      {formatEffort(story.st_estimate_current)} /{' '}
                      {formatEffort(story.st_original_estimate)} /{' '}
                      {formatEffort(story.st_actual_spent)}
                    </td>
                    <td className="story-actions" data-label="Actions">
                      <button
                        className="row-action"
                        type="button"
                        onClick={() => beginEdit(story)}
                        disabled={saving || !snapshotReady}
                        aria-label={`Edit ${story.story_name}`}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
