# Release Scheduler â€” Progress Tracker

> Last updated: 2026-11-02 - Phase 4.2 aggregate-capacity allocation and parallel feature timeline correction implemented and automated checks passed; browser visual verification remains pending.

---

## Current Phase & Step

**Phase: 4 - Gantt Visualization (Frontend)**
**Current step: Phase 4.2 Gantt corrective fixes - aggregate capacity and parallel same-release features verified; browser visual verification pending**
**Next step: Phase 4.3 - dependency arrows; not started**

---

## Completed Tasks

- [x] Workspace inspected: directory was empty; no existing code to preserve
- [x] Runtime environment catalogued (Node.js 24.14.1, npm 11.11.0, Git 2.53.0, Python 3.14.3; pnpm not installed)
- [x] Architecture recommended and documented
- [x] Concurrency risk identified and mitigation strategy defined
- [x] `docs/IMPLEMENTATION_PLAN.md` created (rev 1)
- [x] `docs/PROGRESS.md` created (rev 1)
- [x] `docs/DECISIONS.md` created (rev 1)
- [x] Documentation alignment (rev 2): reconciled Feature model, priority/ST/dependency/TBC/scenario rules; corrected 8 contradictions
- [x] **Phase 0.1 â€” Git & project root files** _(rev 3)_
  - Git repository initialised (`git init`) â€” fresh, empty repository
  - `.gitignore` created: covers `node_modules/`, build outputs, `.env` / secrets, logs, runtime workbook files (`server/data/*.xlsx`), editor and OS artefacts; `docs/` is explicitly not excluded
  - `README.md` created: describes the project, planned features, technology stack, deployment model, project structure, and development status; clearly labelled "under development"
  - `docs/DECISIONS.md` updated: D03.2 workbook location moved from Assumed â†’ **Confirmed** (server local disk); D04.3 feature-completion rule clarified (allocated â‰  completed); Q2 removed from open questions
  - `docs/IMPLEMENTATION_PLAN.md` updated: Phase 0.1 checkbox ticked; feature-completion rule corrected; Q2 removed from open questions table
- [x] **Phase 0.2 â€” npm workspace root `package.json`** _(rev 4)_
  - `package.json` created at project root
  - `"private": true` â€” prevents accidental npm publish
  - `"workspaces": ["client", "server"]` â€” matches `IMPLEMENTATION_PLAN.md`
  - `"engines"`: Node â‰¥ 20, npm â‰¥ 10
  - Only a no-op `test` script added; no scripts referencing non-existent files
  - JSON validity confirmed via `node -e "require('./package.json')"`
- [x] **Phase 0.3 â€” Express server scaffold** _(rev 5)_
  - `server/package.json` created (`"private": true`, `start` and `dev` scripts)
  - `server/src/index.js` created: Express 5 app, configurable port (default 3001), `GET /api/health`
  - `server/data/.gitkeep` created to preserve the runtime data directory in git
  - Express 5.3.0 installed (65 packages, 0 vulnerabilities)
  - `server/node_modules/` confirmed excluded by `.gitignore`
  - Health endpoint verified: `HTTP 200` â†’ `{"status":"ok","service":"release-scheduler-server","timestamp":"..."}`
- [x] **Phase 0.4 â€” Scaffold client with Vite + React 18** _(rev 6)_
  - `client/package.json` created (`"private": true`, `"type": "module"`)
  - Explicitly installed React 18 (`react@18.3.1`, `react-dom@18.3.1`, `vite@6.4.5`, `@vitejs/plugin-react@4.7.0`)
  - Minimal standard client structure created: `index.html`, `vite.config.js`, `src/main.jsx`, `src/App.jsx`, `src/index.css`
  - Clean landing page indicating "Under Active Development" and showing architectural summary
  - Build verified (`npm run build` completed in 1.58s; output in `client/dist/`)
  - Dev server verified on `http://localhost:5173` returning HTTP 200 with complete landing HTML
  - Build/ST completion wording in `IMPLEMENTATION_PLAN.md` corrected (allocated effort is not completed effort)
- [x] **Phase 0.5 â€” Configure Vite development proxy** _(rev 7)_
  - `client/vite.config.js` updated: configured proxy forwarding for `/api/*` to `http://localhost:3001`
  - Preserved React plugin, port 5173, and exact `/api` path without stripping/rewriting
  - Started backend (`npm run start`) and client (`npm run dev`) simultaneously
  - Queried `http://localhost:5173/api/health` through Vite dev server: returned HTTP 200 with Express JSON payload
  - Validated response is actual backend JSON, not frontend fallback HTML or proxy error
- [x] **Phase 0.6 â€” Add ESLint + Prettier across workspaces** _(rev 8)_
  - Installed ESLint 9 (`eslint@9.39.5`, `@eslint/js@9.39.5`), `eslint-plugin-react@7.37.5`, `eslint-plugin-react-hooks@7.1.1`, `globals@17.13.0`, `prettier@3.9.10`, `eslint-config-prettier@10.1.8`
  - Created root flat config `eslint.config.mjs` handling Node.js CommonJS backend (`server/`), React 18 ESM frontend (`client/`), and root ESM configs
  - Created `.prettierrc` and `.prettierignore` configured for workspace structure
  - Added workspace-level scripts (`lint`, `lint:fix`, `format:check`, `format`) in root, `client/package.json`, and `server/package.json`
  - Executed `npm run lint` and `npm run format:check` â€” all checks passed cleanly with 0 errors and 0 warnings
- [x] **Phase 0.7 â€” Independent server & client validation** _(rev 9)_
  - Validated Express server starts independently with `npm --prefix server run dev` and serves `GET /api/health` with HTTP 200
  - Validated Vite client starts independently with `npm --prefix client run dev` on port 5173 and serves landing page with HTTP 200
  - Executed `npm run lint` across entire workspace (0 errors, 0 warnings)
  - Executed `npm run format:check` across entire workspace (all files formatted with Prettier)
  - Executed `npm --prefix client run build` producing production assets without error
  - Corrected task sequencing in `IMPLEMENTATION_PLAN.md` for Phases 0.7 and 0.8
- [x] **Phase 0.8 â€” Add `concurrently` dev script** _(rev 10)_
  - Installed `concurrently@10.0.6` as root `devDependency`
  - Added root `dev` script: `concurrently -n "server,client" -c "blue,green" --kill-others "npm run dev --workspace=server" "npm run dev --workspace=client"`
  - Validated `npm run dev` from root: starts both processes with clear prefixes (`[server]`, `[client]`), terminates paired processes cleanly
  - Verified frontend at `http://localhost:5173` (HTTP 200) and proxy at `http://localhost:5173/api/health` (HTTP 200, valid Express health JSON)
  - Verified lint, format, and client build pass cleanly with 0 errors
