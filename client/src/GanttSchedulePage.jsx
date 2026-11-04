import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import { formatApiError } from './apiErrors';
import {
  addUndatedDependencyLayer,
  addGanttExclusiveEndDates,
  loadComputedGanttSchedule,
  loadScenarioGanttSchedule,
  filterGanttViewByTeam,
  makeGanttExportGrid,
  makeGanttExportRows,
  makeGanttTasks,
} from './ganttPlanView';
import { configureGantt, mountGanttChart, updateGanttTasks } from './ganttLifecycle';

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
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function readableReason(reason) {
  return String(reason).replaceAll('_', ' ');
}

// eslint-disable-next-line react/prop-types
function GanttChart({ tasks, links }) {
  const containerRef = useRef(null);
  const scheduleRef = useRef({ tasks, links });

  useEffect(() => {
    configureGantt(gantt);
    const unmountGantt = mountGanttChart(gantt, containerRef.current);
    const removeUndatedDependencyLayer = addUndatedDependencyLayer(gantt, scheduleRef);
    return () => {
      removeUndatedDependencyLayer();
      unmountGantt();
    };
  }, []);

  useEffect(() => {
    scheduleRef.current = { tasks, links };
    updateGanttTasks(gantt, tasks, links, addGanttExclusiveEndDates);
  }, [tasks, links]);

  return (
    <div
      className="gantt-spike-chart"
      ref={containerRef}
      aria-label="Read-only release plan timeline"
    />
  );
}

