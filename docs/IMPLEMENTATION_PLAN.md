# Release Scheduler — Implementation Plan

> Last updated: 2026-11-02 (team-scoped priority correction and Phase 4.3 dependency-arrow implementation in review)

---

## Project Overview

A web application for **Release Planning & Dependency Orchestration** serving multiple program managers over a local office network.

- **Frontend**: React (Vite)
- **Backend**: Node.js / Express
- **Persistence**: Shared Excel workbook (`.xlsx`) as primary data store; initial CSV import supported
- **Deployment**: Single designated Windows PC; users access via browser on the office LAN

---

## Core Domain Model

```
Release  ──< Feature ──< User Story
                │
                ├─ Build effort (estimate, original estimate, actual spent)
                ├─ ST effort    (estimate, original estimate, actual spent)
                └─ Dependencies (hard | normal) → other Features
```

- **Feature** is the primary planning entity. Each feature belongs to one release and has separate Build and ST effort fields.
- **User Stories** belong to a Feature and carry their own effort, but planning allocation is computed at the Feature level.
- A Feature is considered complete only when **both** its required Build effort and its ST effort are **actually done** — effort allocated or scheduled against a feature does not make it complete. Only work that has been fully executed (i.e., actual spent equals the required effort) counts as completion.

---

## Recommended Architecture

```
release_scheduler/
├── client/                  # React + Vite frontend
│   ├── src/
│   │   ├── components/      # Shared UI components
│   │   ├── pages/           # Route-level page components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── store/           # Zustand state slices
│   │   ├── services/        # API client (axios wrappers)
│   │   └── utils/           # Pure helpers (date math, dependency graph, etc.)
│   ├── index.html
│   └── vite.config.js
├── server/                  # Node.js + Express backend
│   ├── src/
│   │   ├── routes/          # REST endpoint definitions
│   │   ├── controllers/     # Request handlers
│   │   ├── services/        # Business logic (planning engine, scenario engine)
│   │   ├── persistence/     # Excel read/write layer (ExcelJS)
│   │   └── utils/           # Shared server utilities
│   ├── data/                # Workbook file lives here (configurable path)
│   └── index.js
├── docs/                    # Project documentation (this folder)
├── .gitignore
├── package.json             # Workspace root (npm workspaces)
└── README.md
```

### Key Technology Choices

| Concern           | Choice                                                       | Rationale                                                                               |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Backend framework | Express 5                                                    | Minimal, well-understood, easy to maintain                                              |
| Excel I/O         | ExcelJS                                                      | Full `.xlsx` read/write, runs in Node without COM/OLE                                   |
| Concurrency guard | In-process write-queue + file lock (proper-lockfile)         | Prevents corruption from simultaneous saves                                             |
| Frontend bundler  | Vite + React 18                                              | Fast HMR, simple setup                                                                  |
| State management  | Zustand                                                      | Lightweight, minimal boilerplate                                                        |
| Gantt chart       | Legacy dhtmlx-gantt v9.1.4 (GPL-2.0) for the Phase 4.1 spike | GPL obligations accepted for evaluation; see D01.6 and Phase 4.1 compliance assumptions |
| Routing           | React Router v6                                              | Standard                                                                                |
| HTTP client       | Axios                                                        | Interceptors for error handling                                                         |

---

## Concurrency Risk — Shared Workbook

> **Primary technical risk**: Multiple program managers saving simultaneously to the same `.xlsx` file can corrupt it.

**Mitigation strategy (server-side)**:

1. All write operations pass through a single async **write queue** — only one write runs at a time.
2. Before writing, the server acquires an **advisory file lock** (`proper-lockfile`).
3. The server holds the workbook **in-memory** as the canonical state; reads are served from memory (no re-read on every request). The file is flushed to disk on every confirmed mutation.
4. A **version/ETag counter** is incremented on every write; clients include the ETag on save — stale ETags are rejected with HTTP 409.
5. A short **debounce** (≈ 500 ms) coalesces rapid sequential mutations into one write.

> This phase intentionally supports a single server process and shared in-memory canonical state. The file lock prevents simultaneous filesystem corruption for the same workbook on the local machine, and the service also checks the on-disk workbook signature before writing so a stale second service instance is rejected instead of silently overwriting the current workbook. This still remains a single-server design; any multi-writer design would need an explicit on-disk version field or separate state store.