- [x] **Phase 1.1 â€” Install & integrate ExcelJS** _(rev 11)_
  - Installed `exceljs@4.4.0` in `server/` workspace via npm workspaces
  - Created isolated verification smoke test `server/scripts/verify-exceljs.js`
  - Verified in-memory workbook creation, worksheet addition, buffer serialization, reload into second workbook instance, and data inspection (exit code 0)
  - Confirmed root lint, format check, and client production build pass cleanly with 0 regressions

---

## Pending Tasks (immediate next steps)

> The full to-do list is in `IMPLEMENTATION_PLAN.md`. Items below are the next actionable steps.

- [x] **Phase 1.2** â€” Define workbook schema and confirm the approved ten-sheet inventory: Teams, Releases, Features, User Stories, Dependencies, Scenarios, Scenario Overrides, Scenario Projections, TeamReleaseCapacity, Config; no `WorkbookMeta` sheet added
- [x] **Phase 1.3** â€” Implement `WorkbookService` and typed workbook access layer, including safe replacement, serialized writes, stale-version rejection, validation, and verification script coverage
- [x] **Phase 1.4** â€” Implement CSV import preview + confirm flow with required `workbookVersion` validation, stale-version conflict rejection, explicit `feature.*` vs `story.*` mapping, malformed-row rejection, duplicate-header detection, and verification coverage for valid and invalid rows
- [x] **Phase 1.5** â€” Implement CRUD REST endpoints for Teams, Releases, Features, User Stories, and Dependencies with `expectedVersion` enforcement, stale-version 409 handling, delete guards, and verification coverage for successful creates/updates/deletes, invalid payloads, and orphan protection
- [x] **Phase 1.6** â€” Implement configuration persistence for `GET /api/config` and `PUT /api/config` with required `expectedVersion` handling, stale-version 409 checks, partial-update preservation, metadata protection, and verification coverage for valid/invalid updates and persistence behavior
- [x] **Phase 1.7** â€” Implement Teamâ€“Release capacity API for `GET /api/capacities`, `GET /api/capacities/:teamId/:releaseId`, and `PUT /api/capacities/:teamId/:releaseId` with team/release validation, composite-key uniqueness, required non-negative Build/ST capacity values, expected-version enforcement, stale-version conflict handling, and temporary-workbook verification coverage

---

## Decisions Already Confirmed

See [`docs/DECISIONS.md`](DECISIONS.md) for the full register. Key confirmed items:

| Area               | Decision                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Stack              | React/Vite, Node.js/Express, npm workspaces, ExcelJS                                                     |
| Domain model       | Feature (primary entity) â†’ User Stories; planning at Feature level                                     |
| Feature completion | A feature is complete only when Build **and** ST effort are **actually done** â€” not merely scheduled   |
| Priority           | Ascending numeric; strict (no lower-priority work while higher-priority incomplete); ties by input order |
| ST gating          | ST only consumes completed Build effort                                                                  |
| Hard deps          | Partial block by % on remaining effort; additive; blocked â‰  completed                                  |
| TBC releases       | Arithmetic-mean capacity; two 15-day + one 5-day sprints; Wedâ€“Tue cadence                              |
| Scenarios          | Global % (5â€“50%) + per-feature overrides; definitions/projections persisted; baseline never touched    |
| Data integrity     | Original estimates and actual spent immutable; scenario promotion requires explicit confirmation         |
| Concurrency        | Write queue + proper-lockfile + ETag (HTTP 409 on stale saves)                                           |
| Deployment         | Single Windows PC; LAN browser access; Express serves React static files                                 |
| Workbook location  | Server machine's **local disk** (confirmed)                                                              |

---

## Open Technical Questions & Blockers

| #   | Question                                                                                   | Needed by | Status                                                             |
| --- | ------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------ |
| Q1  | **Gantt library licence**: dhtmlx-gantt GPL vs commercial?                                 | Phase 4   | Resolved for Phase 4.1 spike; production compliance review remains |
| Q3  | **Authentication**: individual logins vs LAN access only?                                  | Phase 7   | â“ Open                                                            |
| Q4  | **TBC auto-replan**: auto-promote when real-release capacity opens, or manual re-run only? | Phase 3/5 | â“ Open                                                            |

**Blockers**: None.

---

## Environment Findings

| Tool            | Version                                       | Notes                                              |
| --------------- | --------------------------------------------- | -------------------------------------------------- |
| Node.js         | v24.14.1                                      | âœ… Available                                      |
| npm             | 11.11.0                                       | âœ… Available â€” package manager for this project |
| npx             | 11.11.0                                       | âœ… Available                                      |
| Python          | 3.14.3                                        | âœ… Available (not used in this project)           |
| Git             | 2.53.0 (windows)                              | âœ… Available                                      |
| pnpm            | â€”                                           | âŒ Not installed â€” npm will be used              |
| Workspace files | `docs/`, `server/`, `client/`, `package.json` | Project setup underway                             |

---

## Milestone Log

| Date       | Milestone                               | Notes                                                                                                                                                    |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-30 | Pre-implementation docs created (rev 1) | Workspace inspection, architecture, initial plan                                                                                                         |
| 2026-10-30 | Documentation alignment (rev 2)         | Reconciled Feature model, priority/ST/dependency/TBC/scenario rules; corrected 8 contradictions                                                          |
| 2026-10-30 | Phase 0.1 complete (rev 3)              | Git init, `.gitignore`, `README.md`; D03.2 confirmed; feature-completion rule clarified                                                                  |
| 2026-10-30 | Phase 0.2 complete (rev 4)              | Root `package.json` created; workspaces `client` + `server`; `"private": true`; JSON validity confirmed                                                  |
| 2026-10-30 | Phase 0.3 complete (rev 5)              | `server/` scaffolded with Express 5.3.0; `GET /api/health` verified with HTTP 200                                                                        |
| 2026-10-30 | Phase 0.4 complete (rev 6)              | `client/` scaffolded with React 18.3.1 + Vite 6.4.5; build and dev server verified; Build/ST completion wording updated                                  |
| 2026-10-30 | Phase 0.5 complete (rev 7)              | `client/vite.config.js` proxy configured for `/api/*` to Express (port 3001); end-to-end `GET http://localhost:5173/api/health` verified with HTTP 200   |
| 2026-10-30 | Phase 0.6 complete (rev 8)              | ESLint 9 & Prettier 3 configured across workspaces; flat config handles CommonJS server + ESM React client; `lint` and `format:check` pass with 0 errors |
| 2026-10-30 | Phase 0.7 complete (rev 9)              | Validated independent server & client startups, endpoints, lint (0 err/warn), format:check (all green), and production build; updated task sequencing    |
| 2026-10-30 | Phase 0.8 complete (rev 10)             | Added `concurrently@10.0.6` and root `dev` script; verified both apps start and run together with proxy; Phase 0 foundation complete                     |
| 2026-10-30 | Phase 1.1 complete (rev 11)             | Installed `exceljs@4.4.0` in `server/`; verified in-memory creation, serialization, deserialization, and data inspection smoke test                      |