export default function GanttSpike() {
  const initialLoadStarted = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [globalPercent, setGlobalPercent] = useState(0);
  const [overrides, setOverrides] = useState({});
  const [scenario, setScenario] = useState(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const load = useCallback(async () => {
    try {
      setResult(await loadComputedGanttSchedule(requestJson));
    } catch (loadError) {
      setResult(null);
      setError(formatApiError(loadError, 'The release plan could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!result) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setScenarioLoading(true);
      setScenarioError('');
      try {
        const next = await loadScenarioGanttSchedule(requestJson, globalPercent, overrides);
        if (!cancelled) setScenario(next);
      } catch (loadError) {
        if (!cancelled) {
          setScenario(null);
          setScenarioError(formatApiError(loadError, 'The scenario could not be computed.'));
        }
      } finally {
        if (!cancelled) setScenarioLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [result, globalPercent, overrides]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    Promise.resolve().then(load);
  }, [load]);

  const dependencies = result?.plan?.dependency_graph?.edges;
  const view = useMemo(
    () =>
      result
        ? makeGanttTasks(result.featureSchedule, dependencies || [])
        : { tasks: [], statusRows: [], links: [], linkDiagnostics: [] },
    [result, dependencies]
  );
  const featureCount = result?.plan?.schedule?.length || 0;
  const hasScenarioInput = globalPercent !== 0 || Object.keys(overrides).length > 0;
  const displayResult = hasScenarioInput && !scenarioError ? scenario : result;
  const displayView = useMemo(() => {
    if (!displayResult) return { tasks: [], statusRows: [], links: [], linkDiagnostics: [] };
    return makeGanttTasks(
      displayResult.featureSchedule,
      displayResult.plan?.dependency_graph?.edges || []
    );
  }, [displayResult]);
  const teams = useMemo(() => {
    const byId = new Map();
    for (const feature of result?.plan?.schedule || []) {
      if (feature.team_id === null || feature.team_id === undefined || feature.team_id === '') continue;
      byId.set(String(feature.team_id), String(feature.team_name || feature.team_id));
    }
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [result]);
  const visibleView = useMemo(
    () => filterGanttViewByTeam(displayResult ? displayView : view, selectedTeamId),
    [displayResult, displayView, selectedTeamId, view]
  );

  const exportToExcel = useCallback(async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch('/api/plan/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: makeGanttExportRows(visibleView.tasks),
          gantt: makeGanttExportGrid(visibleView.tasks),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Export failed with status ${response.status}.`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date();
      const dateStamp = `${String(today.getDate()).padStart(2, '0')}${String(today.getMonth() + 1).padStart(2, '0')}${today.getFullYear()}`;
      link.download = `schedular_output_${dateStamp}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(formatApiError(error, 'The schedule could not be exported.'));
    } finally {
      setExporting(false);
    }
  }, [visibleView]);

  useEffect(() => {
    for (const diagnostic of view.linkDiagnostics) {
      console.warn(
        `Gantt dependency ${diagnostic.dependency_id ?? ''} omitted: ${diagnostic.reason}`
      );
    }
  }, [view.linkDiagnostics]);

  return (
    <section className="gantt-spike-page">
      <div className="page-eyebrow">INSIGHTS · RELEASE PLAN</div>
      <div className="page-heading-row">
        <div>
          <h1>Release and feature schedule</h1>
          <p className="page-subtitle">
            Read-only effort allocations and projected release timeline from the current planning
            result.
          </p>
        </div>
        <div className="gantt-page-actions">
          <span className="phase-chip">Computed plan · no edits saved</span>
          <button
            className="secondary-button"
            type="button"
            onClick={exportToExcel}
            disabled={loading || exporting || !makeGanttExportRows(visibleView.tasks).length}
          >
            {exporting ? 'Preparing Excel…' : 'Export to Excel'}
          </button>
          {exportError && <span className="gantt-scenario-error" role="alert">{exportError}</span>}
        </div>
      </div>

      {loading ? (
        <div className="teams-state" role="status">
          Computing the current release plan…
        </div>
      ) : error ? (
        <div className="gantt-error-state" role="alert">
          <div>
            <strong>Schedule unavailable</strong>
            <p>{error}</p>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              setLoading(true);
              setError('');
              load();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : featureCount === 0 ? (
        <div className="teams-state empty-state" role="status">
          <span className="empty-symbol" aria-hidden="true">
            ◷
          </span>
          <strong>No features in the computed plan</strong>
          <p>Add features and release data to see a schedule.</p>
        </div>
      ) : (
        <>
          <div className="gantt-schedule-ribbon">
            <details className="gantt-spike-card gantt-scenario-card">
            <summary className="gantt-scenario-heading">What-if estimation changes</summary>
            <div className="gantt-scenario-content">
              <div className="gantt-spike-note">
                <span>Adjust current Build and ST estimates; actual spent and original estimates stay unchanged.</span>
              </div>
            <label className="gantt-scenario-global">
              Global increase: {globalPercent}%
              <input
                aria-label="Global estimation increase"
                type="range"
                min="0"
                max="50"
                step="1"
                value={globalPercent}
                onChange={(event) => setGlobalPercent(Number(event.target.value))}
              />
            </label>
            <details>
              <summary>Per-feature overrides</summary>
              <ul className="gantt-scenario-overrides">
                {result.plan.schedule.map((feature) => (
                  <li key={feature.feature_id}>
                    <label>
                      <span>{feature.feature_name || feature.feature_id} (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        placeholder={`${globalPercent}`}
                        aria-label={`${feature.feature_name || feature.feature_id} estimation override percentage`}
                        value={overrides[feature.feature_id] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value !== '' && (!/^\d+(\.\d+)?$/.test(value) || Number(value) > 50)) {
                            setScenarioError('Enter a percentage from 0 to 50.');
                            return;
                          }
                          setOverrides((current) => {
                            const next = { ...current };
                            if (value === '') delete next[feature.feature_id];
                            else next[feature.feature_id] = Number(value);
                            return next;
                          });
                        }}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </details>
            <p role="status" className="gantt-scenario-global">{scenarioLoading ? 'Recalculating scenario…' : 'Scenario results are temporary and are not saved.'}</p>
            {scenarioError && <p className="gantt-scenario-error" role="alert">{scenarioError}</p>}
            </div>
          </details>
            {teams.length > 1 && (
              <label className="gantt-team-filter">
                Team
                <select
                  aria-label="Filter schedule by team"
                  value={selectedTeamId}
                  onChange={(event) => setSelectedTeamId(event.target.value)}
                >
                  <option value="">All teams</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <section className="gantt-spike-card" aria-label="Computed release plan">
            <div className="gantt-spike-note">
              <strong>{scenario ? 'What-if projection' : 'Baseline projection'} · workbook version {result.workbookVersion}</strong>
              <span>
                Build and ST allocation uses aggregate team capacity. Features in the same release
                can run in parallel; release dates provide timeline context, not capacity limits.
              </span>
            </div>
            <p className="gantt-dependency-legend" aria-label="Dependency arrow legend">
              Dependencies: <span className="dependency-legend-hard">Hard (solid, stronger)</span>
              {' · '}
              <span className="dependency-legend-normal">Normal (dashed, subtle)</span>
            </p>
            <GanttChart tasks={visibleView.tasks} links={visibleView.links} />
            {visibleView.statusRows.length > 0 && (
              <section className="gantt-status-list" aria-labelledby="gantt-status-heading">
                <h2 id="gantt-status-heading">Partial and unscheduled work</h2>
                {visibleView.statusRows.map((row) => (
                  <div className="gantt-status-row" key={row.id}>
                    <strong>{row.label}</strong>
                    <span className={`gantt-status-badge status-${row.status}`}>{row.status}</span>
                    <span>
                      {[row.effortSummary, row.reasons.map(readableReason).join(', ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
              </section>
            )}
          </section>
        </>
      )}
      <div className="gantt-spike-license">
        dhtmlxGantt 9.1.4 · GPL-2.0 ·{' '}
        <a href="/licenses/dhtmlx-gantt-GPL-2.0.txt" target="_blank" rel="noreferrer">
          license text
        </a>{' '}
        ·{' '}
        <a href="https://github.com/DHTMLX/gantt/tree/gpl" target="_blank" rel="noreferrer">
          source
        </a>
        <span> Production distribution compliance review remains outstanding.</span>
      </div>
    </section>
  );
}