---

## Planning Engine Rules (confirmed)

### Priority Allocation

- Within each team's workload, features use **ascending numeric priority** (1 = highest); ties preserve `input_order`.
- Real releases are processed by ascending `priority_order` (then start date and workbook order for ties). Each feature is placed by the planner; its legacy `release_id` input is optional and does not constrain placement.
- Strict team priority carries across releases: an incomplete higher-priority feature gets first access to each later release before lower-priority work for that team can start. A feature can therefore span multiple real releases. Teams retain independent capacity pools, and unassigned features are not grouped into a team pool.
- For dependencies whose endpoints belong to the same non-empty team, the predecessor must have a strictly smaller numeric priority than its dependent. Cross-team dependencies do not compare priority values, but their graph edges always keep the predecessor before the dependent. Missing team assignments do not imply a shared team.

### Build / ST Sequencing

- ST capacity for a feature may only consume Build work that is **already completed and available for testing**.
- Unfinished Build work on a feature is never treated as ST-ready.
- A feature is complete only when both its required Build effort and its ST effort are actually done (work executed, not merely scheduled or allocated).

### Hard Dependency Blocking

- A hard dependency specifies: **predecessor feature**, **activity affected** (Build, ST, or both), and a **blocking percentage** (entered by the user).
- While the dependency is unresolved, the blocking percentage is applied to the **remaining effort** of the affected activity on the dependent feature. That portion of remaining effort cannot be allocated.
- **Blocked effort is not completed effort** — it simply cannot be scheduled until the dependency resolves.
- Multiple hard dependencies on the same feature are **additive**: the total blocked fraction is the sum of all individual percentages. Users enter percentages already accounting for any overlap between dependencies.
- Hard dependencies do **not** make any effort "completed"; they only delay the affected remaining effort.

### Normal Dependencies

- Normal dependencies express ordering preference but do **not** hard-block any effort.

### TBC Release Generation

- After considering capacity in every configured real release, the engine generates **TBC 1\*, TBC 2\*, …** for remaining schedulable work.
- For each team, each TBC release's Build and ST capacity is the **arithmetic mean** of the corresponding capacity across all configured real releases; a missing team/release capacity record contributes zero.
- TBC releases follow the established release cadence: **two 15-working-day sprints** followed by **one 5-working-day mini sprint**, with each sprint running **Wednesday through Tuesday**.
- The first generated sprint starts on the first Wednesday after the latest real release `end_date`; subsequent sprints start the day after the preceding sprint ends.
- No holiday-calendar adjustment is applied.
- Whether TBC releases auto-replan when capacity opens is an open question (Q4).

---

## Scenario Engine Rules (confirmed)

- A scenario is a **named set of effort adjustments** applied on top of the baseline plan.
- The global input is a **single percentage increase** between **5% and 50%** applied to all features.
- Individual feature **overrides** replace the global percentage for that feature. One percentage applies to both Build and ST for that feature.
- Scenario **definitions, overrides, and saved projections** are persisted in the workbook (their own sheets).
- Scenario **calculations** run against the baseline + overlay; they do not modify any baseline data.
- **Original estimates** and **actual spent effort** are never modified by scenario runs.
- Applying a scenario's overrides to the baseline requires explicit user confirmation ("Promote scenario").

---

## Phased Implementation Plan

### Phase 0 — Project Setup & Foundation

- [x] **0.1** Initialise Git repository (`.gitignore`, `README.md`)
- [x] **0.2** Create npm workspace root (`package.json` with workspaces: `client`, `server`)
- [x] **0.3** Scaffold `server/` with Express + basic health-check route (`GET /api/health`)
- [x] **0.4** Scaffold `client/` with Vite + React 18 (`npm create vite`)
- [x] **0.5** Configure Vite proxy so `client` dev server forwards `/api/*` to `server`
- [x] **0.6** Add ESLint + Prettier across both workspaces
- [x] **0.7** Validate server and client independently (workspace dev scripts, health endpoint, landing page, production build)
- [x] **0.8** Add `concurrently`, create combined root `npm run dev` script, and verify both applications together

### Phase 1 — Persistence Layer (Excel + CSV)

