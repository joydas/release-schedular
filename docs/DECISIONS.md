# Release Scheduler — Confirmed Decisions

> This file records requirements and architectural decisions that have been explicitly confirmed.
> Future implementation steps **must not contradict** entries marked **Confirmed** without an explicit change request from the user.
>
> Last updated: 2026-11-02 (rev 6 — D05 team-scoped priority and cross-team dependency ordering clarified)

---

## How to Use This File

- **Confirmed** = locked in; do not revisit unless the user explicitly requests a change.
- **Assumed** = reasonable default applied; will be finalised when the relevant phase is reached.
- **Open** = not yet decided; tracked in `PROGRESS.md` as open questions.

---

## D01 — Technology Stack

| ID    | Decision                                                                                                                                                                                                                         | Status                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| D01.1 | Frontend: **React** with **Vite** as bundler                                                                                                                                                                                     | Confirmed                              |
| D01.2 | Backend: **Node.js** with **Express** framework                                                                                                                                                                                  | Confirmed                              |
| D01.3 | Package manager: **npm** (npm workspaces for monorepo)                                                                                                                                                                           | Confirmed — pnpm not on host           |
| D01.4 | Excel I/O library: **ExcelJS** (pure Node, no COM dependency)                                                                                                                                                                    | Confirmed                              |
| D01.5 | State management: **Zustand** (lightweight, no boilerplate)                                                                                                                                                                      | Assumed — revisit at Phase 2 if needed |
| D01.6 | Phase 4.1 Gantt spike: legacy `dhtmlx-gantt` v9.1.4 under GPL-2.0, with the GPL license text and upstream source notice included; the GPL compliance assumptions and inactive maintenance status are documented in `PROGRESS.md` | Confirmed for Phase 4.1 spike only     |

---

## D02 — Deployment

| ID    | Decision                                                                                         | Status                        |
| ----- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| D02.1 | Single designated Windows PC hosts both the server and serves the built React app                | Confirmed                     |
| D02.2 | Program managers access the application via browser over the **office LAN**                      | Confirmed                     |
| D02.3 | No cloud deployment; no containerisation required                                                | Confirmed                     |
| D02.4 | Express serves the compiled React `dist/` as static files in production (no separate web server) | Confirmed                     |
| D02.5 | Windows Service or Task Scheduler for auto-start                                                 | Assumed — finalise at Phase 7 |

---

## D03 — Persistence

| ID    | Decision                                                                                                                                                     | Status    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| D03.1 | Primary data store: a **single shared `.xlsx` workbook** managed by the Node.js service                                                                      | Confirmed |
| D03.2 | Workbook file location: **server machine's local disk**                                                                                                      | Confirmed |
| D03.3 | **CSV import** is a one-time initial load; all subsequent data changes go through the app UI and are saved to the workbook                                   | Confirmed |
| D03.4 | The server holds the workbook **in memory** as the canonical state; disk writes occur on every confirmed mutation                                            | Confirmed |
| D03.5 | Concurrent writes are serialised via an **async write queue + advisory file lock** (`proper-lockfile`)                                                       | Confirmed |
| D03.6 | A **version/ETag counter** prevents stale overwrites; saves with a stale ETag are rejected with HTTP 409                                                     | Confirmed |
| D03.7 | Workbook sheets: **Teams, Releases, Features, User Stories, Dependencies, Scenarios, Scenario Overrides, Scenario Projections, TeamReleaseCapacity, Config** | Confirmed |

---

## D04 — Domain Model

| ID    | Decision                                                                                                                                                                                                            | Status    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D04.1 | **Feature** is the primary planning entity; each feature belongs to one release                                                                                                                                     | Confirmed |
| D04.2 | **User Stories** belong to a Feature; planning allocation is computed at the Feature level                                                                                                                          | Confirmed |
| D04.3 | A feature is complete only when **both** its Build effort and its ST effort are **actually done** (work executed, not merely scheduled). Effort allocated or scheduled against a feature does not make it complete. | Confirmed |
| D04.4 | Features carry: `name`, `priority` (numeric), `input_order`, `team`, separate Build and ST effort fields, `status`                                                                                                  | Confirmed |
| D04.5 | Effort fields per activity (Build / ST): `estimate`, `original_estimate` (immutable), `actual_spent` (immutable)                                                                                                    | Confirmed |

---

## D05 — Planning Engine Rules

| ID    | Decision                                                                                                                                                                                                 | Status    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D05.1 | Features are allocated in **ascending numeric priority across their assigned team's workload** (1 = highest priority), carried through releases in release order                                         | Confirmed |
| D05.2 | Within a team, priority ties are broken by **input order**, preserved from data entry                                                                                                                    | Confirmed |
| D05.3 | Allocation is **strict across all releases for a team**: no lower-priority feature starts while higher-priority work for that team remains incomplete                                                    | Confirmed |
| D05.4 | ST capacity may only be consumed by **Build work already completed and available for testing**; unfinished Build is never ST-ready                                                                       | Confirmed |
| D05.5 | **Multi-team planning**: multiple teams with independent Build/ST capacities                                                                                                                             | Confirmed |
| D05.6 | **Multi-release planning**: the planner assigns features to releases in ascending `priority_order`; unfinished work carries forward before lower-priority team work starts                               | Confirmed |
| D05.7 | Dependency edges always enforce predecessor-before-dependent ordering. Priority comparison is required only when both features have the same non-empty `team_id`; cross-team priorities are independent. | Confirmed |
| D05.8 | Feature `release_id` is optional legacy workbook data and does not determine placement; the planner predicts release assignments from release order, team capacity, priority, and dependencies.          | Confirmed |

