import React, { useEffect, useState } from 'react';
import DependenciesPage from './DependenciesPage';
import FeaturesPage from './FeaturesPage';
import ImportPage from './ImportPage';
import ReleasesPage from './ReleasesPage';
import StoriesPage from './StoriesPage';
import TeamsPage from './TeamsPage';
import GanttErrorBoundary from './GanttErrorBoundary';

const sections = [
  { id: 'overview', label: 'Overview', icon: '◫', group: 'Workspace' },
  { id: 'teams', label: 'Teams', icon: '◉', group: 'Planning' },
  { id: 'releases', label: 'Releases', icon: '▤', group: 'Planning' },
  { id: 'features', label: 'Features', icon: '◇', group: 'Planning' },
  { id: 'stories', label: 'User Stories', icon: '☷', group: 'Planning' },
  { id: 'dependencies', label: 'Dependencies', icon: '⌘', group: 'Planning' },
  { id: 'import', label: 'Import data', icon: '⇧', group: 'Planning' },
  { id: 'schedule', label: 'Schedule & Forecast', icon: '▥', group: 'Insights' },
  // { id: 'scenarios', label: 'What-if scenarios', icon: '◎', group: 'Insights' },
];

const GanttSchedulePage = React.lazy(() => import('./GanttSchedulePage'));

const descriptions = {
  teams: 'Organize delivery teams and plan independent Build and System Testing capacity.',
  releases: 'Set up real releases, target dates, and release ordering.',
  features: 'Plan feature priorities, team assignments, and Build and ST estimates.',
  stories: 'Track user stories and their effort within each feature.',
  dependencies: 'Describe hard blockers and ordering relationships between features.',
  import: 'Map a CSV file, review its contents, and import your starting data.',
  schedule: 'Explore planned delivery, capacity utilization, and dependency flow.',
  scenarios: 'Compare named effort scenarios while keeping baseline estimates intact.',
};

function getRoute() {
  const segment = window.location.hash.replace(/^#\/?/, '').split('/').pop();
  return sections.some((section) => section.id === segment) ? segment : 'overview';
}

function routeHref(id) {
  return id === 'overview' ? '/' : `/#/${id}`;
}

export default function App() {
  const [activeId, setActiveId] = useState(getRoute);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeSection = sections.find((section) => section.id === activeId);

  useEffect(() => {
    const updateRoute = () => setActiveId(getRoute());
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  function navigate(event, id) {
    event.preventDefault();
    window.history.pushState({}, '', routeHref(id));
    setActiveId(id);
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <a className="brand" href="/" onClick={(event) => navigate(event, 'overview')}>
            <span className="brand-mark" aria-hidden="true">
              R
            </span>
            <span className="brand-name">Release Scheduler</span>
          </a>
          <button
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand navigation panel' : 'Collapse navigation panel'}
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            type="button"
          >
            <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
          </button>
        </div>
        <div className="workspace-label">APPLICATION</div>
        <nav aria-label="Main navigation">
          {['Workspace', 'Planning', 'Insights'].map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-heading">{group}</div>
              {sections
                .filter((section) => section.group === group)
                .map((section) => (
                  <a
                    aria-label={section.label}
                    aria-current={activeId === section.id ? 'page' : undefined}
                    className={`nav-link${activeId === section.id ? ' active' : ''}`}
                    href={routeHref(section.id)}
                    key={section.id}
                    onClick={(event) => navigate(event, section.id)}
                    title={section.label}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      {section.icon}
                    </span>
                    <span className="nav-label">{section.label}</span>
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" /> Internal planning workspace
        </div>
      </aside>

      <div className="main-column" >
        <header className="topbar">
          <div className="breadcrumb">
            Release Scheduler <span>/</span> {activeSection.label}
          </div>
          <div className="topbar-note">
            <span className="status-dot" /> Local workspace
          </div>
        </header>
        <main className={`content${activeId === 'schedule' ? ' content-gantt' : ''}`}>
          {activeId === 'teams' ? (
            <TeamsPage />
          ) : activeId === 'releases' ? (
            <ReleasesPage />
          ) : activeId === 'features' ? (
            <FeaturesPage />
          ) : activeId === 'stories' ? (
            <StoriesPage />
          ) : activeId === 'dependencies' ? (
            <DependenciesPage />
          ) : activeId === 'import' ? (
            <ImportPage />
          ) : activeId === 'schedule' ? (
            <React.Suspense fallback={<div className="teams-state">Loading Gantt spike…</div>}>
              <GanttErrorBoundary>
                <GanttSchedulePage />
              </GanttErrorBoundary>
            </React.Suspense>
          ) : activeId === 'overview' ? (
            <>
              <div className="page-eyebrow">PLANNING WORKSPACE</div>
              <div className="page-heading-row">
                <div>
                  <h1>Plan releases with clarity.</h1>
                  <p className="page-subtitle">
                    Coordinate teams, delivery priorities, and testing capacity in one place.
                  </p>
                </div>
                <span className="phase-chip">Shell preview</span>
              </div>
              <section className="welcome-card">
                <div className="welcome-copy">
                  <span className="card-kicker">YOUR PLANNING WORKSPACE</span>
                  <h2>A clearer view of what ships, and when.</h2>
                  <p>
                    Release Scheduler brings release plans, team capacity, and feature dependencies
                    together. The application shell is ready; planning tools are being built in
                    upcoming phases.
                  </p>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-line line-one" />
                  <div className="art-line line-two" />
                  <div className="art-card">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="art-orbit orbit-one" />
                  <div className="art-orbit orbit-two" />
                </div>
              </section>
              <div className="section-title-row">
                <div>
                  <h2>Planning areas</h2>
                  <p>Choose an area to explore the workspace.</p>
                </div>
                <span className="muted-count">{sections.length - 1} areas</span>
              </div>
              <div className="area-grid">
                {sections
                  .filter((section) => section.id !== 'overview')
                  .map((section) => (
                    <a
                      className="area-card"
                      href={routeHref(section.id)}
                      key={section.id}
                      onClick={(event) => navigate(event, section.id)}
                    >
                      <span className="area-icon" aria-hidden="true">
                        {section.icon}
                      </span>
                      <span className="area-card-copy">
                        <strong>{section.label}</strong>
                        <small>{descriptions[section.id]}</small>
                      </span>
                      <span className="card-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  ))}
              </div>
            </>
          ) : (
            <section className="placeholder-page">
              <div className="page-eyebrow">{activeSection.group.toUpperCase()}</div>
              <div className="placeholder-icon" aria-hidden="true">
                {activeSection.icon}
              </div>
              <h1>{activeSection.label}</h1>
              <p className="page-subtitle">{descriptions[activeId]}</p>
              <div className="coming-soon">
                <span className="coming-dot" />
                <div>
                  <strong>Planned functionality</strong>
                  <p>
                    This area is not implemented yet. It is included to establish the application
                    navigation.
                  </p>
                </div>
              </div>
              <a className="back-link" href="/" onClick={(event) => navigate(event, 'overview')}>
                ← Back to overview
              </a>
            </section>
          )}
        </main>
        <footer className="app-footer">
          <span>Release Scheduler</span>
          <span>Built for thoughtful release planning</span>
        </footer>
      </div>
    </div>
  );
}