- [x] **1.1** Install and integrate `ExcelJS` in `server/`
- [x] **1.2** Define workbook schema — approved amendment to D03.7 adds `TeamReleaseCapacity` as the required tenth worksheet, while the other nine sheets remain unchanged and minimal workbook metadata remains in `Config` with no `WorkbookMeta` sheet.
- [x] **1.3** Implement `WorkbookService` class and verify this phase:
  - Load workbook from disk into memory on startup (create blank workbook if file is missing)
  - Expose typed read/write methods per entity type
  - Serialized async write queue with `proper-lockfile` for safe concurrent saves within the supported single-server architecture
  - In-memory cache as canonical state; flush to disk on mutations
  - Version/ETag counter incremented only after successful persistence; stale expected versions rejected with `WorkbookConflictError` suitable for HTTP 409 within one service instance
  - Verified via `server/scripts/verify-workbookservice.js` covering exact sheet order, row-validation failure paths, stale-version conflicts, concurrent mutation serialization, cross-instance boundary documentation, temporary-file replacement/recovery handling, backup restore failure reporting, and persistence rollback assurance
- [x] **1.4** Implement CSV import preview + confirm flow (`POST /api/import/csv/preview` and `POST /api/import/csv/confirm`):
  - Accept CSV text (server-side import service layer) with `csv-parse` and strict row validation
  - Enforce explicit `feature.*` versus `story.*` field ownership in the mapping contract to avoid ambiguous shared columns
  - Require a valid non-negative integer `workbookVersion` before any workbook mutation; reject missing, empty, non-numeric, negative, or fractional values with HTTP 400 at the route and service layers
  - Reject stale versions with HTTP 409 and keep the existing serialized mutation + persistence safeguards in place during the final write stage
  - Reject malformed rows, duplicate headers, missing/extra columns, and failed imports without mutating the workbook
  - Preview before import and require explicit confirmation before persisting changes
  - Persist imported Features and User Stories with independent estimates and zero actual-spent defaults unless provided by the CSV
  - Verified via `server/scripts/verify-csvimport.js` and the full required repo verification sequence (`verify-csvimport.js`, `verify-workbookservice.js`, lint, format check, client build)
- [x] **1.5** Implement CRUD REST endpoints:
  - `GET/POST/PUT/DELETE /api/teams`
  - `GET/POST/PUT/DELETE /api/releases`
  - `GET/POST/PUT/DELETE /api/features`
  - `GET/POST/PUT/DELETE /api/features/:id/stories`
  - `GET/POST/PUT/DELETE /api/dependencies`
  - Validation includes required `expectedVersion`, stale-version 409 conflict handling, target/foreign-key validation, and delete guards against orphaning dependent rows
- [x] **1.6** Implement configuration persistence (`GET/PUT /api/config`):
  - `GET /api/config` returns the current workbook configuration as typed values
  - `PUT /api/config` supports partial updates with required `expectedVersion`, stale-version 409 rejection, key/value validation, system-managed metadata protection, and persistence under the existing serialized mutation safeguards
- [x] **1.7** Implement Team–Release capacity API (`GET /api/capacities`, `GET /api/capacities/:teamId/:releaseId`, `PUT /api/capacities/:teamId/:releaseId`):
  - list and retrieve capacity records via `WorkbookService`
  - validate team/release existence and required Build/ST capacity values
  - enforce composite-key uniqueness and required `expectedVersion` checks with HTTP 400/409 semantics
  - preserve workbook persistence safeguards, reject stale or invalid writes without mutating data, and keep the operation scoped to the approved `TeamReleaseCapacity` model only

### Phase 2 — Input Screens (Frontend)

- [x] **2.1** App shell: navigation sidebar, header, routing structure; placeholder navigation destinations are clearly marked as not implemented
- [x] **2.2** **Teams page**: list, add, edit teams; define Build and ST capacity per configured release using the existing Team–Release Capacity API
- [x] **2.3** **Releases page**: list, add, edit releases; set target dates and priority
- [x] **2.4** **Features page**: list, add, edit features within a release
  - Fields: name, priority, input order (auto-assigned, user-adjustable for ties), team assignment
  - Separate Build and ST estimate fields; display original estimate read-only alongside current estimate
  - Display actual spent read-only; never editable via scenario runs
  - User story sub-list per feature (expand/collapse)