---

## D06 — Dependency Rules

| ID    | Decision                                                                                                                                              | Status    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D06.1 | Two dependency types: **hard** (partially blocks effort) and **normal** (ordering preference only, does not block)                                    | Confirmed |
| D06.2 | A hard dependency specifies: predecessor feature, **affected activity** (Build \| ST \| Both), and a **blocking percentage** entered by the user      | Confirmed |
| D06.3 | While a hard dependency is unresolved, `blocked_effort = remaining_effort × blocking_pct` for the affected activity; that portion cannot be scheduled | Confirmed |
| D06.4 | **Blocked effort is not completed effort** — it is simply withheld from scheduling until the dependency resolves                                      | Confirmed |
| D06.5 | Multiple hard dependencies on the same feature are **additive**; users enter percentages already accounting for any overlap                           | Confirmed |
| D06.6 | Hard dependencies never make any effort "completed"; they only delay the affected remaining effort                                                    | Confirmed |

---

## D07 — TBC Release Generation

| ID    | Decision                                                                                                                                | Status    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D07.1 | When all real-release capacity is exhausted, generate **TBC 1\*, TBC 2\*, …** as needed                                                 | Confirmed |
| D07.2 | TBC capacity = **arithmetic mean** of Build (and ST) capacity across all configured real releases                                       | Confirmed |
| D07.3 | TBC release cadence: **two 15-working-day sprints** + **one 5-working-day mini sprint**; each sprint runs **Wednesday through Tuesday** | Confirmed |
| D07.4 | No holiday-calendar adjustment is applied to TBC releases                                                                               | Confirmed |
| D07.5 | Whether TBC releases auto-replan when real-release capacity opens is unresolved                                                         | Open (Q4) |

---

## D08 — Scenario Engine Rules

| ID    | Decision                                                                                                                               | Status    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D08.1 | A scenario is a **named overlay** of effort adjustments on top of the baseline plan                                                    | Confirmed |
| D08.2 | Global input: a **single percentage increase between 5% and 50%** applied to all features by default                                   | Confirmed |
| D08.3 | Per-feature **overrides** replace the global percentage for that feature; one percentage applies to both Build and ST for that feature | Confirmed |
| D08.4 | Scenario **definitions, overrides, and saved projections** are **persisted** in the workbook (their own sheets)                        | Confirmed |
| D08.5 | Scenario **calculations** run against baseline + overlay; they do **not** modify any baseline data                                     | Confirmed |
| D08.6 | **Original estimates** are set at creation/import and are **never overwritten** by scenario runs or re-planning                        | Confirmed |
| D08.7 | **Actual spent effort** is never modified by scenario runs                                                                             | Confirmed |
| D08.8 | "Promote scenario" is the **only** path to applying scenario overrides to baseline data; requires explicit user confirmation           | Confirmed |

---

## D09 — Authentication & Access Control

| ID    | Decision                                                    | Status    |
| ----- | ----------------------------------------------------------- | --------- |
| D09.1 | Authentication model: individual logins vs LAN-level access | Open (Q3) |

---

## D10 — Workbook Schema Review

| ID    | Decision                                                                                                                                                                                       | Status      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| D10.1 | Story-level dependency scope remains open: the existing requirements confirm feature-level dependency semantics, but story-level references are supported in the schema for review only        | Open        |
| D10.2 | Exact status vocabulary for `Releases`, `Features`, and `UserStories` should be confirmed by product owners before UI validation becomes strict                                                | Open        |
| D10.3 | Baseline planning output snapshots are not added as a dedicated workbook sheet in Phase 1.2; they remain a later design item if audit/history is needed                                        | Recommended |
| D10.4 | Approved amendment to D03.7: `TeamReleaseCapacity` is now the required tenth workbook sheet. `WorkbookMeta` remains explicitly out of scope and minimal workbook metadata remains in `Config`. | Confirmed   |

---

## Change Log

| Date       | Changed By               | Change                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-30 | Initial setup            | All entries created from initial requirements brief                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-30 | Rev 2                    | Added D04 (domain model: Feature/Story), rewrote D05 (strict priority, ST gating), added D06 (dependency partial-block semantics), added D07 (TBC cadence), rewrote D08 (scenario: global %, persistence confirmed); removed old D04.3/D04.4/D04.8 which conflicted with confirmed rules; removed sprint-definition open question (now confirmed in D07.3); corrected D03.7 sheet list |
| 2026-10-30 | Rev 3                    | D03.2 workbook location changed from Assumed to Confirmed (server local disk); D04.3 feature-completion rule reworded to distinguish allocated/scheduled effort from actually-done effort; Q2 removed from open questions                                                                                                                                                              |
| 2026-10-31 | Phase 1.2 review         | Added schema review questions for story dependency scope, status vocabularies, and baseline snapshot persistence; kept all unresolved items explicitly open and outside confirmed business rules                                                                                                                                                                                       |
| 2026-10-31 | D03.7 amendment approval | Approved the minimal amendment to D03.7: `TeamReleaseCapacity` added as the required tenth sheet; other nine sheets remain unchanged; `WorkbookMeta` remains explicitly not added; minimal metadata continues to live in `Config` only                                                                                                                                                 |
| 2026-11-02 | D05.7 product correction | Priorities are scoped to each assigned team; strict blocking applies within team/release pools; cross-team dependency edges still enforce predecessor ordering without comparing priorities                                                                                                                                                                                            |
