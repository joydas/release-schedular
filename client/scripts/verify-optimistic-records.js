import assert from 'node:assert/strict';
import {
  replaceRecordFromServer,
  runOptimisticMutation,
  upsertOptimisticRecord,
} from '../src/optimisticRecords.js';

const initial = [
  {
    feature_id: 'F-1',
    feature_name: 'Original name',
    build_estimate_current: 8,
    build_original_estimate: 10,
    build_actual_spent: 3,
  },
  { feature_id: 'F-2', feature_name: 'Unrelated feature' },
];
const optimistic = upsertOptimisticRecord(
  initial,
  { feature_id: 'F-1', feature_name: 'Pending name' },
  'feature_id'
);

assert.equal(optimistic[0].feature_name, 'Pending name');
assert.equal(optimistic[0].build_original_estimate, 10);
assert.equal(optimistic[0].build_actual_spent, 3);
assert.equal(optimistic[1], initial[1]);
assert.equal(initial[0].feature_name, 'Original name');

const confirmed = replaceRecordFromServer(
  optimistic,
  { ...optimistic[0], feature_name: 'Confirmed name', updated_at: 'server-time' },
  'feature_id'
);
assert.equal(confirmed[0].feature_name, 'Confirmed name');
assert.equal(confirmed[0].updated_at, 'server-time');
assert.equal(confirmed[1], initial[1]);

const created = upsertOptimisticRecord(
  [],
  { release_id: 'R-1', release_name: 'New' },
  'release_id'
);
assert.deepEqual(created, [{ release_id: 'R-1', release_name: 'New' }]);
assert.deepEqual(initial, [
  {
    feature_id: 'F-1',
    feature_name: 'Original name',
    build_estimate_current: 8,
    build_original_estimate: 10,
    build_actual_spent: 3,
  },
  { feature_id: 'F-2', feature_name: 'Unrelated feature' },
]);
assert.equal(replaceRecordFromServer(optimistic, null, 'feature_id'), optimistic);

let visibleRecords = initial;
let confirmedSuccess = false;
let submitCount = 0;
const response = await runOptimisticMutation({
  applyOptimistic: () => {
    visibleRecords = upsertOptimisticRecord(
      visibleRecords,
      { feature_id: 'F-1', feature_name: 'Submitting' },
      'feature_id'
    );
    assert.equal(visibleRecords[0].feature_name, 'Submitting');
  },
  sendMutation: async () => {
    submitCount += 1;
    return { data: { ...visibleRecords[0], feature_name: 'Persisted' }, workbookVersion: 11 };
  },
  reconcile: (result) => {
    visibleRecords = replaceRecordFromServer(visibleRecords, result.data, 'feature_id');
    confirmedSuccess = true;
  },
  rollback: () => {
    visibleRecords = initial;
  },
});
assert.equal(response.workbookVersion, 11);
assert.equal(visibleRecords[0].feature_name, 'Persisted');
assert.equal(confirmedSuccess, true);
assert.equal(submitCount, 1);

const rejected = new Error('Validation rejected the mutation.');
visibleRecords = initial;
confirmedSuccess = false;
submitCount = 0;
await assert.rejects(
  runOptimisticMutation({
    applyOptimistic: () => {
      visibleRecords = upsertOptimisticRecord(
        visibleRecords,
        { feature_id: 'F-1', feature_name: 'Invalid pending value' },
        'feature_id'
      );
    },
    sendMutation: async () => {
      submitCount += 1;
      throw rejected;
    },
    reconcile: () => {
      confirmedSuccess = true;
    },
    rollback: () => {
      visibleRecords = initial;
    },
  }),
  (error) => error === rejected
);
assert.equal(visibleRecords, initial);
assert.equal(confirmedSuccess, false);
assert.equal(submitCount, 1);

console.log('Optimistic record and mutation verification passed.');
