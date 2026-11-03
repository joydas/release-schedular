# Release Scheduler Workbook Schema

> Status: Phase 1.2 complete
> Scope: Workbook design aligned to the approved ten-sheet inventory in D03.7; minimal metadata stays in `Config`; no `WorkbookMeta` worksheet is added

## 1. Approved workbook inventory

The approved workbook inventory is:

- Teams
- Releases
- Features
- User Stories
- Dependencies
- Scenarios
- Scenario Overrides
- Scenario Projections
- TeamReleaseCapacity
- Config

This is the governing workbook inventory for Phase 1.2 and Phase 1.3. Minimal metadata stays in `Config` as key/value entries; `WorkbookMeta` remains explicitly out of scope.

---

## 2. Required design assessment

### 2.1 Capacity representation in the approved workbook

Team/release capacity is a true relationship record, not a simple team attribute. It is inherently many-to-one in both directions:

- one team can have multiple release capacities
- one release can have multiple team capacities
- each team/release pair has independent Build and ST capacity

Because of that, capacity must be modeled as a dedicated relationship table rather than as a single row on `Teams` or a flattened JSON blob in `Releases`.

The approved solution is a dedicated `TeamReleaseCapacity` sheet with a unique team/release pair and separate Build/ST capacity values. This preserves proper validation and remains within the approved ten-sheet inventory.

### 2.2 Metadata representation

Minimal workbook metadata may be stored in `Config` as key/value entries, for example:

- `SCHEMA_VERSION`
- `LAST_UPDATED_AT`
- `LAST_IMPORTED_AT`

This preserves the `Config` sheet for configuration semantics while avoiding a separate `WorkbookMeta` sheet. A full workbook audit model is not introduced in Phase 1.2.

---

## 3. Worksheet specifications

### 3.1 Teams

Purpose: team master data and active status.

| Column       | Type        | Required | Key / validation                 | Notes             |
| ------------ | ----------- | -------- | -------------------------------- | ----------------- |
| `team_id`    | String      | Yes      | PK, unique                       | Stable identifier |
| `team_name`  | String      | Yes      | Non-empty                        | Display name      |
| `status`     | String enum | Yes      | `Active`, `Inactive`, `Archived` | Active state      |
| `created_at` | Timestamp   | No       | System-generated                 | Insert timestamp  |
| `updated_at` | Timestamp   | No       | System-generated                 | Update timestamp  |
| `notes`      | String      | No       | Optional                         | Free-text notes   |

### 3.2 Releases

Purpose: real release schedule and business metadata.

| Column           | Type        | Required | Key / validation               | Notes                                          |
| ---------------- | ----------- | -------- | ------------------------------ | ---------------------------------------------- |
| `release_id`     | String      | Yes      | PK, unique                     | Stable identifier                              |
| `release_name`   | String      | Yes      | Non-empty                      | Business label                                 |
| `status`         | String enum | Yes      | release lifecycle status       | e.g. `Planned`, `Active`, `Closed`, `Archived` |
| `start_date`     | Date        | No       | on or before `end_date`        | Scheduling window start                        |
| `end_date`       | Date        | No       | on or after `start_date`       | Scheduling window end                          |
| `target_date`    | Date        | No       | distinct from scheduling dates | Planning target only                           |
| `priority_order` | Integer     | No       | numeric sort value             | ordering hint                                  |
| `created_at`     | Timestamp   | No       | System-generated               | Insert timestamp                               |
| `updated_at`     | Timestamp   | No       | System-generated               | Update timestamp                               |

### 3.3 TeamReleaseCapacity

Purpose: relationship table that stores team-specific Build and ST capacity for each release.

| Column            | Type        | Required | Key / validation                 | Notes                             |
| ----------------- | ----------- | -------- | -------------------------------- | --------------------------------- |
| `team_id`         | String      | Yes      | FK to `Teams.team_id`            | team owning the capacity          |
| `release_id`      | String      | Yes      | FK to `Releases.release_id`      | release to which capacity applies |
| `build_capacity`  | Number      | Yes      | non-negative decimal             | independent Build capacity        |
| `st_capacity`     | Number      | Yes      | non-negative decimal             | independent ST capacity           |
| `capacity_source` | String enum | No       | `Manual`, `Imported`, `Computed` | optional source metadata          |
| `created_at`      | Timestamp   | No       | System-generated                 | insert timestamp                  |
| `updated_at`      | Timestamp   | No       | System-generated                 | update timestamp                  |

Uniqueness:

- Primary key: composite (`team_id`, `release_id`)
- A team cannot have duplicate capacity rows for the same release

### 3.4 Features

Purpose: primary planning entity.

