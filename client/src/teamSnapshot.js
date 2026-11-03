const TEAM_SNAPSHOT_ENDPOINTS = ['/api/teams', '/api/releases', '/api/capacities'];

export class SnapshotConsistencyError extends Error {
  constructor(attempts, versions) {
    const versionSummary = versions.map((version) => version ?? 'missing').join(', ');
    super(
      `Could not load a consistent workbook snapshot after ${attempts} attempts (reported versions: ${versionSummary}). Refresh and try again.`
    );
    this.name = 'SnapshotConsistencyError';
    this.attempts = attempts;
    this.versions = versions;
  }
}

export async function loadConsistentSnapshot(requestJson, endpoints, { maxAttempts = 3 } = {}) {
  let lastVersions = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const responses = await Promise.all(endpoints.map((endpoint) => requestJson(endpoint)));
    lastVersions = responses.map((response) => response.workbookVersion);
    const version = lastVersions[0];
    const allVersionsMatch =
      Number.isSafeInteger(version) &&
      version >= 0 &&
      lastVersions.every((item) => item === version);

    if (allVersionsMatch) {
      return { responses, workbookVersion: version };
    }
  }

  throw new SnapshotConsistencyError(maxAttempts, lastVersions);
}

export async function loadConsistentTeamSnapshot(requestJson, options) {
  const snapshot = await loadConsistentSnapshot(requestJson, TEAM_SNAPSHOT_ENDPOINTS, options);
  const [teams, releases, capacities] = snapshot.responses;
  return { teams, releases, capacities, workbookVersion: snapshot.workbookVersion };
}

export function canMutateFromSnapshot(snapshotReady, workbookVersion) {
  return snapshotReady && Number.isSafeInteger(workbookVersion) && workbookVersion >= 0;
}