## Phase 2.1 Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed
- `node server/scripts/verify-exceljs.js` â€” passed
- Backend/API files were not changed; verification scripts exercised the existing routes.

## Phase 2.2 Verification

- `npm run lint` â€” passed (one initial Node.js out-of-memory crash; rerun passed)
- `npm run format:check` â€” passed (one initial Node.js out-of-memory crash; rerun passed)
- `npm --prefix client run build` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed; expanded to verify the team list response, workbook version, and preservation of omitted fields during partial team updates
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed

The UI uses `GET /api/teams`, `POST /api/teams`, `PUT /api/teams/:id`, `GET /api/releases`, `GET /api/capacities`, and `PUT /api/capacities/:teamId/:releaseId`. Capacity is per configured release because the approved workbook schema uses the team/release composite key; sprint-level capacity records are not part of the current API/schema.

## Phase 2.2 Targeted Concurrency Correction

The Teams page now accepts its teams, releases, and capacity data only when all three API responses report the same non-negative integer `workbookVersion`. Version mismatches trigger up to three complete read attempts. If the versions still differ, the page displays a refresh/retry error, clears the usable version, and blocks team and capacity mutations. The same consistency check runs after successful mutations and HTTP 409 conflicts. Server-side expected-version checks and persistence safeguards remain unchanged.

Focused verification: `node client/scripts/verify-team-snapshot.js` â€” passed. It covers consistent-version readiness, mismatch retry then recovery, bounded retry exhaustion, and blocked mutation readiness.

## Phase 2.3 Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed; expanded to verify the release list response/version, reversed-date rejection, and preservation of schedule fields on a partial update
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed

The Releases page uses one `GET /api/releases` response for both release data and `workbookVersion`, so it does not combine separate response versions. Mutations use `POST /api/releases` and `PUT /api/releases/:id` with the returned `expectedVersion`; HTTP 409 triggers a reload and a review-before-retry message. The UI preserves API list order and uses a free-text status field because the exact release status vocabulary remains unresolved.

## Phase 2.4 Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed; verifies feature listing/version, story list response, optional team unassignment, non-negative effort validation, and preservation of original/actual Build and ST values on partial updates
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed
- `node client/scripts/verify-team-snapshot.js` â€” passed; covers the shared generic endpoint loader used by Features as well as Teams

The Features page requires consistent versions from `/api/features`, `/api/releases`, and `/api/teams` before enabling writes. Story details are read-only; their response version must match the feature snapshot. New features set original Build/ST estimates to the entered current estimates and actual spent to zero. Feature edits omit original and actual fields so existing values remain unchanged. No backend routes or workbook schema were changed.

## Phase 2.5 Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed; exercises feature-scoped story create/list/update API contracts and preservation of immutable effort fields
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed

The User Stories page loads `/api/features` with the selected `/api/features/:id/stories` response and enables writes only when both responses have the same workbook version. It creates stories with `POST /api/features/:id/stories` and edits/reorders with `PUT /api/features/:id/stories/:storyId`, sending `expectedVersion`. Updates omit original estimates and actual spent; new stories initialize original estimates from current estimates and actual spent to zero. A stale-version conflict refreshes the selected feature and requires the user to review before retrying. Status remains a text field because the accepted vocabulary is unresolved. No backend routes or workbook schema were changed.

## Phase 2.6 Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node client/scripts/verify-team-snapshot.js` â€” passed; covers consistent-version loading used by the Dependencies page
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed; includes dependency list and predecessor/dependent direction, self-reference rejection, Normal classification, Hard classification, affected activity, blocking percentage, and notes update checks
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed

The Dependencies page uses `GET /api/dependencies`, `GET /api/features`, and `GET /api/teams`; it accepts a snapshot only when all three workbook versions match. It creates with `POST /api/dependencies` and edits with `PUT /api/dependencies/:id`, sending `expectedVersion`. The supported entity scope is feature-to-feature: `predecessor_feature_id` points to `dependent_feature_id`. The page resolves feature/team names when available and displays unresolved-reference indicators otherwise. No dependency delete control, new endpoint, schema change, or scheduling behavior was added. `WorkbookService` validates the relationship inside the serialized, version-checked mutation. Pair uniqueness applies regardless of dependency type because the schema only declares `dependency_id` as unique and does not permit multiple types for one feature pair. Cycle checking examines reachability from the proposed dependent back to its predecessor, excluding the replaced row on edit; this detects cycles introduced by the change without rejecting unrelated edits solely due to an existing legacy cycle.

