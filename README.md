# Release Scheduler

Release Scheduler is a local planning workspace for organizing teams, release windows, feature estimates, dependencies, and delivery capacity. It computes a capacity-aware plan and presents the projection in an interactive Gantt view. The Excel workbook is the application's current persistence layer.

## Features

- Manage teams, releases, features, user stories, and team/release Build and ST capacity.
- Define feature dependencies, including Hard dependencies that block work and Normal dependencies that influence ordering.
- Import feature and user story data from CSV with preview, field mapping, and downloadable templates.
- Compute feature ordering and Build/ST allocations against release capacity, including partial work and generated TBC releases.
- View projected release and feature schedules, dependencies, and allocation status in dhtmlxGantt.
- Explore temporary What-If estimation increases globally or per feature while retaining the baseline plan.

## Technology

- React and Vite for the frontend
- Node.js and Express for the API
- ExcelJS for workbook-backed data
- dhtmlxGantt for the schedule view

## Prerequisites

- Node.js **20 or later**
- npm **10 or later**

## Install and run

From a fresh clone, install dependencies at the repository root:

```sh
npm install
```

The server uses `WORKBOOK_PATH` when set. Otherwise, it uses `server/data/release-scheduler.xlsx`. If the selected workbook does not exist, the application initializes a blank workbook using its current schema. Start the application once to initialize it, then populate it in the app or import CSV data. See [Workbook schema](docs/WORKBOOK_SCHEMA.md) for the sheet inventory and fields.

Start the frontend and backend together from the repository root:

```sh
npm run dev
```

The application is available at:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:3001](http://localhost:3001)
- Health check: [http://localhost:3001/api/health](http://localhost:3001/api/health)

To select a workbook at another path, set `WORKBOOK_PATH` in the environment before starting the server. For example, in PowerShell:

```powershell
$env:WORKBOOK_PATH = "C:\data\release-scheduler.xlsx"
npm run dev
```

The root development command starts the API and frontend together, so the configured path is inherited by the server process.

## Workbook

Workbook sheets hold teams, releases, features, user stories, dependencies, scenarios and related records, team/release capacities, and configuration. The schema and relationships are documented in [docs/WORKBOOK_SCHEMA.md](docs/WORKBOOK_SCHEMA.md). The application creates a blank workbook with the sheet headers when the configured file is missing.

The workbook is the current persistence layer. Back up real data before making changes, and do not commit private or production workbook data. Workbook files under `server/data` are excluded from version control by the existing ignore rules.

## Scripts and verification

Available root scripts:

| Command                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Start frontend and backend together           |
| `npm run lint`         | Run ESLint from the repository root           |
| `npm run lint:fix`     | Apply ESLint fixes                            |
| `npm run format:check` | Check formatting with Prettier                |
| `npm run format`       | Format files with Prettier                    |
| `npm test`             | Placeholder; no root test suite is configured |

Client scripts (run with `npm run <script> --workspace=client`):

| Script    | Purpose                               |
| --------- | ------------------------------------- |
| `dev`     | Start Vite                            |
| `build`   | Create the production frontend bundle |
| `preview` | Preview the built frontend            |
| `lint`    | Lint client files                     |

Server scripts (run with `npm run <script> --workspace=server`):

| Script  | Purpose                            |
| ------- | ---------------------------------- |
| `dev`   | Start the API with Node watch mode |
| `start` | Start the API                      |
| `lint`  | Lint server files                  |

The repository's verification checks are standalone scripts rather than package scripts. Run them from the repository root with Node; for example:

```sh
node client/scripts/verify-gantt-view.js
node client/scripts/verify-gantt-lifecycle.js
node client/scripts/verify-csv-templates.mjs
node server/scripts/verify-plan-api.js
node server/scripts/verify-compute-plan.js
node server/scripts/verify-feature-allocation.js
node server/scripts/verify-hard-dependency-blocking.js
node server/scripts/verify-tbc-release-generation.js
```

Other focused checks are available in `client/scripts/` and `server/scripts/`, including checks for workbook behavior, capacity, dependencies, ordering, CSV import, and configuration.

## License notice

The schedule view uses dhtmlxGantt 9.1.4 under GPL-2.0. Retain the applicable license notice and review the package's licensing requirements before distributing the application.

## Development status

Release Scheduler is under active validation with real-world data. Review planning outputs against operational needs before relying on them for delivery commitments.
