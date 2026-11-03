'use strict';

const SHEETS = Object.freeze([
  {
    name: 'Teams',
    columns: ['team_id', 'team_name', 'status', 'created_at', 'updated_at', 'notes'],
  },
  {
    name: 'Releases',
    columns: [
      'release_id',
      'release_name',
      'status',
      'start_date',
      'end_date',
      'target_date',
      'priority_order',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Features',
    columns: [
      'feature_id',
      'release_id',
      'feature_name',
      'priority',
      'input_order',
      'team_id',
      'status',
      'build_estimate_current',
      'build_original_estimate',
      'build_actual_spent',
      'st_estimate_current',
      'st_original_estimate',
      'st_actual_spent',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'User Stories',
    columns: [
      'story_id',
      'feature_id',
      'story_name',
      'input_order',
      'status',
      'build_estimate_current',
      'build_original_estimate',
      'build_actual_spent',
      'st_estimate_current',
      'st_original_estimate',
      'st_actual_spent',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Dependencies',
    columns: [
      'dependency_id',
      'predecessor_feature_id',
      'dependent_feature_id',
      'dependency_type',
      'affected_activity',
      'blocking_pct',
      'dependency_status',
      'responsible_team_id',
      'notes',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Scenarios',
    columns: [
      'scenario_id',
      'scenario_name',
      'global_pct',
      'description',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Scenario Overrides',
    columns: ['scenario_id', 'feature_id', 'override_pct', 'created_at', 'updated_at'],
  },
  {
    name: 'Scenario Projections',
    columns: [
      'projection_id',
      'scenario_id',
      'projection_name',
      'saved_at',
      'plan_result_json',
      'plan_hash',
      'source_etag',
    ],
  },
  {
    name: 'TeamReleaseCapacity',
    columns: [
      'team_id',
      'release_id',
      'build_capacity',
      'st_capacity',
      'capacity_source',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Config',
    columns: ['config_key', 'config_value', 'value_type', 'description', 'updated_at'],
  },
]);

const SHEET_NAMES = SHEETS.map((sheet) => sheet.name);

const SHEET_BY_NAME = new Map(SHEETS.map((sheet) => [sheet.name, sheet]));

function getSheetDefinition(sheetName) {
  const sheet = SHEET_BY_NAME.get(sheetName);

  if (!sheet) {
    throw new Error(`Unknown worksheet: ${sheetName}`);
  }

  return sheet;
}

module.exports = {
  SHEETS,
  SHEET_NAMES,
  SHEET_BY_NAME,
  getSheetDefinition,
};