- [x] **2.5** **User Stories page / panel**: add, edit, reorder stories within a feature; effort fields per story
- [x] **2.6** **Dependencies page**: define hard/normal dependencies between features
  - For hard dependencies: select affected activity (Build | ST | Both) and enter blocking percentage
  - Display dependency graph as a summary table; surface cycles as validation errors
  - Backend validation now enforces required hard-dependency fields, feature-pair uniqueness, and directed cycle rejection within the serialized, expected-version-checked mutation.
- [x] **2.7** **Import page**: CSV file upload, column-mapping UI, import preview and explicit add/replace confirmation with preview workbook-version enforcement
- [x] **2.8** Form validation, error states, loading states across all screens
- [x] **2.9** Optimistic UI updates with workbook-version conflict detection (HTTP 409 → re-fetch and notify user)

### Phase 3 — Planning Engine (Backend)

- [x] **3.1** Implement dependency graph builder: topological sort, cycle detection, surface cycles as errors
  - Pure backend utility builds predecessor-to-dependent edges for Hard and Normal dependencies, includes isolated features, returns deterministic topological order (input order, then feature ID), and reports cycles and missing feature references with structured errors
- [x] **3.2** Implement **hard dependency blocking**:
  - Remaining effort is `max(0, current estimate - actual spent)` independently for Build and ST
  - For each unresolved Hard dependency affecting the activity, compute a contribution as `remaining_effort × blocking_pct / 100`
  - Multiple dependencies are additive; total blocked effort is capped at remaining effort
  - Blocked effort is withheld from scheduling; it is not treated as complete
  - Implemented as a pure utility; dependency status is the authoritative unresolved/resolved state, and allocation-time ST gating remains in scope for a later allocation phase
- [x] **3.3** Implement **normal dependency ordering**: respects predecessor ordering but does not block effort
  - Pure ordering utility reuses the dependency graph for edge, reference, and cycle validation; among currently eligible features, same-team priority ranks first, while input order/feature ID deterministically compare different teams; dependency edges always take precedence
  - Dependency priority validation requires a strictly smaller predecessor priority only when both endpoints have the same non-empty `team_id`; cross-team dependencies still constrain ordering but have no cross-team priority comparison
  - Dependencies remain ordering constraints regardless of `dependency_status`, matching the existing graph behavior; ordering does not create blocked effort
- [x] **3.4** Implement **strict priority-based allocation**:
  - Allocate features by ascending numeric priority within each team, breaking ties by input order; carry unfinished feature effort across real releases in ascending release `priority_order` before allowing lower-priority team work to start
  - Validate same-team dependency priority relationships before allocation; cross-team dependencies preserve predecessor ordering without comparing priority values
  - An incomplete feature blocks lower-priority features for the same team across subsequent releases, including when it is hard-blocked or has exhausted the current release capacity; other teams proceed independently, and unassigned features do not join a team's pool
  - Allocate Build and dependency-adjusted ST forecasts against their independent capacity pools for each feature before advancing; report incomplete reasons when capacity, hard blocking, team assignment, or priority prevents further allocation
  - Build actual-spent values do not gate forecast ST allocation and are never modified by planning; actual completion remains distinct from allocated effort
  - Respect hard-dependency blocked fractions before allocating
  - Consume each supplied team/release capacity value in release-priority order; keep independent Build/ST balances and return remaining balances without persisting them
  - Pure utility returns aggregate per-feature effort plus each real-release allocation and per-pool capacity accounting
- [x] **3.5** Implement **TBC release generation**:
  - Trigger when all real-release capacity is exhausted
  - Generate each team's TBC Build and ST capacity from the arithmetic mean across configured real releases; missing team/release rows count as zero
  - TBC cadence: sprint 1 (15 working days, Wed–Tue), sprint 2 (15 working days, Wed–Tue), mini (5 working days, Wed–Tue)
  - Strict priority blocking in each generated release is scoped per team and carries forward the real-release priority queue
  - Start the first TBC sprint on the first Wednesday after the latest real release end date; generate TBC 1\*, TBC 2\*, … only while schedulable work makes progress; no holiday adjustments
  - Preserve priority/dependency checks, hard blockers, and immutable inputs; forecast ST against independent TBC ST capacity without an actual-Build prerequisite; report unresolved or no-progress work without generating empty releases
  - Implemented as a pure utility using Phase 3.4 allocation output; generated release and capacity records remain in-memory results only