| Column                    | Type        | Required | Key / validation                            | Notes                                                                    |
| ------------------------- | ----------- | -------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `feature_id`              | String      | Yes      | PK, unique                                  | stable feature ID                                                        |
| `release_id`              | String      | No       | Optional legacy FK to `Releases.release_id` | retained for workbook compatibility; planning predicts release placement |
| `feature_name`            | String      | Yes      | non-empty                                   | feature title                                                            |
| `priority`                | Integer     | Yes      | numeric, 1=highest                          | strict ordering                                                          |
| `input_order`             | Integer     | Yes      | per team                                    | tie-breaker for equal team priority                                      |
| `team_id`                 | String      | No       | FK to `Teams.team_id`                       | optional assignment                                                      |
| `status`                  | String enum | Yes      | status vocabulary to confirm                | planning lifecycle                                                       |
| `build_estimate_current`  | Number      | Yes      | non-negative                                | current Build estimate                                                   |
| `build_original_estimate` | Number      | Yes      | immutable baseline                          | original Build estimate                                                  |
| `build_actual_spent`      | Number      | Yes      | non-negative                                | actual Build completion                                                  |
| `st_estimate_current`     | Number      | Yes      | non-negative                                | current ST estimate                                                      |
| `st_original_estimate`    | Number      | Yes      | immutable baseline                          | original ST estimate                                                     |
| `st_actual_spent`         | Number      | Yes      | non-negative                                | actual ST completion                                                     |
| `created_at`              | Timestamp   | No       | System-generated                            | insert timestamp                                                         |
| `updated_at`              | Timestamp   | No       | System-generated                            | update timestamp                                                         |

### 3.5 User Stories

Purpose: detailed story effort data without changing feature-level planning semantics.

| Column                    | Type        | Required | Key / validation             | Notes                         |
| ------------------------- | ----------- | -------- | ---------------------------- | ----------------------------- |
| `story_id`                | String      | Yes      | PK, unique                   | stable story ID               |
| `feature_id`              | String      | Yes      | FK to `Features.feature_id`  | owning feature                |
| `story_name`              | String      | Yes      | non-empty                    | story title                   |
| `input_order`             | Integer     | Yes      | per feature                  | order within feature          |
| `status`                  | String enum | Yes      | status vocabulary to confirm | story state                   |
| `build_estimate_current`  | Number      | Yes      | non-negative                 | story Build estimate          |
| `build_original_estimate` | Number      | Yes      | immutable baseline           | story original Build estimate |
| `build_actual_spent`      | Number      | Yes      | non-negative                 | actual Build spent            |
| `st_estimate_current`     | Number      | Yes      | non-negative                 | story ST estimate             |
| `st_original_estimate`    | Number      | Yes      | immutable baseline           | original ST estimate          |
| `st_actual_spent`         | Number      | Yes      | non-negative                 | actual ST spent               |
| `created_at`              | Timestamp   | No       | System-generated             | insert timestamp              |
| `updated_at`              | Timestamp   | No       | System-generated             | update timestamp              |

### 3.6 Dependencies

Purpose: dependency metadata and blocking semantics.

| Column                   | Type        | Required | Key / validation            | Notes                            |
| ------------------------ | ----------- | -------- | --------------------------- | -------------------------------- |
| `dependency_id`          | String      | Yes      | PK, unique                  | stable dependency ID             |
| `predecessor_feature_id` | String      | Yes      | FK to `Features.feature_id` | preceding feature                |
| `dependent_feature_id`   | String      | Yes      | FK to `Features.feature_id` | blocked feature                  |
| `dependency_type`        | String enum | Yes      | `Hard`, `Normal`            | hard vs normal dependency        |
| `affected_activity`      | String enum | No       | `Build`, `ST`, `Both`       | required for hard deps           |
| `blocking_pct`           | Number      | No       | 0..100                      | percent blocked while unresolved |
| `dependency_status`      | String enum | Yes      | `Unresolved`, `Resolved`    | current dependency state         |
| `responsible_team_id`    | String      | No       | FK to `Teams.team_id`       | optional owner                   |
| `notes`                  | String      | No       | Optional                    | free-text explanation            |
| `created_at`             | Timestamp   | No       | System-generated            | insert timestamp                 |
| `updated_at`             | Timestamp   | No       | System-generated            | update timestamp                 |

Story-level dependency scope remains explicitly unresolved and is not enforced in this schema.

### 3.7 Scenarios

Purpose: scenario definitions persisted separately from baseline data.

| Column          | Type      | Required | Key / validation | Notes                     |
| --------------- | --------- | -------- | ---------------- | ------------------------- |
| `scenario_id`   | String    | Yes      | PK, unique       | stable scenario ID        |
| `scenario_name` | String    | Yes      | Non-empty        | human readable name       |
| `global_pct`    | Number    | Yes      | 5..50            | default global percentage |
| `description`   | String    | No       | optional         | notes                     |
| `created_at`    | Timestamp | Yes      | System-generated | create time               |
| `updated_at`    | Timestamp | No       | System-generated | update time               |