## Phase 2.7 Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node client/scripts/verify-team-snapshot.js` â€” passed
- `node server/scripts/verify-csvimport-api.js` â€” passed; verifies multipart preview, preview version and records, explicit confirmation, required mapping errors, malformed rows, add/replace behavior, and HTTP 409 stale-preview rejection using a temporary workbook
- `node server/scripts/verify-csvimport.js` â€” passed; verifies import parsing, validation, persistence, estimate/spent defaults, add/replace behavior, and stale-version safeguards
- `node server/scripts/verify-workbookservice.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed
- `node server/scripts/verify-dependencies.js` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed

The Import page uses `POST /api/import/csv/preview` and `POST /api/import/csv/confirm` as multipart requests. It sends the uploaded `file`, JSON `mapping`, `mode`, explicit `confirmed=true`, and the `workbookVersion` returned by preview. The API route was narrowly corrected to accept the string boolean value produced by multipart form data; before that fix, browser confirmation was always rejected because the route compared the field only to the Boolean `true`. A stale HTTP 409 clears the preview and requires a fresh preview; no write is retried automatically. Preview shows server-prepared feature/story rows and warnings, limited to 50 visible rows per table, while the server handles the full file. Replace mode overwrites only matching imported feature IDs and their stories, and imported story IDs; unrelated workbook records remain. No workbook schema or sheet was changed.

## Phase 2.6 Validation Verification

- `npm run lint` â€” passed
- `npm run format:check` â€” passed
- `npm --prefix client run build` â€” passed
- `node client/scripts/verify-team-snapshot.js` â€” passed
- `node server/scripts/verify-dependencies.js` â€” passed; covers valid Hard/Normal creation, references, self-dependency, pair uniqueness across types, hard-only required fields, percentage bounds, direct and indirect cycles, edits, legacy-cycle tolerance, stale versions, rejection integrity, and workbook reload persistence
- `node server/scripts/verify-crud.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-csvimport.js` â€” passed

## Phase 2.8 Verification

- `npm.cmd run lint` â€” passed
- `npm.cmd run format:check` â€” passed
- `npm.cmd --prefix client run build` â€” passed
- `node client/scripts/verify-team-snapshot.js` â€” passed
- `node client/scripts/verify-form-support.js` â€” passed; covers consistent error formatting for HTTP 400/404/409/5xx and network failures, plus duplicate request lock rejection and release
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed
- `node server/scripts/verify-dependencies.js` â€” passed
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-csvimport-api.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed

Across Teams/capacities, Releases, Features, User Stories, Dependencies, and Import, duplicate submissions are guarded with synchronous request locks and API errors are normalized for validation, missing records, stale workbook versions, server failures, and network failures. Existing schema/domain rules and page-specific 409 refresh/review behavior remain in place; success messages are only shown after API success. CSV mapping, preview, and explicit confirmation behavior is unchanged. No server or workbook schema changes were made.

## Phase 2.9 Verification

- `npm.cmd run lint` â€” passed
- `npm.cmd run format:check` â€” passed
- `npm.cmd --prefix client run build` â€” passed
- `node client/scripts/verify-optimistic-records.js` â€” passed; exercises optimistic list updates, preservation of unrelated and immutable feature fields, authoritative response reconciliation, rollback on a rejected write, and a single mutation submission
- `node client/scripts/verify-team-snapshot.js` â€” passed
- `node server/scripts/verify-workbookservice.js` â€” passed
- `node server/scripts/verify-crud.js` â€” passed
- `node server/scripts/verify-dependencies.js` â€” passed
- `node server/scripts/verify-capacities.js` â€” passed
- `node server/scripts/verify-config.js` â€” passed
- `node server/scripts/verify-csvimport.js` â€” passed
- `node server/scripts/verify-csvimport-api.js` â€” passed

The API does not expose HTTP ETag headers. It returns `workbookVersion` in JSON and accepts `expectedVersion` on writes, so the UI continues using that explicit version contract. Teams, Releases, Features, User Stories, and Dependencies optimistically update only the affected list record, reconcile from the mutation response, and roll back the prior list on failure. HTTP 409 handlers do not retry writes; they reload the latest page snapshot and ask the user to review it. Form entries remain available after failures. Capacity mutations and CSV Import retain pending states because they affect composite or multi-entity data; CSV preview-version and confirmation behavior is unchanged. The focused client script tests shared optimistic state helpers rather than rendering React components; there is no component test harness configured. No backend, persistence, or workbook schema changes were made. At the time of Phase 2.9 verification, Phase 3 had not started.

## Phase 3.1 Verification

- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed
- `node server/scripts/verify-dependency-graph.js` - passed; covers empty and isolated graphs, chains, branches, multiple valid topological orders, direct/indirect/disconnected cycles, missing references, both dependency types, deterministic output, immutable inputs, and a 5,000-node chain and cycle
- `node server/scripts/verify-dependencies.js` - passed
- `node server/scripts/verify-workbookservice.js` - passed

The pure `server/src/planning/dependencyGraph.js` utility emits feature ID nodes, predecessor-to-dependent edges, and a deterministic topological order using `input_order` then feature ID to break ties. Both Hard and Normal edges participate. It throws `DependencyGraphError` with structured codes and feature IDs for cycles and missing references; cycle errors include a cycle path. Existing mutation-time cycle validation remains unchanged. The graph builder is not wired to routes or automatic planning. Phase 3.2 and later remain unstarted.

## Phase 3.2 Verification

- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed; covers no and Normal dependencies, Build/ST/Both activity scope, additive contributions, cap at remaining effort, zero remaining effort, resolved and unresolved status with a fully completed predecessor, plus allocated/scheduled fixture values that do not count as actual spent, missing references, invalid percentages, input immutability, deterministic output, and actual-spent preservation
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-dependencies.js` - passed
- `node server/scripts/verify-workbookservice.js` - passed

`server/src/planning/hardDependencyBlocking.js` computes remaining activity effort as `max(0, estimate_current - actual_spent)`. Each applicable unresolved Hard dependency contributes `remaining_effort * blocking_pct / 100`; contributions are summed and total blocked effort is capped at remaining effort. The returned per-feature Build and ST summaries include remaining, total blocking percentage, uncapped and capped blocked effort, dependency-allocatable effort, and per-dependency contributions. `dependency_status` (`Unresolved` or `Resolved`) is authoritative; the documentation does not specify automatic status changes when predecessor actuals reach estimates, so none are inferred. Normal dependencies do not block. The result does not perform allocation or ST capacity gating, and no endpoint, UI, workbook, or persistence behavior changed. Phase 3.3 and later remain unstarted.

## Phase 3.3 Verification

- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed
- `node server/scripts/verify-workbookservice.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed

`server/src/planning/featureOrdering.js` returns feature IDs in deterministic dependency order and rejects any Hard or Normal dependency whose predecessor priority is equal to or numerically lower than the dependent priority. This implements the Product Owner decision that all predecessors have strictly higher priority than their successors; invalid priorities continue to use the existing `INVALID_PRIORITY` error convention. Dependency edges and cycle/reference validation remain in force, and Normal dependencies only order features.

## Phase 3.4 Verification

- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed
- `node server/scripts/verify-workbookservice.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed

`server/src/planning/featureAllocation.js` is a pure utility accepting `{ features, dependencies, releases, capacities }`. It processes eligible features in ascending priority and `input_order`, while validating dependency ordering constraints first. An incomplete feature blocks all lower-priority features in the same release, including when hard-blocked, unassigned, missing its capacity record, or unable to fit within capacity; another release uses its own independent progression. Build and dependency-adjusted ST forecast effort allocate against their independent capacity pools. Actual-spent values are unchanged and determine delivery completion separately from forecast allocation. Hard dependency blocking and authoritative `dependency_status` behavior remain unchanged; Normal dependencies do not block effort. Output reports incomplete reasons and capacity use. Inputs, original estimates, and actual-spent values are not mutated. No allocation endpoint, UI, persistence, TBC generation, or planning entry point was added. Phase 3.5 remains unstarted.

The Phase 3.4 correction regression cases cover unavailable capacity, unassigned and Hard-blocked higher-priority features, same-release blocking, independent release progress, valid predecessor priority, invalid equal/lower predecessor priority for both dependency types, and clear invalid-priority errors. Verification passed:

- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed
- `node server/scripts/verify-workbookservice.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed

The dependency and WorkbookService verification scripts required execution outside the sandbox because sandboxed Windows temp-file renames returned `EPERM`; both passed when rerun with permission.

## Phase 3.5 Verification

- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed when rerun with permission after sandboxed temporary workbook renames returned `EPERM`
- `node server/scripts/verify-workbookservice.js` - passed when rerun with permission after sandboxed temporary workbook renames returned `EPERM`
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed

`server/src/planning/tbcReleaseGeneration.js` consumes the real releases, per-team capacity records, features/dependencies, and Phase 3.4 allocation result. It computes per-team Build/ST arithmetic mean capacity across the real release set, treating a missing team/release row as zero. It generates ephemeral `TBC 1*`, `TBC 2*`, … schedule records only when work is left after real allocation and each generated sprint makes progress. Sprint lengths repeat 15, 15, and 5 weekdays, each Wednesday through Tuesday, with the first Wednesday after the latest real release end date as the anchor and no holiday adjustments. It preserves dependency priority validation and Hard blocking, uses strict priority for overflow allocation, forecasts ST against its independent capacity pool without an actual-Build prerequisite, and stops cleanly when no progress is possible. The focused script covers exact fit, zero/fractional averages, one and multiple TBC releases, independent Build/ST averages, missing capacity rows, cadence dates, dependency priority, strict blocking, blockers/no progress, deterministic output, and input immutability. No workbook/schema persistence, endpoint, or frontend change was added.

## Phase 3.6 Verification

- `node server/scripts/verify-compute-plan.js` - passed
- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed when rerun with permission after sandboxed temporary workbook rename returned `EPERM`
- `node server/scripts/verify-workbookservice.js` - passed when rerun with permission after sandboxed temporary workbook rename returned `EPERM`
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed

`server/src/planning/computePlan.js` exports `computePlan(state)` and `PlanComputationError`. The required state shape is `{ teams, releases, features, stories, dependencies, capacities, config }`: each collection is an array except `config`, which is the typed config object returned by the existing API. Stories remain separate rows keyed by `feature_id`, matching the workbook schema. Capacities are an explicit required input because the feature allocator requires per-team/per-release Build and ST capacity; no values are fabricated. Current Phase 3.1–3.5 utilities do not consume config keys, so config is validated and accepted as context while TBC cadence continues to follow the fixed approved D07 rules.

The returned plan carries the dependency graph and feature order, hard-blocking detail, real allocation, TBC generated releases and capacities, per-feature schedules across real and TBC releases (including associated story records), unresolved Hard blockers, and no-progress reasons. Existing utilities own graph validation, priority ordering, blocking, allocation, and TBC calculations. The entry point checks team/story references and the allocator result contract, then wraps failures with a stage, code, cause, and entity details. Inputs are not mutated.

## Phase 3.7 Verification

`POST /api/plan/compute` computes from the canonical workbook-backed state using one `WorkbookService` instance and returns `{ ok: true, data: PlanResult, workbookVersion }`. The request body cannot supply alternate planning data. The route checks the workbook signature before loading the state and after computation, returning the established 409 conflict response if the backing file changed. Planning state is read-only: allocations and generated TBC releases are included only in the response.

The API integration verification uses a temporary workbook and the real `computePlan` utility. It checks successful output and version consistency, invalid/incomplete workbook data, invalid dependency priority, cycles, invalid references, malformed requests, safe unexpected-error responses, a concurrent workbook replacement, and unchanged workbook bytes/version with no persisted allocation or TBC release.

- `node server/scripts/verify-plan-api.js` - passed (required permission for atomic temporary-workbook replacement; sandbox returned `EPERM`)
- `node server/scripts/verify-compute-plan.js` - passed
- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed (rerun with permission after sandbox `EPERM`)
- `node server/scripts/verify-capacities.js` - passed (rerun with permission after sandbox `EPERM`)
- `node server/scripts/verify-config.js` - passed (rerun with permission after sandbox `EPERM`)
- `node server/scripts/verify-crud.js` - passed (rerun with permission after sandbox `EPERM`)
- `node server/scripts/verify-workbookservice.js` - passed (rerun with permission after sandbox `EPERM`)
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed after documentation update
- `npm.cmd --prefix client run build` - passed

## Phase 3.8 Verification

The existing focused Node scripts provide the planning-engine verification suite; no Jest dependency or duplicate test harness was introduced. Coverage includes dependency validation and cycles, strict priority and incomplete-feature blocking, independent Build/ST forecast capacity allocation with actual-spent immutability, Hard/Normal dependency semantics, TBC capacity/cadence/determinism/no-progress behavior, `computePlan` validation and immutability, and real workbook-backed API behavior. The API integration checks the single-snapshot version, errors, rejection of caller-supplied state, no persisted plan changes, safe errors, and a workbook replacement during computation.

- `node server/scripts/verify-plan-api.js` - passed
- `node server/scripts/verify-compute-plan.js` - passed
- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed
- `node server/scripts/verify-capacities.js` - passed
- `node server/scripts/verify-config.js` - passed
- `node server/scripts/verify-crud.js` - passed
- `node server/scripts/verify-workbookservice.js` - passed
- `node server/scripts/verify-csvimport.js` - passed
- `node server/scripts/verify-csvimport-api.js` - passed
- `node server/scripts/verify-exceljs.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed

Temporary-workbook scripts were run with permission outside the sandbox because sandbox file replacements can fail with `EPERM`; all listed commands completed successfully. No planning-engine implementation defect or unresolved test limitation was found.

## Phase 4.1 — Gantt Library Integration Spike

The product decision accepts GPL obligations. Evaluated DHTMLX's official current guidance: `dhtmlx-gantt` v10+ is Community edition under MIT, while v9.x and earlier remain GPL v2 but are no longer actively maintained. The spike pins `dhtmlx-gantt` **9.1.4**, verified from npm metadata and the installed package (`license: GPL-2.0`); its package contains the GNU GPL version 2 license text. The upstream feature set supports task bars, date scales, task hierarchy, and links. The spike uses only bars, dates, and parent/child hierarchy; dependency arrows and production planning visualization remain for later phases.

Integration uses the core JavaScript Gantt module directly in a React effect, following DHTMLX's React guidance for the legacy GPL/core package; DHTMLX's first-party React wrapper is offered for Commercial, Enterprise, and Ultimate editions. The spike is lazy-loaded on the existing schedule route, fixed-height and width-responsive, read-only, and backed solely by local mock records. It has no workbook/API connection or saved chart state. The license text ships under `client/public/licenses/`, and the spike displays links to the license and upstream GPL source branch.