- [x] **3.6** Implement planning engine entry point: `computePlan(state) → PlanResult`
  - Required state contract: `{ teams, releases, features, stories, dependencies, capacities, config }`; `stories` are separate User Stories worksheet records keyed by `feature_id`, and `capacities` are required TeamReleaseCapacity records because Phase 3.4 allocation consumes per-team/per-release capacity
  - Config is accepted as the existing typed configuration map; the current planning utilities do not consume config overrides, and TBC cadence follows the confirmed fixed D07 policy
  - Reuse dependency graph, ordering, hard-blocking, allocation, and TBC generation utilities; validate cross-sheet team/story references and allocation result shape
  - Output includes feature ordering, dependency graph, hard-blocking details, real allocation, generated TBC releases/capacities, per-feature release/sprint schedule with stories, unresolved blockers, and no-progress reasons
  - Validation failures are raised as structured `PlanComputationError` instances with code, stage, cause, and relevant entity details; no input mutation or persistence
- [x] **3.7** Expose `POST /api/plan/compute` endpoint (stateless — computes but does not save automatically)
  - Build the input from one canonical `WorkbookService` instance: teams, releases, features, User Stories, dependencies, TeamReleaseCapacity, and config
  - Return `{ ok: true, data: PlanResult, workbookVersion }`; reject request-supplied planning state so the workbook remains the sole source of truth
  - Check the loaded WorkbookService snapshot before and after computation; return the established 409 conflict response if the backing workbook changes
  - Planning allocations and generated TBC releases are response-only; no workbook writes or planning-result persistence
- [x] **3.8** Complete comprehensive planning-engine verification using the repository's focused Node verification scripts (no additional test framework or dependency):
  - Priority ordering and strict blocking
  - ST gating (Build must be complete before ST allocates)
  - Hard dependency partial blocking and additivity
  - TBC generation with correct mean capacity and cadence
  - Cycle detection, invalid references, dependency priority validation, deterministic output, input immutability, and structured errors
  - `computePlan` orchestration and real workbook-backed `POST /api/plan/compute` integration, including consistent version, read-only behavior, safe errors, and concurrent workbook replacement

### Phase 4 — Gantt Visualization (Frontend)

- [x] **4.1** Integrate Gantt chart library as a limited, isolated read-only spike
  - Pin legacy `dhtmlx-gantt` v9.1.4 (`GPL-2.0`); include the license text and upstream source notice
  - Render isolated mock release/feature bars with dates and parent/child hierarchy in the existing schedule route
  - No workbook/planning-service data, editing, scheduling, or persistence; licensing and maintenance assumptions are recorded in `PROGRESS.md`
- [x] **4.2** Render planned releases and features as read-only Gantt bars grouped by release and following the planning result's dependency-aware order (same-team priority; deterministic input order across teams)
  - Keep `POST /api/plan/compute` unchanged. Add read-only `POST /api/plan/schedule` for the stage schedule projection; it accepts the plan and `expectedVersion`, verifies both against one canonical WorkbookService snapshot, and returns the schedule with `workbookVersion`
  - Pure `scheduleFeatureStages(plan, { releases, capacities })` derives feature-level Build/ST dates from actual allocations and authoritative real-release windows; generated TBC release windows come from the PlanResult
  - Use 1 SP = 1 working day, Monday–Friday, no holiday adjustments; retain effort-based durations and project every feature allocated to a release from that release's start in parallel, in planning consideration order
  - Build and ST start together for a feature. ST effort retains its allocated SP/duration; when ST effort is at most Build effort, its visual bar spans through Build's finish. ST longer than Build determines feature finish
  - Missing/invalid release windows, zero allocations, blocked/partial work, and unscheduled stages receive explicit statuses/reasons; valid release start dates anchor feature bars, while release end dates do not cap allocation or feature bars, which may extend beyond the configured release row
  - Weekly timeline cells use readable `Week N` labels with compact horizontal padding; each release row's Timeline status is cumulative through that release and displays `Complete` only when cumulative Build and ST allocations cover their respective requirements, separately from actual delivery and dependency resolution
  - Carry feature/team names into release feature rows, keep left-grid labels separate from effort-only bar labels, and omit zero-allocation release placeholders unless outstanding or Hard-blocked work must remain visible
  - Render the existing Gantt library read-only with release groups, feature rows, and allocated Build/ST stage bars. No chart state, allocations, or schedule is persisted
  - Focused utility, API integration, and frontend verification cover policy, version consistency, errors, TBC grouping, empty/loading states, and absence of UI mutation requests