### 3.8 Scenario Overrides

Purpose: per-feature overrides for scenario calculations.

| Column         | Type      | Required | Key / validation              | Notes                              |
| -------------- | --------- | -------- | ----------------------------- | ---------------------------------- |
| `scenario_id`  | String    | Yes      | FK to `Scenarios.scenario_id` | parent scenario                    |
| `feature_id`   | String    | Yes      | FK to `Features.feature_id`   | feature being overridden           |
| `override_pct` | Number    | Yes      | 0..100                        | replaces global % for that feature |
| `created_at`   | Timestamp | No       | System-generated              | insert timestamp                   |
| `updated_at`   | Timestamp | No       | System-generated              | update timestamp                   |

Composite key: (`scenario_id`, `feature_id`)

### 3.9 Scenario Projections

Purpose: saved serialized results of scenario plan runs.

| Column             | Type      | Required | Key / validation              | Notes                  |
| ------------------ | --------- | -------- | ----------------------------- | ---------------------- |
| `projection_id`    | String    | Yes      | PK, unique                    | stable projection ID   |
| `scenario_id`      | String    | Yes      | FK to `Scenarios.scenario_id` | owning scenario        |
| `projection_name`  | String    | Yes      | non-empty                     | display label          |
| `saved_at`         | Timestamp | Yes      | System-generated              | save timestamp         |
| `plan_result_json` | String    | Yes      | valid JSON                    | serialized plan result |
| `plan_hash`        | String    | No       | optional                      | integrity checksum     |
| `source_etag`      | String    | No       | optional                      | source version hint    |

### 3.10 Config

Purpose: workbook configuration values, including sprint cadence and TBC capacity policy.

| Column         | Type        | Required | Key / validation                              | Notes                  |
| -------------- | ----------- | -------- | --------------------------------------------- | ---------------------- |
| `config_key`   | String      | Yes      | PK, unique                                    | e.g. `SPRINT_CADENCE`  |
| `config_value` | String      | Yes      | parse according to `value_type`               | stored value           |
| `value_type`   | String enum | Yes      | `String`, `Number`, `Boolean`, `Date`, `JSON` | value representation   |
| `description`  | String      | No       | optional                                      | human-readable meaning |
| `updated_at`   | Timestamp   | No       | System-generated                              | last modification      |

Minimal metadata such as `SCHEMA_VERSION` and `LAST_UPDATED_AT` may be stored here, but a full workbook metadata model is not added in Phase 1.2.

---

## 4. Relationship summary under the approved ten-sheet inventory

- `Teams` -> `Features` via `team_id`
- `Teams` -> `TeamReleaseCapacity` via `team_id`
- `Releases` -> `Features` via `release_id`
- `Releases` -> `TeamReleaseCapacity` via `release_id`
- `Features` -> `User Stories` via `feature_id`
- `Features` -> `Dependencies` via predecessor/dependent IDs
- `Scenarios` -> `Scenario Overrides` via `scenario_id`
- `Scenarios` -> `Scenario Projections` via `scenario_id`
- `Config` stores minimal workbook metadata and configuration values only

This is the approved workbook inventory and remains the baseline until further user-approved changes are requested.

---

## 5. Ordering, dependency, and scenario semantics preserved

- Priority ordering: `priority` ascending, ties broken by `input_order`
- Hard dependencies: only affect the dependent feature’s remaining effort while unresolved
- Normal dependencies: ordering preference only, no blocking
- Scenario overlays: persisted separately and never mutate baseline originals
- Original estimates and actual spent remain immutable under scenario runs
- Working data remains in the workbook so users do not need to re-import the original CSV

---

## 6. Explicit unresolved points

The following remain unresolved and must not be treated as confirmed requirements:

- story-level dependency scope
- exact status vocabularies for releases/features/stories
- whether baseline planning outputs should be persisted in the workbook as a dedicated historical record

These are still review items and should remain explicitly unresolved.

---

## 7. Implementation-ready conclusion

The approved workbook inventory is now explicit and stable:

1. `Teams`
2. `Releases`
3. `Features`
4. `User Stories`
5. `Dependencies`
6. `Scenarios`
7. `Scenario Overrides`
8. `Scenario Projections`
9. `TeamReleaseCapacity`
10. `Config`

`TeamReleaseCapacity` is the required relationship sheet for independent multi-team, multi-release Build/ST capacity. Minimal metadata remains in `Config`; `WorkbookMeta` and `PlanningOutputs` are not added. All other confirmed business rules remain unchanged.