**License assumptions and limitations:** Acceptance of GPL does not itself establish compliance for every form of distribution. The current deployment is an internal office-LAN application, but the browser receives the Gantt JavaScript. Before production distribution, the organization must provide recipients the applicable license and corresponding source under GPLv2, assess whether the combined frontend must be distributed under GPL-compatible terms, and obtain legal review of the full distribution model. The backend's relationship to the frontend is not determined here. Version 9.1.4 is an inactive legacy line, so future security/maintenance needs may warrant a different library/version decision. This spike is not a final production-library approval.

Official sources: [DHTMLX installation and legacy license notes](https://docs.dhtmlx.com/gantt/guides/installation/), [migration guide and v9 GPL status](https://docs.dhtmlx.com/gantt/migration/), [React integration options](https://docs.dhtmlx.com/gantt/integrations/react/), and [Community vs PRO feature comparison](https://docs.dhtmlx.com/gantt/guides/editions-comparison/). Package metadata and the shipped license text were also inspected locally.

- `node client/scripts/verify-gantt-spike.mjs` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite reports the lazy-loaded Gantt vendor chunk is 611.16 kB minified (167.24 kB gzip), above its 500 kB advisory threshold

## Phase 4.2 — Production Release and Feature Gantt Visualization

`POST /api/plan/compute` remains unchanged and returns its existing `{ ok, data: PlanResult, workbookVersion }` contract. The schedule page first requests that plan, then posts `{ plan, expectedVersion }` to read-only `POST /api/plan/schedule`. The server loads one canonical WorkbookService snapshot, checks the expected workbook version, recomputes and compares the submitted plan with the canonical PlanResult, derives the schedule, and checks the workbook again before responding. A stale version returns 409; altered/mismatched plan content is rejected. Neither route persists plan, allocations, generated TBC releases, or schedule output.

The pure `scheduleFeatureStages(plan, { releases, capacities })` utility returns release groups with feature records and separate Build/ST stage data. Each stage reports allocated SP, effort-derived duration, visual duration, dates, scheduled/partial/unscheduled state, and reasons. Real date windows come from the WorkbookService snapshot; TBC windows come from PlanResult generation. It validates allocated effort against real workbook capacities and generated TBC capacities.

Scheduling follows the corrected policy: 1 SP per working day, Monday–Friday, no holiday adjustments, strict priority then `input_order`, and parallel feature bars within a release. Build and ST bars overlap within each feature. For ST at or below Build effort, its visual span extends from the same start through Build's finish while retaining true ST allocated SP and effort duration. ST greater than Build determines feature finish. Missing/invalid release start dates receive explicit reasons and no fabricated bar dates. Incomplete or blocked features are never labeled complete.

The UI uses existing dhtmlxGantt 9.1.4, remains read-only, identifies TBC groups, presents loading/empty/API-error/retry states and partial/unscheduled reasons, and retains the GPL/source notice and production compliance caveat. The former `GanttSpike.jsx` was replaced by `GanttSchedulePage.jsx`; mock-only timeline data is no longer used by the schedule route. It does not implement Phase 4.3 dependency arrows or later Phase 4 features.

The Phase 4.1 root workspace lock and installation housekeeping remains in effect: `package-lock.json` is the root authoritative lock, the nested client lock is absent, and README instructions use root-level `npm ci`/`npm run dev`.

- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node server/scripts/verify-plan-api.js` - passed (run with permission outside sandbox due temporary-workbook `EPERM`)
- `node server/scripts/verify-compute-plan.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-capacities.js` - passed (run with permission outside sandbox due temporary-workbook `EPERM`)
- `node server/scripts/verify-dependencies.js` - passed (run with permission outside sandbox due temporary-workbook `EPERM`)
- `node server/scripts/verify-workbookservice.js` - passed (run with permission outside sandbox due temporary-workbook `EPERM`)
- `node client/scripts/verify-gantt-view.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed after documentation update
- `npm.cmd --prefix client run build` - passed; Gantt chunk remains above Vite's advisory 500 kB minified threshold

### Phase 4.2 Gantt Lifecycle Correction

Confirmed that the installed `dhtmlx-gantt` 9.1.4 GPL package exports only its shared singleton and does not expose the disposable multi-instance factory available in PRO editions. DHTMLX documents that destroying the legacy GPL singleton makes it unavailable until reload. The chart now reuses that singleton across React Strict Mode effect replay and route remounts: initialization is separated from task updates, data is cleared on cleanup and before each parse, and `destructor()` is never called. Read-only settings, working-day configuration, exclusive end-date conversion, and the GPL/source notice remain unchanged.

A Gantt-specific React error boundary now contains rendering failures inside the main content area and provides a retry control, leaving navigation and other routes outside the boundary. The lifecycle verification exercises two setup/cleanup cycles, confirms stale data is cleared and fresh data is loaded, checks the installed singleton API, and verifies the route boundary is present. The actual browser route/re-navigation check could not be performed because desktop browser access is disabled; the sandbox-hosted dev server also refused the approved local HTTP probe. The Phase 4.3 step remains unstarted.

- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `node client/scripts/verify-gantt-view.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite emitted its existing advisory for the Gantt chunk exceeding 500 kB minified
- Browser navigation/re-mount verification - not run; local browser use is disabled in the desktop environment

### Phase 4.2 Date-Boundary Correction

Verified against the installed `dhtmlx-gantt` 9.1.4 runtime with Monday–Friday work time enabled: a duration of one from Monday has a Gantt `end_date` boundary on Tuesday; a one-workday task starting Friday has an exclusive boundary on Monday; and a 14-workday task starting Monday has an exclusive boundary on Friday. Gantt task `end_date` is therefore the first instant/date boundary after the occupied working interval, while the scheduling utility returns the last occupied date inclusively.

`addGanttExclusiveEndDates(tasks, gantt)` now materializes the Gantt end boundary using the installed library's `calculateEndDate(start_date, duration)` for release, feature summary, Build, and ST tasks. Each task retains `intended_end_date` from the scheduler for traceability; stage visual duration remains independent of allocated SP and effort duration. The focused verification parses these tasks through the installed Gantt runtime and checks its calculated duration and preceding occupied workday against each intended scheduler finish, including 1-day, 14 SP Build/7 SP ST, longer ST, release end, Friday/weekend, partial and zero-stage cases. This is a Node library-level check; no browser visual test was available/run.

- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node client/scripts/verify-gantt-view.js` - passed against installed dhtmlxGantt 9.1.4 date calculations
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Gantt chunk remains above Vite's advisory 500 kB minified threshold

### Phase 4.2 Unscheduled Gantt Bar Correction

The Gantt builder previously omitted feature rows when neither Build nor ST had valid scheduled dates. It now retains each feature under an included real or TBC release. If valid scheduled stage bars exist, the feature summary is dated from those bars only. Otherwise, it is passed to dhtmlxGantt with its supported `unscheduled: true` task property and without `start_date`, `end_date`, or `duration`. In the installed 9.1.4 API, `show_unscheduled: true` (the default) displays this as an empty grid row; setting it to false would allow it to appear in the timeline. A Gantt status column labels rows Scheduled, Partial, or Unscheduled. The runtime may internally assign dates to unscheduled tasks, as documented by DHTMLX, but the supported unscheduled mode keeps them from rendering as timeline bars.

Feature summaries now derive their start and finish from valid scheduled stage tasks only. Partial summaries are labeled and use a distinct dashed style. Stage bars retain the planner's per-release allocated SP and visual duration independently. Release bars continue using only their configured valid window and working-day duration, so child allocations cannot expand them. The planning and allocation services, API contracts, persistence, and approved scheduling rules are unchanged.

The focused Gantt verification covers unscheduled real and TBC feature rows, absence of input dates/durations and stage bars for unscheduled work, partial Build and ST, invalid/missing/zero-effort dates, summary derivation, release boundaries, TBC allocated effort, unique deterministic IDs, the 14 SP Build/7 SP ST overlap, status-list reasons, and lifecycle remount behavior. Browser automation is unavailable in this environment, so manual visual verification with the current workbook remains required before Phase 4.2 can be closed.

- `node client/scripts/verify-gantt-view.js` - passed
- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node server/scripts/verify-plan-api.js` - passed after rerunning outside the sandbox due temporary-workbook rename `EPERM`
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite emitted its advisory that the lazy Gantt chunk exceeds 500 kB minified

### Phase 4.2 Weekly Timeline and Partial Allocation Improvements

Changed the read-only timeline to a Monday-start weekly scale with explicit week-of labels and retained the month overview and horizontal scrolling. Release bars use a compact 4 px style while retaining their configured release windows. The Gantt rows remain grouped by real and generated TBC releases, ordered by priority and input order.

The schedule response includes, per feature and release, required, allocated, scheduled, and remaining Build/ST effort. Team capacity is aggregate across resources and is independent of calendar length. Feature bars use effort-based durations and may extend beyond the release row's configured end; features allocated to the same release share its start and can run in parallel. No workbook or persistence behavior changed.

Verification covers weekly scale labels, thin release styling, per-release percentages across real/TBC releases, partial in-window effort, and existing lifecycle/date-boundary cases. Browser access is unavailable in this environment, so visual confirmation against the current workbook remains outstanding and Phase 4.2 stays open.

- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node client/scripts/verify-gantt-view.js` - passed
- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `node server/scripts/verify-plan-api.js` - passed after rerunning outside the sandbox; sandbox temporary-workbook rename returned `EPERM`
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite reported the existing Gantt chunk size advisory above 500 kB minified
- Browser visual check against the current workbook - not run; local browser access is disabled in the desktop environment

### Phase 4.2 Gantt Visual Refinement

Weekly headers now read `Week 1`, `Week 2`, etc. Numbering follows Monday-start calendar weeks and assigns a week crossing into a month to that month's first intersecting week; the month scale above continues to identify the month and year. The Gantt's minimum timeline column width is 80px, with 2px horizontal padding applied only to weekly timeline cells. This changes only scale labels and cell styling, not task dates.

Feature allocations render as one feature-level bar per release allocation. Each bar contains only Build and ST allocated effort against total required effort. Real and TBC allocations remain separate rows. Fully unscheduled features retain an undated grid row without a bar; partial features keep their valid scheduled span and reasons in the existing work list. Overall allocation status remains separate from per-row Timeline status. Timeline progress accumulates Build and ST independently in planning release order: a row is `Partial` until both requirements are cumulatively covered, then `Complete`; the overall allocation column continues to show the all-release result. This does not indicate actual delivery or dependency resolution. Thin release bars and existing date-boundary conversions remain intact.

Focused tests passed for month/year week transitions, cumulative allocation status by release, independent Build/ST coverage, per-release bar values, parallel same-release scheduling, uncapped effort-based bars, unscheduled rows without fabricated dates, release dates, 14 SP Build/7 SP ST finish alignment, absence of separate stage rows, and repeat mounting without duplicate tasks. Browser visual verification against the supplied workbook remains outstanding, so Phase 4.2 remains open.

The stage scheduler projects every allocated SP without clipping to the release end date. Tests confirm a 4 SP allocation remains scheduled for four effort-based working days even when the configured release row is only three working days long; multiple same-release features share the release start. Aggregate Build/ST capacity remains independent of release dates.

- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node client/scripts/verify-gantt-view.js` - passed
- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite reported the existing Gantt chunk size advisory above 500 kB minified
- Browser visual check against the supplied workbook - not run; local browser access is disabled in the desktop environment

### Phase 4.2 Team-Aware Gantt Rows and Zero-Allocation Filtering

The planning result now carries each feature's name and assigned team name/ID alongside its existing ID, ordering, release, story, and allocation data. The stage projection retains those identity fields. In the Gantt grid the row label shows the feature and team; the bar uses a separate text template containing only Build/ST allocation against overall requirements. Tooltips include feature/team identity, effort values, overall allocation status, and cumulative Timeline status.

The feature-stage projection omits release rows whose Build/ST contributions are both zero and which have no remaining effort or explicit Hard dependency blocker. Remaining effort and blocked rows stay visible and continue to feed the existing warning summary. Real allocation and TBC capacity remain keyed per team; verification confirms no cross-team fallback and that TBC averages and allocations stay team-specific. No allocator or workbook schema changes were needed.

The current workbook was inspected read-only at version 11. Feature 2 (IA) receives 20 Build/15 ST in Release 1 and its zero-allocation TBC placeholder is omitted. Feature 1 (GLUE) receives 40 Build/30 ST in Release 1 and 20 Build/10 ST in TBC 1*. The projected rows retain the correct team names and cumulative statuses. Browser visual verification remains outstanding; Phase 4.2 remains open.

- `node server/scripts/verify-compute-plan.js` - passed
- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-plan-api.js` - passed after running outside the sandbox
- `node client/scripts/verify-gantt-view.js` - passed
- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite reported the existing Gantt chunk size advisory above 500 kB minified
- Browser visual verification against Workbook version 11 - not run

### Phase 4.2 Final Gantt Allocation and Bar Correction

Feature bars now use one consistent solid light-blue fill with white text; the partial-state dashed outline was removed. Allocation state is shown separately from timeline state. The Gantt exposes `Fully Allocated`, `Partially Allocated`, or `Unallocated` as the overall feature status across its real and TBC release rows, while each row's bar text reports that release's Build/ST contribution against the overall required effort. An undated feature can therefore remain Fully Allocated while its Timeline status is Unscheduled.

The read-only scheduling response now carries each feature's overall required Build/ST effort from the authoritative real allocation's `requested_remaining_effort`, alongside the existing per-release allocation values. Allocation status aggregates release contributions against that required amount; it does not use date spans or visual scheduled-SP calculations. The Gantt no longer presents derived scheduled SP as an allocation fact. The header explains that allocations use team capacity and timeline spans do not limit allocated SP.

Code review confirmed that `featureAllocation.js` allocates against independent Build/ST team capacity pools and does not cap effort by release working days. Separate regression cases allocate 60 Build SP and 40 ST SP against two-working-day releases when those capacities are available. The timeline now also displays those allocated efforts without release-end clipping. Workbook data and persistence were not changed.

Verification covers the 60/40 requirement split with 40/30 and 20/10 contributions across two releases, Fully Allocated overall status, independent Build/ST completion, zero effort, missing dates, unallocated work, capacity beyond release days, bar styling, release hierarchy, weekly labels, date boundaries, and lifecycle remounts. Phase 4.2 remains open pending visual validation against the supplied workbook; browser access was unavailable.

- `node client/scripts/verify-gantt-view.js` - passed
- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node server/scripts/verify-plan-api.js` - passed after rerunning outside the sandbox; its temporary-workbook rename failed with `EPERM` inside the sandbox
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed; Vite reported the existing Gantt chunk size advisory above 500 kB minified
- Browser visual verification against Workbook version 7 - not run; local browser access is disabled in the desktop environment

### Phase 4.2 Consolidated Gantt Review and ST Allocation Investigation

The Gantt now formats each combined feature bar using only `Build: allocated/required SP | ST: allocated/required SP`, including explicit zero allocations and no feature name or ID. The full label, overall allocation status, and timeline status are available in the task tooltip. Grid columns have minimum widths with elastic sizing and horizontal scrolling, and the schedule route uses 10px left/right outer padding. Feature bars use a solid light-blue fill, white text, and no dotted/dashed outline; focus-visible tasks receive a solid color change. The bottom warning summary uses the aggregate cross-release allocation totals.

The live Workbook version 7 was inspected read-only through WorkbookService and `computePlan`. FEATURE1 requires 60 Build SP and 40 ST SP; the current planning result allocates Release 1 Build 40/ST 30 and TBC 1* Build 20/ST 10. Overall it is Fully Allocated with zero remaining allocation for both activity types. This confirmed the ST zero was caused by the former actual-Build gating in both real-release allocation and TBC overflow, rather than by a field-mapping defect. Following the requested forecast-policy change, ST now allocates from dependency-adjusted ST effort and the independent ST capacity pool even when Build actual spent is 0. Hard dependency blocks remain authoritative, actual-spent fields remain unchanged, and full forecast allocation does not indicate actual delivery or dependency resolution. The workbook was not modified.

Verification passed for feature allocation, TBC generation, `computePlan`, dependency ordering/graph/blocking, dependency and capacity APIs, plan API, WorkbookService, feature-stage scheduling, Gantt view/lifecycle, lint, format check, and production build. Workbook-writing integration scripts were rerun outside the sandbox after Windows denied their temporary-file atomic renames inside it. Browser visual verification remains outstanding, and Phase 4.2 remains open. The production build continues to show Vite's existing large Gantt chunk advisory.

- `node client/scripts/verify-gantt-view.js` - passed
- `node client/scripts/verify-gantt-lifecycle.js` - passed
- `node server/scripts/verify-feature-allocation.js` - passed
- `node server/scripts/verify-tbc-release-generation.js` - passed
- `node server/scripts/verify-compute-plan.js` - passed
- `node server/scripts/verify-feature-stage-scheduling.js` - passed
- `node server/scripts/verify-feature-ordering.js` - passed
- `node server/scripts/verify-dependency-graph.js` - passed
- `node server/scripts/verify-hard-dependency-blocking.js` - passed
- `node server/scripts/verify-dependencies.js` - passed after rerun outside the sandbox
- `node server/scripts/verify-capacities.js` - passed after rerun outside the sandbox
- `node server/scripts/verify-plan-api.js` - passed after rerun outside the sandbox
- `node server/scripts/verify-workbookservice.js` - passed after rerun outside the sandbox
- `npm.cmd run lint` - passed
- `npm.cmd run format:check` - passed
- `npm.cmd --prefix client run build` - passed with the existing chunk-size advisory
- Browser verification - not run; browser automation was unavailable

### Phase 4.2 Aggregate Capacity and Parallel Release Scheduling Correction

Allocation uses the configured per-team, per-release Build and ST capacity pools only. Calendar length does not cap real-release or TBC allocation. Strict team priority remains in allocation order; after higher-priority work receives its allocation for a release, lower-priority work can use remaining capacity. For timeline projection, every feature allocated to the same release starts at that release's first working day, so features may run in parallel. Build/ST durations remain effort-based, with the established feature-level overlap behavior. Feature bars may extend beyond the release end date; the release row still shows its configured dates.

The Gantt allocation column is cumulative through each release row. The Release 2 regression confirms that, after a higher-priority GLUE feature receives 30 Build / 10 ST SP, Sample receives the remaining 8 Build / 3 ST SP from 40 / 30 SP capacity. Sample is Unallocated in Release 1 and Fully allocated in Release 2; it starts with other Release 2 work, and no TBC release is generated when real-release capacity covers the work. The workbook and persistence behavior were not changed. Phase 4.2 remains open pending visual confirmation in the desktop browser.

Verification passed:

- `node server/scripts/verify-feature-allocation.js`
- `node server/scripts/verify-tbc-release-generation.js`
- `node server/scripts/verify-compute-plan.js`
- `node server/scripts/verify-feature-stage-scheduling.js`
- `node server/scripts/verify-feature-ordering.js`
- `node server/scripts/verify-dependency-graph.js`
- `node server/scripts/verify-hard-dependency-blocking.js`
- `node server/scripts/verify-plan-api.js` (outside the sandbox for local server access)
- `node server/scripts/verify-capacities.js`
- `node server/scripts/verify-config.js`
- `node server/scripts/verify-crud.js`
- `node server/scripts/verify-dependencies.js`
- `node server/scripts/verify-csvimport.js`
- `node server/scripts/verify-csvimport-api.js`
- `node server/scripts/verify-workbookservice.js`
- `node client/scripts/verify-gantt-view.js`
- `node client/scripts/verify-gantt-lifecycle.js`
- `npm.cmd run lint`
- `npm.cmd run format:check`
- `npm.cmd --prefix client run build` (passed; Vite emitted the existing advisory that the Gantt chunk exceeds 500 kB minified)
