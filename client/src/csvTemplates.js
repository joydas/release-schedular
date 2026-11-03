const TEMPLATE_FIELDS = {
  feature: [
    'feature_id',
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
  ],
  story: [
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
  ],
};

const TEMPLATE_SAMPLES = {
  feature: () => [
    'SAMPLE-FEATURE-001',
    'Sample feature, replace this row',
    '1',
    '1',
    '',
    'Backlog',
    '8',
    '8',
    '0',
    '3',
    '3',
    '0',
  ],
  story: (referenceId) => [
    'SAMPLE-STORY-001',
    referenceId,
    'Sample story, replace this row',
    '1',
    'Backlog',
    '5',
    '5',
    '0',
    '2',
    '2',
    '0',
  ],
};

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function getCsvTemplate(entity, referenceId) {
  if (!entity || !Object.hasOwn(TEMPLATE_FIELDS, entity)) return null;
  if (entity === 'story' && !String(referenceId ?? '').trim()) {
    throw new Error(
      'An existing feature is required to create a valid story sample. Add a feature, then retry.'
    );
  }

  const headers = TEMPLATE_FIELDS[entity].map((field) => `${entity}_${field}`);
  const row = TEMPLATE_SAMPLES[entity](String(referenceId ?? '').trim());
  const csv = `\uFEFF${[headers, row].map((cells) => cells.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
  return {
    filename:
      entity === 'feature' ? 'feature-import-template.csv' : 'user-story-import-template.csv',
    headers,
    csv,
  };
}

export { getCsvTemplate, TEMPLATE_FIELDS };
