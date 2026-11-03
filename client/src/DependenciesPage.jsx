import React, { useCallback, useEffect, useRef, useState } from 'react';
import { canMutateFromSnapshot, loadConsistentSnapshot } from './teamSnapshot';
import { acquireRequestLock, formatApiError, releaseRequestLock } from './apiErrors';
import {
  replaceRecordFromServer,
  runOptimisticMutation,
  upsertOptimisticRecord,
} from './optimisticRecords';

const DEPENDENCY_ENDPOINTS = ['/api/dependencies', '/api/features', '/api/teams'];

function emptyForm() {
  return {
    dependency_id: '',
    predecessor_feature_id: '',
    dependent_feature_id: '',
    dependency_type: 'Normal',
    affected_activity: '',
    blocking_pct: '',
    dependency_status: 'Unresolved',
    responsible_team_id: '',
    notes: '',
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

function featureLabel(feature) {
  return `${feature.feature_name} (${feature.feature_id})`;
}

export default function DependenciesPage() {
  const [dependencies, setDependencies] = useState([]);
  const [features, setFeatures] = useState([]);
  const [teams, setTeams] = useState([]);
  const [workbookVersion, setWorkbookVersion] = useState(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const snapshotReadyRef = useRef(false);
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadData = useCallback(async ({ clearError = true } = {}) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    if (clearError) setLoadError('');
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setWorkbookVersion(null);
    setDependencies([]);
    setFeatures([]);
    setTeams([]);
    setForm(emptyForm());
    setEditingId(null);
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
    try {
      const snapshot = await loadConsistentSnapshot(requestJson, DEPENDENCY_ENDPOINTS);
      if (sequence !== loadSequence.current) return;
      const [dependencyResponse, featureResponse, teamResponse] = snapshot.responses;
      setDependencies(Array.isArray(dependencyResponse.data) ? dependencyResponse.data : []);
      setFeatures(Array.isArray(featureResponse.data) ? featureResponse.data : []);
      setTeams(Array.isArray(teamResponse.data) ? teamResponse.data : []);
      setWorkbookVersion(snapshot.workbookVersion);
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
    } catch (error) {
      if (sequence === loadSequence.current) {
        setLoadError(formatApiError(error, 'Could not load dependencies.'));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadData({ clearError: false }), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  function clearMessages() {
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function beginCreate() {
    setForm(emptyForm());
    setEditingId(null);
    clearMessages();
  }

  function beginEdit(dependency) {
    setForm({
      dependency_id: dependency.dependency_id ?? '',
      predecessor_feature_id: dependency.predecessor_feature_id ?? '',
      dependent_feature_id: dependency.dependent_feature_id ?? '',
      dependency_type: dependency.dependency_type ?? 'Normal',
      affected_activity: dependency.affected_activity ?? '',
      blocking_pct: dependency.blocking_pct ?? '',
      dependency_status: dependency.dependency_status ?? 'Unresolved',
      responsible_team_id: dependency.responsible_team_id ?? '',
      notes: dependency.notes ?? '',
    });
    setEditingId(dependency.dependency_id);
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
    if (!editingId && !form.dependency_id.trim()) return 'Enter a dependency ID.';
    if (!form.predecessor_feature_id || !form.dependent_feature_id) {
      return 'Select both the predecessor and dependent feature.';
    }
    if (form.predecessor_feature_id === form.dependent_feature_id) {
      return 'A feature cannot depend on itself.';
    }
    if (!['Hard', 'Normal'].includes(form.dependency_type)) {
      return 'Select Hard or Normal dependency type.';
    }
    if (!form.dependency_status.trim()) return 'Enter a dependency status.';
    if (form.dependency_type === 'Hard') {
      if (!['Build', 'ST', 'Both'].includes(form.affected_activity)) {
        return 'Select the affected activity for a hard dependency.';
      }
      const percent = Number(form.blocking_pct);
      if (form.blocking_pct === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        return 'Enter a blocking percentage from 0 to 100.';
      }
    }
    const duplicate = dependencies.find(
      (dependency) =>
        dependency.dependency_id !== editingId &&
        dependency.predecessor_feature_id === form.predecessor_feature_id &&
        dependency.dependent_feature_id === form.dependent_feature_id
    );
    if (duplicate) return `That feature relationship already exists as ${duplicate.dependency_id}.`;
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
      predecessor_feature_id: form.predecessor_feature_id,
      dependent_feature_id: form.dependent_feature_id,
      dependency_type: form.dependency_type,
      affected_activity: form.dependency_type === 'Hard' ? form.affected_activity : null,
      blocking_pct: form.dependency_type === 'Hard' ? Number(form.blocking_pct) : null,
      dependency_status: form.dependency_status.trim(),
      responsible_team_id: form.responsible_team_id || null,
      notes: form.notes.trim() || null,
    };
    if (!editingId) body.dependency_id = form.dependency_id.trim();

    const previousDependencies = dependencies;
    const submittedForm = form;
    const submittedEditingId = editingId;
    const dependencyFields = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'expectedVersion')
    );
    const optimisticDependency = {
      ...(editingId
        ? dependencies.find((dependency) => dependency.dependency_id === editingId)
        : {}),
      dependency_id: editingId || form.dependency_id.trim(),
      ...dependencyFields,
    };
    setSaving(true);
    try {
      await runOptimisticMutation({
        applyOptimistic: () =>
          setDependencies((current) =>
            upsertOptimisticRecord(current, optimisticDependency, 'dependency_id')
          ),
        sendMutation: () =>
          requestJson(
            editingId ? `/api/dependencies/${encodeURIComponent(editingId)}` : '/api/dependencies',
            {
              method: editingId ? 'PUT' : 'POST',
              body: JSON.stringify(body),
            }
          ),
        reconcile: (response) => {
          if (response.data) {
            setDependencies((current) =>
              replaceRecordFromServer(current, response.data, 'dependency_id')
            );
          }
        },
        rollback: () => setDependencies(previousDependencies),
      });
      await loadData();
      setSuccessMessage(editingId ? 'Dependency updated.' : 'Dependency created.');
    } catch (error) {
      if (error.status === 409) {
        await loadData();
        setForm(submittedForm);
        setEditingId(submittedEditingId);
        setApiError(
          'The workbook changed before this save. Dependencies were refreshed; review the latest data before retrying.'
        );
      } else {
        setApiError(formatApiError(error, 'Could not save the dependency.'));
      }
    } finally {
      releaseRequestLock(mutationLock);
      setSaving(false);
    }
  }

  const featuresById = new Map(features.map((feature) => [feature.feature_id, feature]));
  const teamsById = new Map(teams.map((team) => [team.team_id, team]));
  function resolveFeature(id) {
    const feature = featuresById.get(id);
    return feature ? featureLabel(feature) : `Unresolved feature reference (${id || 'missing ID'})`;
  }

  return (
    <section className="teams-page dependencies-page" aria-labelledby="dependencies-title">
      <div className="page-eyebrow">PLANNING</div>
      <div className="teams-heading-row">
        <div>
          <h1 id="dependencies-title">Dependencies</h1>
          <p className="page-subtitle">Record feature ordering and blocking relationships.</p>
        </div>
        <div className="teams-toolbar">
          <span className="version-label" aria-live="polite">
            Workbook version:{' '}
            {snapshotReady ? workbookVersion : loading ? 'Loading…' : 'Unavailable'}
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => loadData()}
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
            onClick={() => loadData()}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      <form className="team-form" onSubmit={handleSubmit} noValidate>
        <div className="team-form-heading">
          <div>
            <h2>{editingId ? `Edit ${editingId}` : 'Add a dependency'}</h2>
            <p>Direction: predecessor feature must come before the dependent feature.</p>
          </div>
          {editingId && (
            <button className="text-button" type="button" onClick={beginCreate} disabled={saving}>
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
        <div className="dependency-form-grid">
          {!editingId && (
            <label className="form-field">
              <span>
                Dependency ID <span className="required-mark">*</span>
              </span>
              <input
                name="dependency_id"
                value={form.dependency_id}
                onChange={handleChange}
                disabled={loading || saving || !snapshotReady}
                required
              />
            </label>
          )}
          <label className="form-field">
            <span>
              Predecessor feature <span className="required-mark">*</span>
            </span>
            <select
              name="predecessor_feature_id"
              value={form.predecessor_feature_id}
              onChange={handleChange}
              disabled={loading || saving || !snapshotReady}
              required
            >
              <option value="">Select predecessor</option>
              {features.map((feature) => (
                <option key={feature.feature_id} value={feature.feature_id}>
                  {featureLabel(feature)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>
              Dependent feature <span className="required-mark">*</span>
            </span>
            <select
              name="dependent_feature_id"
              value={form.dependent_feature_id}
              onChange={handleChange}
              disabled={loading || saving || !snapshotReady}
              required
            >
              <option value="">Select dependent</option>
              {features.map((feature) => (
                <option key={feature.feature_id} value={feature.feature_id}>
                  {featureLabel(feature)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>
              Classification <span className="required-mark">*</span>
            </span>
            <select
              name="dependency_type"
              value={form.dependency_type}
              onChange={handleChange}
              disabled={loading || saving || !snapshotReady}
            >
              <option value="Normal">Normal · ordering preference</option>
              <option value="Hard">Hard · blocks effort</option>
            </select>
          </label>
          <label className="form-field">
            <span>
              Status <span className="required-mark">*</span>
            </span>
            <select
              name="dependency_status"
              value={form.dependency_status}
              onChange={handleChange}
              disabled={loading || saving || !snapshotReady}
            >
              <option value="Unresolved">Unresolved</option>
              <option value="Resolved">Resolved</option>
            </select>
          </label>
          {form.dependency_type === 'Hard' && (
            <>
              <label className="form-field">
                <span>
                  Affected activity <span className="required-mark">*</span>
                </span>
                <select
                  name="affected_activity"
                  value={form.affected_activity}
                  onChange={handleChange}
                  disabled={loading || saving || !snapshotReady}
                >
                  <option value="">Select activity</option>
                  <option value="Build">Build</option>
                  <option value="ST">ST</option>
                  <option value="Both">Both</option>
                </select>
              </label>
              <label className="form-field">
                <span>
                  Blocking percentage <span className="required-mark">*</span>
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  name="blocking_pct"
                  value={form.blocking_pct}
                  onChange={handleChange}
                  disabled={loading || saving || !snapshotReady}
                />
              </label>
            </>
          )}
          <label className="form-field">
            <span>Responsible team</span>
            <select
              name="responsible_team_id"
              value={form.responsible_team_id}
              onChange={handleChange}
              disabled={loading || saving || !snapshotReady}
            >
              <option value="">None</option>
              {teams.map((team) => (
                <option key={team.team_id} value={team.team_id}>
                  {team.team_name} ({team.team_id})
                </option>
              ))}
            </select>
          </label>
          <label className="form-field dependency-notes">
            <span>Notes</span>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              disabled={loading || saving || !snapshotReady}
              rows="2"
            />
          </label>
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
              loading || saving || !snapshotReady || Boolean(loadError) || features.length < 2
            }
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add dependency'}
          </button>
        </div>
      </form>

      <section className="team-list-section" aria-labelledby="dependency-list-title">
        <div className="team-list-heading">
          <div>
            <h2 id="dependency-list-title">Dependency summary</h2>
            <p>Each row reads from predecessor to dependent feature.</p>
          </div>
        </div>
        {loading ? (
          <div className="teams-state" role="status">
            Loading dependencies…
          </div>
        ) : dependencies.length === 0 ? (
          <div className="teams-state empty-state">
            <strong>No dependencies yet</strong>
            <p>Add a feature relationship above to create the dependency summary.</p>
          </div>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table dependency-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Predecessor</th>
                  <th scope="col">Dependent feature</th>
                  <th scope="col">Type</th>
                  <th scope="col">Activity / block</th>
                  <th scope="col">Status</th>
                  <th scope="col">Responsible team</th>
                  <th scope="col">Notes</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dependencies.map((dependency) => {
                  const team = teamsById.get(dependency.responsible_team_id);
                  return (
                    <tr key={dependency.dependency_id}>
                      <td data-label="ID">
                        <strong>{dependency.dependency_id}</strong>
                      </td>
                      <td data-label="Predecessor">
                        {resolveFeature(dependency.predecessor_feature_id)}
                      </td>
                      <td data-label="Dependent feature">
                        {resolveFeature(dependency.dependent_feature_id)}
                      </td>
                      <td data-label="Type">
                        <span className="team-status">{dependency.dependency_type}</span>
                      </td>
                      <td data-label="Activity / block">
                        {dependency.affected_activity || '—'}
                        {dependency.blocking_pct !== null && dependency.blocking_pct !== undefined
                          ? ` · ${dependency.blocking_pct}%`
                          : ''}
                      </td>
                      <td data-label="Status">{dependency.dependency_status}</td>
                      <td data-label="Responsible team">
                        {dependency.responsible_team_id
                          ? team
                            ? `${team.team_name} (${team.team_id})`
                            : `Unresolved team reference (${dependency.responsible_team_id})`
                          : '—'}
                      </td>
                      <td data-label="Notes">{dependency.notes || '—'}</td>
                      <td className="dependency-actions" data-label="Actions">
                        <button
                          className="row-action"
                          type="button"
                          onClick={() => beginEdit(dependency)}
                          disabled={saving || !snapshotReady}
                          aria-label={`Edit dependency ${dependency.dependency_id}`}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
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
