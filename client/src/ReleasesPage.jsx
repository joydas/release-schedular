import React, { useCallback, useEffect, useRef, useState } from 'react';
import { acquireRequestLock, formatApiError, releaseRequestLock } from './apiErrors';
import {
  replaceRecordFromServer,
  runOptimisticMutation,
  upsertOptimisticRecord,
} from './optimisticRecords';
import { formatDate } from './dateUtils.js';

const EMPTY_FORM = {
  release_id: '',
  release_name: '',
  status: 'Future',
  start_date: '',
  end_date: '',
  target_date: '',
  priority_order: '',
};

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

function dateInputValue(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function isValidDateInput(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState([]);
  const [workbookVersion, setWorkbookVersion] = useState(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const snapshotReadyRef = useRef(false);
  const mutationLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadReleases = useCallback(async ({ clearError = true } = {}) => {
    setLoading(true);
    if (clearError) setLoadError('');
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setWorkbookVersion(null);

    try {
      const result = await requestJson('/api/releases');
      if (!Number.isSafeInteger(result.workbookVersion) || result.workbookVersion < 0) {
        throw new Error(
          'The Releases API did not return a valid workbook version. Refresh to try again.'
        );
      }
      setReleases(Array.isArray(result.data) ? result.data : []);
      setWorkbookVersion(result.workbookVersion);
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
    } catch (error) {
      setLoadError(formatApiError(error, 'Could not load releases.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadReleases({ clearError: false }), 0);
    return () => window.clearTimeout(timer);
  }, [loadReleases]);

  function clearMessages() {
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    clearMessages();
  }

  function beginEdit(release) {
    setForm({
      release_id: release.release_id ?? '',
      release_name: release.release_name ?? '',
      status: release.status ?? '',
      start_date: dateInputValue(release.start_date),
      end_date: dateInputValue(release.end_date),
      target_date: dateInputValue(release.target_date),
      priority_order: release.priority_order ?? '',
    });
    setEditingId(release.release_id);
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
    if (!form.release_id.trim() || !form.release_name.trim() || !form.status.trim()) {
      return 'Enter a release ID, release name, and status.';
    }
    if (![form.start_date, form.end_date, form.target_date].every(isValidDateInput)) {
      return 'Enter valid calendar dates.';
    }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      return 'End date must be on or after start date.';
    }
    const priorityOrder = String(form.priority_order ?? '').trim();
    if (priorityOrder !== '' && !Number.isInteger(Number(priorityOrder))) {
      return 'Priority order must be a whole number.';
    }
    return '';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearMessages();
    const validationMessage = validateForm();
    if (validationMessage) {
      setValidationError(validationMessage);
      return;
    }
    if (!snapshotReadyRef.current || !Number.isSafeInteger(workbookVersion)) {
      setApiError('A current release list is not available. Refresh before saving.');
      return;
    }
    if (!acquireRequestLock(mutationLock)) return;

    const body = {
      expectedVersion: workbookVersion,
      release_name: form.release_name.trim(),
      status: form.status.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      target_date: form.target_date,
    };
    const priorityOrder = String(form.priority_order ?? '').trim();
    if (!editingId) {
      body.release_id = form.release_id.trim();
      body.priority_order = priorityOrder === '' ? '' : Number(priorityOrder);
    } else if (priorityOrder !== '') {
      body.priority_order = Number(priorityOrder);
    }

    const path = editingId ? `/api/releases/${encodeURIComponent(editingId)}` : '/api/releases';
    const method = editingId ? 'PUT' : 'POST';
    const submittedId = editingId || form.release_id.trim();
    const previousReleases = releases;
    const releaseFields = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'expectedVersion')
    );
    const optimisticRelease = {
      ...(editingId ? releases.find((item) => item.release_id === editingId) : {}),
      release_id: submittedId,
      ...releaseFields,
    };
    setSaving(true);

    try {
      await runOptimisticMutation({
        applyOptimistic: () =>
          setReleases((current) =>
            upsertOptimisticRecord(current, optimisticRelease, 'release_id')
          ),
        sendMutation: () => requestJson(path, { method, body: JSON.stringify(body) }),
        reconcile: (response) => {
          if (response.data) {
            setReleases((current) => replaceRecordFromServer(current, response.data, 'release_id'));
          }
        },
        rollback: () => setReleases(previousReleases),
      });
      setSuccessMessage(editingId ? 'Release updated.' : 'Release added.');
      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadReleases();
    } catch (error) {
      if (error.status === 409) {
        setApiError(
          editingId
            ? 'The workbook changed before this save. The release list has been refreshed; review the latest release and reopen Edit before trying again.'
            : 'The workbook changed before this save. The release list and version are refreshed; review existing release IDs before retrying the add.'
        );
        await loadReleases();
      } else {
        setApiError(formatApiError(error, 'Could not save the release.'));
      }
    } finally {
      releaseRequestLock(mutationLock);
      setSaving(false);
    }
  }

  return (
    <section className="teams-page releases-page" aria-labelledby="releases-title">
      <div className="page-eyebrow">PLANNING</div>
      <div className="teams-heading-row">
        <div>
          <h1 id="releases-title">Releases</h1>
          <p className="page-subtitle">Set release windows, target dates, and planning order.</p>
        </div>
        <div className="teams-toolbar">
          <span className="version-label" aria-live="polite">
            Workbook version:{' '}
            {snapshotReady ? workbookVersion : loading ? 'Loading…' : 'Unavailable'}
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => loadReleases()}
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
            onClick={() => loadReleases()}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      <form className="team-form" onSubmit={handleSubmit} noValidate>
        <div className="team-form-heading">
          <div>
            <h2>{editingId ? `Edit ${editingId}` : 'Add a release'}</h2>
            <p>{editingId ? 'Update release details.' : 'Create a release window for planning.'}</p>
          </div>
          {editingId && (
            <button className="text-button" type="button" onClick={resetForm} disabled={saving}>
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

        <div className="release-form-grid">
          <label className="form-field">
            <span>
              Release ID <span className="required-mark">*</span>
            </span>
            <input
              autoComplete="off"
              disabled={Boolean(editingId) || saving || loading || !snapshotReady}
              id="release-id"
              name="release_id"
              onChange={handleChange}
              required
              value={form.release_id}
            />
          </label>
          <label className="form-field">
            <span>
              Release name <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              id="release-name"
              name="release_name"
              onChange={handleChange}
              required
              value={form.release_name}
            />
          </label>
          <label className="form-field">
            <span>
              Status <span className="required-mark">*</span>
            </span>
            <select
              disabled={saving || loading || !snapshotReady}
              id="release-status"
              name="status"
              onChange={handleChange}
              required
              value={form.status}
            >
              {!['Past', 'Active', 'Future'].includes(form.status) && form.status && (
                <option value={form.status}>{form.status}</option>
              )}
              <option value="Past">Past</option>
              <option value="Active">Active</option>
              <option value="Future">Future</option>
            </select>
          </label>
          <label className="form-field">
            <span>
              Start date <span className="optional-label">Optional</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              id="release-start-date"
              name="start_date"
              onChange={handleChange}
              type="date"
              value={form.start_date}
            />
          </label>
          <label className="form-field">
            <span>
              End date <span className="optional-label">Optional</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              id="release-end-date"
              name="end_date"
              onChange={handleChange}
              type="date"
              value={form.end_date}
            />
          </label>
          <label className="form-field">
            <span>
              Target date <span className="optional-label">Optional</span>
            </span>
            <input
              disabled={saving || loading || !snapshotReady}
              id="release-target-date"
              name="target_date"
              onChange={handleChange}
              type="date"
              value={form.target_date}
            />
          </label>
          <label className="form-field">
            <span>
              Priority order <span className="optional-label">Optional</span>
            </span>
            {editingId && (
              <small className="field-note">Leave blank to keep the current priority.</small>
            )}
            <input
              disabled={saving || loading || !snapshotReady}
              id="release-priority"
              name="priority_order"
              onChange={handleChange}
              step="1"
              type="number"
              value={form.priority_order}
            />
          </label>
        </div>
        <div className="team-form-actions">
          {editingId && (
            <button
              className="secondary-button"
              type="button"
              onClick={resetForm}
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
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add release'}
          </button>
        </div>
      </form>

      <section className="team-list-section" aria-labelledby="release-list-title">
        <div className="team-list-heading">
          <div>
            <h2 id="release-list-title">Release directory</h2>
            <p>
              {releases.length} {releases.length === 1 ? 'release' : 'releases'}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="teams-state" role="status">
            Loading releases…
          </div>
        ) : releases.length === 0 ? (
          <div className="teams-state empty-state">
            <span className="empty-symbol" aria-hidden="true">
              ＋
            </span>
            <strong>No releases yet</strong>
            <p>Add a release above to start planning delivery windows.</p>
          </div>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table release-table">
              <thead>
                <tr>
                  <th scope="col">Release</th>
                  <th scope="col">Release ID</th>
                  <th scope="col">Status</th>
                  <th scope="col">Start</th>
                  <th scope="col">End</th>
                  <th scope="col">Target</th>
                  <th scope="col">Priority</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {releases.map((release) => (
                  <tr key={release.release_id}>
                    <td data-label="Release">
                      <strong>{release.release_name}</strong>
                    </td>
                    <td data-label="Release ID">
                      <span className="team-id-value">{release.release_id}</span>
                    </td>
                    <td data-label="Status">
                      <span className="team-status">{release.status}</span>
                    </td>
                    <td data-label="Start">{formatDate(release.start_date)}</td>
                    <td data-label="End">{formatDate(release.end_date)}</td>
                    <td data-label="Target">{formatDate(release.target_date)}</td>
                    <td data-label="Priority">{release.priority_order ?? '—'}</td>
                    <td data-label="Actions">
                      <button
                        className="row-action"
                        type="button"
                        onClick={() => beginEdit(release)}
                        disabled={saving || !snapshotReady}
                        aria-label={`Edit ${release.release_name}`}
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
