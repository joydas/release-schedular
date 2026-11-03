import React, { useCallback, useEffect, useRef, useState } from 'react';
import { canMutateFromSnapshot, loadConsistentTeamSnapshot } from './teamSnapshot';
import { acquireRequestLock, formatApiError, releaseRequestLock } from './apiErrors';
import {
  replaceRecordFromServer,
  runOptimisticMutation,
  upsertOptimisticRecord,
} from './optimisticRecords';

const EMPTY_FORM = { team_id: '', team_name: '', status: 'Active', notes: '' };

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

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [releases, setReleases] = useState([]);
  const [capacities, setCapacities] = useState([]);
  const [workbookVersion, setWorkbookVersion] = useState(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const snapshotReadyRef = useRef(false);
  const teamMutationLock = useRef(false);
  const capacityMutationLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [capacityTeamId, setCapacityTeamId] = useState(null);
  const [capacityReleaseId, setCapacityReleaseId] = useState('');
  const [capacityForm, setCapacityForm] = useState({ build_capacity: '', st_capacity: '' });
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacityError, setCapacityError] = useState('');
  const [capacitySuccess, setCapacitySuccess] = useState('');

  const loadTeams = useCallback(async ({ showLoading = true, clearError = true } = {}) => {
    if (showLoading) setLoading(true);
    if (clearError) setLoadError('');
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setWorkbookVersion(null);

    try {
      const snapshot = await loadConsistentTeamSnapshot(requestJson);
      const { teams: teamResult, releases: releaseResult, capacities: capacityResult } = snapshot;
      setTeams(Array.isArray(teamResult.data) ? teamResult.data : []);
      setReleases(Array.isArray(releaseResult.data) ? releaseResult.data : []);
      setCapacities(Array.isArray(capacityResult.data) ? capacityResult.data : []);
      setWorkbookVersion(snapshot.workbookVersion);
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
    } catch (error) {
      setLoadError(formatApiError(error, 'Could not load teams.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadTeams({ showLoading: false, clearError: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTeams]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function beginEdit(team) {
    setForm({
      team_id: team.team_id,
      team_name: team.team_name ?? '',
      status: team.status ?? 'Active',
      notes: team.notes ?? '',
    });
    setEditingId(team.team_id);
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  function getCapacity(teamId, releaseId) {
    return capacities.find(
      (capacity) => capacity.team_id === teamId && capacity.release_id === releaseId
    );
  }

  function openCapacity(team) {
    const releaseId = releases[0]?.release_id ?? '';
    const capacity = releaseId ? getCapacity(team.team_id, releaseId) : null;
    setCapacityTeamId(team.team_id);
    setCapacityReleaseId(releaseId);
    setCapacityForm({
      build_capacity: capacity?.build_capacity ?? '',
      st_capacity: capacity?.st_capacity ?? '',
    });
    setCapacityError('');
    setCapacitySuccess('');
  }

  function selectCapacityRelease(releaseId) {
    const capacity = releaseId ? getCapacity(capacityTeamId, releaseId) : null;
    setCapacityReleaseId(releaseId);
    setCapacityForm({
      build_capacity: capacity?.build_capacity ?? '',
      st_capacity: capacity?.st_capacity ?? '',
    });
    setCapacityError('');
    setCapacitySuccess('');
  }

  async function saveCapacity(event) {
    event.preventDefault();
    setCapacityError('');
    setCapacitySuccess('');
    const buildCapacity = Number(capacityForm.build_capacity);
    const stCapacity = Number(capacityForm.st_capacity);
    if (
      !capacityReleaseId ||
      capacityForm.build_capacity === '' ||
      capacityForm.st_capacity === '' ||
      !Number.isFinite(buildCapacity) ||
      buildCapacity < 0 ||
      !Number.isFinite(stCapacity) ||
      stCapacity < 0
    ) {
      setCapacityError('Enter non-negative Build and ST capacity values for the selected release.');
      return;
    }
    if (!canMutateFromSnapshot(snapshotReadyRef.current, workbookVersion)) {
      setCapacityError('The current workbook version is unavailable. Refresh before saving.');
      return;
    }
    if (!acquireRequestLock(capacityMutationLock)) return;

    setCapacitySaving(true);
    try {
      const result = await requestJson(
        `/api/capacities/${encodeURIComponent(capacityTeamId)}/${encodeURIComponent(capacityReleaseId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            expectedVersion: workbookVersion,
            build_capacity: buildCapacity,
            st_capacity: stCapacity,
          }),
        }
      );
      if (result.workbookVersion !== undefined) setWorkbookVersion(result.workbookVersion);
      setCapacitySuccess('Capacity saved.');
      await loadTeams({ showLoading: false });
    } catch (error) {
      if (error.status === 409) {
        setCapacityError(
          'The workbook changed before this save. Capacity data and version have been refreshed; review the latest values before trying again.'
        );
        setCapacityReleaseId('');
        setCapacityForm({ build_capacity: '', st_capacity: '' });
        await loadTeams({ showLoading: false });
      } else {
        setCapacityError(formatApiError(error, 'Could not save capacity.'));
      }
    } finally {
      releaseRequestLock(capacityMutationLock);
      setCapacitySaving(false);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setValidationError('');
    setApiError('');
    setSuccessMessage('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setValidationError('');
    setApiError('');
    setSuccessMessage('');

    const teamId = form.team_id.trim();
    const teamName = form.team_name.trim();
    if (!teamId || !teamName || !form.status) {
      setValidationError('Enter a team ID and name, and choose a status.');
      return;
    }
    if (!canMutateFromSnapshot(snapshotReadyRef.current, workbookVersion)) {
      setApiError(
        'The current workbook version is unavailable. Refresh the team list before saving.'
      );
      return;
    }
    if (!acquireRequestLock(teamMutationLock)) return;

    const body = {
      expectedVersion: workbookVersion,
      team_name: teamName,
      status: form.status,
      notes: form.notes.trim() || null,
    };
    const path = editingId ? `/api/teams/${encodeURIComponent(editingId)}` : '/api/teams';
    const method = editingId ? 'PUT' : 'POST';
    if (!editingId) body.team_id = teamId;

    setSaving(true);
    const previousTeams = teams;
    const optimisticTeam = {
      ...(editingId ? teams.find((team) => team.team_id === editingId) : {}),
      team_id: editingId || teamId,
      team_name: teamName,
      status: form.status,
      notes: form.notes.trim() || null,
    };
    try {
      const result = await runOptimisticMutation({
        applyOptimistic: () =>
          setTeams((current) => upsertOptimisticRecord(current, optimisticTeam, 'team_id')),
        sendMutation: () => requestJson(path, { method, body: JSON.stringify(body) }),
        reconcile: (response) => {
          if (response.data) {
            setTeams((current) => replaceRecordFromServer(current, response.data, 'team_id'));
          }
        },
        rollback: () => setTeams(previousTeams),
      });
      if (result.workbookVersion !== undefined) setWorkbookVersion(result.workbookVersion);
      setSuccessMessage(editingId ? 'Team updated.' : 'Team added.');
      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadTeams({ showLoading: false });
    } catch (error) {
      if (error.status === 409) {
        setApiError(
          editingId
            ? 'The workbook changed before this save. The team list and version have been refreshed; review the latest team and reopen Edit before trying again.'
            : 'The workbook changed before this save. The team list and version have been refreshed; review existing team IDs before retrying the add.'
        );
        await loadTeams({ showLoading: false });
      } else {
        setApiError(formatApiError(error, 'Could not save the team.'));
      }
    } finally {
      releaseRequestLock(teamMutationLock);
      setSaving(false);
    }
  }

  return (
    <section className="teams-page" aria-labelledby="teams-title">
      <div className="page-eyebrow">PLANNING</div>
      <div className="teams-heading-row">
        <div>
          <h1 id="teams-title">Teams</h1>
          <p className="page-subtitle">Manage the teams that deliver planned work.</p>
        </div>
        <div className="teams-toolbar">
          <span className="version-label" aria-live="polite">
            Workbook version:{' '}
            {snapshotReady ? workbookVersion : loading ? 'Loading…' : 'Unavailable'}
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => loadTeams()}
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
            onClick={() => loadTeams()}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}

      <form className="team-form" onSubmit={handleSubmit} noValidate>
        <div className="team-form-heading">
          <div>
            <h2>{editingId ? `Edit ${editingId}` : 'Add a team'}</h2>
            <p>
              {editingId ? 'Update the team details below.' : 'Create a team for release planning.'}
            </p>
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

        <div className="team-form-grid">
          <label className="form-field">
            <span>
              Team ID <span className="required-mark">*</span>
            </span>
            <input
              autoComplete="off"
              disabled={Boolean(editingId) || saving}
              id="team-id"
              name="team_id"
              onChange={handleChange}
              required
              value={form.team_id}
            />
          </label>
          <label className="form-field">
            <span>
              Team name <span className="required-mark">*</span>
            </span>
            <input
              disabled={saving}
              id="team-name"
              name="team_name"
              onChange={handleChange}
              required
              value={form.team_name}
            />
          </label>
          <label className="form-field">
            <span>
              Status <span className="required-mark">*</span>
            </span>
            <select
              disabled={saving}
              id="team-status"
              name="status"
              onChange={handleChange}
              value={form.status}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Archived">Archived</option>
            </select>
          </label>
          <label className="form-field notes-field">
            <span>
              Notes <span className="optional-label">Optional</span>
            </span>
            <textarea
              disabled={saving}
              id="team-notes"
              name="notes"
              onChange={handleChange}
              rows={2}
              value={form.notes}
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
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add team'}
          </button>
        </div>
      </form>

      <section className="team-list-section" aria-labelledby="team-list-title">
        <div className="team-list-heading">
          <div>
            <h2 id="team-list-title">Team directory</h2>
            <p>
              {teams.length} {teams.length === 1 ? 'team' : 'teams'}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="teams-state" role="status">
            Loading teams…
          </div>
        ) : teams.length === 0 ? (
          <div className="teams-state empty-state">
            <span className="empty-symbol" aria-hidden="true">
              ＋
            </span>
            <strong>No teams yet</strong>
            <p>Add a team above to start organizing delivery capacity.</p>
          </div>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Team ID</th>
                  <th scope="col">Status</th>
                  <th scope="col">Notes</th>
                  {/* <th scope="col">Updated</th> */}
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.team_id}>
                    <td data-label="Team">
                      <strong>{team.team_name}</strong>
                    </td>
                    <td data-label="Team ID">
                      <span className="team-id-value">{team.team_id}</span>
                    </td>
                    <td data-label="Status">
                      <span className={`team-status status-${String(team.status).toLowerCase()}`}>
                        {team.status}
                      </span>
                    </td>
                    <td className="team-notes-cell" data-label="Notes">
                      {team.notes || '—'}
                    </td>
                    {/* <td data-label="Updated">{formatDate(team.updated_at)}</td> */}
                    <td className="team-actions-cell" data-label="Actions">
                      <button
                        className="row-action"
                        type="button"
                        onClick={() => beginEdit(team)}
                        disabled={saving || !snapshotReady}
                        aria-label={`Edit ${team.team_name}`}
                      >
                        Edit
                      </button>
                      <button
                        className="row-action"
                        type="button"
                        onClick={() => openCapacity(team)}
                        disabled={capacitySaving || !snapshotReady}
                        aria-label={`Manage capacity for ${team.team_name}`}
                      >
                        Capacity
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {capacityTeamId && (
        <section className="capacity-panel" aria-labelledby="capacity-title">
          <div className="capacity-panel-heading">
            <div>
              <div className="page-eyebrow">TEAM CAPACITY</div>
              <h2 id="capacity-title">
                {teams.find((team) => team.team_id === capacityTeamId)?.team_name ?? capacityTeamId}
              </h2>
              <p>Set independent Build and System Testing capacity for each release.</p>
            </div>
            <button className="text-button" type="button" onClick={() => setCapacityTeamId(null)}>
              Close
            </button>
          </div>
          {capacityError && (
            <div className="form-message error" role="alert">
              {capacityError}
            </div>
          )}
          {capacitySuccess && (
            <div className="form-message success" role="status">
              {capacitySuccess}
            </div>
          )}
          {releases.length === 0 ? (
            <div className="teams-state empty-state">
              <strong>No releases are available</strong>
              <p>Add a release before setting team capacity for it.</p>
            </div>
          ) : (
            <>
              <div className="capacity-table-wrap">
                <table className="team-table capacity-table">
                  <thead>
                    <tr>
                      <th scope="col">Release</th>
                      <th scope="col">Build capacity</th>
                      <th scope="col">ST capacity</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {releases.map((release) => {
                      const record = getCapacity(capacityTeamId, release.release_id);
                      return (
                        <tr key={release.release_id}>
                          <td data-label="Release">
                            <strong>{release.release_name}</strong>
                            <small className="release-id">{release.release_id}</small>
                          </td>
                          <td data-label="Build capacity">{record?.build_capacity ?? 'Not set'}</td>
                          <td data-label="ST capacity">{record?.st_capacity ?? 'Not set'}</td>
                          <td data-label="Actions">
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => selectCapacityRelease(release.release_id)}
                              disabled={!snapshotReady || capacitySaving}
                            >
                              {record ? 'Edit capacity' : 'Set capacity'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {capacityReleaseId && (
                <form className="capacity-form" onSubmit={saveCapacity}>
                  <h3>
                    {getCapacity(capacityTeamId, capacityReleaseId)
                      ? 'Update capacity'
                      : 'Set capacity'}
                  </h3>
                  <label className="form-field capacity-release-field">
                    <span>Release</span>
                    <select
                      value={capacityReleaseId}
                      onChange={(event) => selectCapacityRelease(event.target.value)}
                      disabled={capacitySaving || !snapshotReady}
                    >
                      <option value="">Choose a release</option>
                      {releases.map((release) => (
                        <option key={release.release_id} value={release.release_id}>
                          {release.release_name} ({release.release_id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Build capacity</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={capacityForm.build_capacity}
                      onChange={(event) => {
                        setCapacityForm((current) => ({
                          ...current,
                          build_capacity: event.target.value,
                        }));
                        setCapacityError('');
                      }}
                      disabled={capacitySaving || !snapshotReady}
                    />
                  </label>
                  <label className="form-field">
                    <span>ST capacity</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={capacityForm.st_capacity}
                      onChange={(event) => {
                        setCapacityForm((current) => ({
                          ...current,
                          st_capacity: event.target.value,
                        }));
                        setCapacityError('');
                      }}
                      disabled={capacitySaving}
                    />
                  </label>
                  <div className="team-form-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setCapacityReleaseId('');
                        setCapacityError('');
                        setCapacitySuccess('');
                      }}
                      disabled={capacitySaving}
                    >
                      Cancel
                    </button>
                    <button className="primary-button" type="submit" disabled={capacitySaving}>
                      {capacitySaving ? 'Saving…' : 'Save capacity'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
