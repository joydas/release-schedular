import assert from 'node:assert/strict';
import {
  canMutateFromSnapshot,
  loadConsistentSnapshot,
  loadConsistentTeamSnapshot,
  SnapshotConsistencyError,
} from '../src/teamSnapshot.js';

function responses(version, label = '') {
  return [
    { ok: true, data: [{ team_id: `team${label}` }], workbookVersion: version },
    { ok: true, data: [{ release_id: `release${label}` }], workbookVersion: version },
    {
      ok: true,
      data: [{ team_id: `team${label}`, release_id: `release${label}` }],
      workbookVersion: version,
    },
  ];
}

async function verifyConsistentSnapshotIsWritable() {
  const queue = responses(12);
  const requested = [];
  const snapshot = await loadConsistentTeamSnapshot(async (endpoint) => {
    requested.push(endpoint);
    return queue.shift();
  });

  assert.equal(snapshot.workbookVersion, 12);
  assert.deepEqual(requested, ['/api/teams', '/api/releases', '/api/capacities']);
  assert.equal(canMutateFromSnapshot(true, snapshot.workbookVersion), true);
  assert.equal(snapshot.teams.data[0].team_id, 'team');
  assert.equal(snapshot.releases.data[0].release_id, 'release');
}

async function verifyMismatchesRetryBeforeAcceptingSnapshot() {
  const mismatchedResponses = responses(20, '-old');
  mismatchedResponses[1].workbookVersion = 19;
  const queue = [...mismatchedResponses, ...responses(21, '-consistent')];
  let requests = 0;
  const snapshot = await loadConsistentSnapshot(async () => {
    requests += 1;
    return queue.shift();
  }, ['/api/features', '/api/releases', '/api/teams']);

  assert.equal(requests, 6);
  assert.equal(snapshot.workbookVersion, 21);
  assert.equal(snapshot.responses[0].data[0].team_id, 'team-consistent');
  assert.equal(canMutateFromSnapshot(true, snapshot.workbookVersion), true);
}

async function verifyExhaustedRetriesBlockMutations() {
  let requests = 0;
  let submittedMutations = 0;
  await assert.rejects(
    loadConsistentTeamSnapshot(
      async () => {
        const version = 30 + (requests % 3 === 1 ? 1 : 0);
        requests += 1;
        return { ok: true, data: [], workbookVersion: version };
      },
      { maxAttempts: 3 }
    ),
    (error) => {
      assert.ok(error instanceof SnapshotConsistencyError);
      assert.equal(error.attempts, 3);
      assert.match(error.message, /consistent workbook snapshot after 3 attempts/);
      return true;
    }
  );

  const snapshotReady = false;
  const workbookVersion = null;
  if (canMutateFromSnapshot(snapshotReady, workbookVersion)) submittedMutations += 1;
  assert.equal(requests, 9);
  assert.equal(submittedMutations, 0);
  assert.equal(canMutateFromSnapshot(true, null), false);
}

await verifyConsistentSnapshotIsWritable();
await verifyMismatchesRetryBeforeAcceptingSnapshot();
await verifyExhaustedRetriesBlockMutations();
console.log('Team snapshot consistency verification passed.');