- [ ] **4.3** Show dependency arrows between features (hard dependencies distinctly styled)
  - Display existing dependency records between release-specific feature rows only; do not create or persist scheduling changes
  - Select the latest dated predecessor instance and earliest dated dependent instance when features span releases; omit links without dated endpoints and report a diagnostic
  - Preserve dependency type/status in task tooltips; style Hard and Normal links distinctly
- [ ] **4.4** Highlight TBC releases and blocked features visually
- [ ] **4.5** Filter controls: by team, by release, by status, by dependency type
- [ ] **4.6** Tooltip on hover: feature name, team, sprint, Build/ST estimate, blocked percentage, status
- [ ] **4.7** Read-only export: print-friendly view / PNG snapshot

### Phase 5 — What-If Scenario Engine

- [ ] **5.1** Implement scenario data model:
  - Scenario: id, name, global_pct (5–50%), created_at
  - Override: scenario_id, feature_id, override_pct (replaces global_pct for that feature)
  - Projection: scenario_id, saved_at, serialised PlanResult
  - Persisted in workbook; baseline data is never touched
- [ ] **5.2** `GET/POST /api/scenarios` — list and create scenarios
- [ ] **5.3** `DELETE /api/scenarios/:id` — delete scenario and all its overrides/projections
- [ ] **5.4** `GET/PUT /api/scenarios/:id/overrides` — read and write per-feature override percentages
- [ ] **5.5** `POST /api/scenarios/:id/compute` — run planning engine with (global_pct + per-feature overrides) applied to estimates; return result; do **not** modify baseline estimates or actual spent
- [ ] **5.6** `POST /api/scenarios/:id/projections` — persist a named snapshot of the computed result
- [ ] **5.7** Scenario UI: list, create, delete scenarios; set global percentage; set per-feature overrides
- [ ] **5.8** Scenario comparison view: side-by-side Gantt or table comparing baseline vs one or more scenarios
- [ ] **5.9** "Promote scenario" action: apply scenario overrides to baseline estimates with explicit user confirmation; log the promotion event
- [ ] **5.10** Write unit tests for scenario engine: global %, per-feature override, original estimate immutability

### Phase 6 — Testing & Hardening

- [ ] **6.1** Integration tests: CSV import → plan compute → scenario → save → re-load
- [ ] **6.2** Concurrency stress test: simulate 3–5 simultaneous saves; verify workbook integrity and ETag rejection
- [ ] **6.3** Planning engine edge cases: dependency cycles, 100% blocking, all features in TBC
- [ ] **6.4** ST gating test: verify ST effort is not allocated before sufficient Build is complete
- [ ] **6.5** TBC cadence test: verify correct mean capacity and Wed–Tue sprint dates
- [ ] **6.6** Frontend: component tests with React Testing Library
- [ ] **6.7** Manual UAT with at least one program manager; collect and address feedback
- [ ] **6.8** Error boundary and graceful degradation review
- [ ] **6.9** Security review: input sanitisation, no path-traversal in file operations

### Phase 7 — Deployment & Handover

- [ ] **7.1** Production build script: `npm run build` → `client/dist` served by Express as static files (no separate web server needed)
- [ ] **7.2** Configuration file (`server/config.json` or `.env`): workbook path, server port, allowed CORS origins
- [ ] **7.3** Windows startup: document running as a Windows Service (e.g., `node-windows` or Task Scheduler)
- [ ] **7.4** Backup strategy: daily automated copy of the workbook to a dated backup folder
- [ ] **7.5** Write `docs/RUNBOOK.md`: startup, shutdown, backup, recovery, adding users
- [ ] **7.6** Write `docs/USER_GUIDE.md`: how PMs use each screen
- [ ] **7.7** Handover session with the team; confirm no open bugs

---

## Open Technical Questions

> Do not resolve these silently during implementation. Raise with the user before the indicated phase.

| #   | Question                                                                                                                                                                 | Needed by   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Q3  | **Authentication**: Do program managers need individual logins, or is LAN-level access sufficient?                                                                       | Phase 7     |
| Q4  | **TBC auto-replan**: Should TBC releases auto-promote when real-release capacity opens (re-plan on demand), or remain static until the user explicitly re-runs planning? | Phase 3 / 5 |
