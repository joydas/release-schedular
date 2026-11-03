'use strict';

class HardDependencyBlockingError extends Error {
  constructor(message, { code, featureId = null, dependencyId = null } = {}) {
    super(message);
    this.name = 'HardDependencyBlockingError';
    this.code = code;
    this.featureId = featureId;
    this.dependencyId = dependencyId;
  }
}

function toNonNegativeNumber(value, label, featureId) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new HardDependencyBlockingError(`${label} is required for feature ${featureId}.`, {
      code: 'INVALID_FEATURE_EFFORT',
      featureId,
    });
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new HardDependencyBlockingError(`${label} must be a finite non-negative number.`, {
      code: 'INVALID_FEATURE_EFFORT',
      featureId,
    });
  }
  return number;
}

function normalizeDependency(dependency, index, featuresById) {
  if (!dependency || typeof dependency !== 'object') {
    throw new HardDependencyBlockingError(`Dependency at index ${index} must be a record.`, {
      code: 'INVALID_DEPENDENCY',
    });
  }

  const dependencyId = dependency.dependency_id ?? null;
  const label = dependencyId ?? `at index ${index}`;
  const predecessorId = String(dependency.predecessor_feature_id ?? '').trim();
  const dependentId = String(dependency.dependent_feature_id ?? '').trim();
  for (const featureId of [predecessorId, dependentId]) {
    if (!featureId || !featuresById.has(featureId)) {
      throw new HardDependencyBlockingError(
        `Dependency ${label} references missing feature ${featureId || '(blank)'}.`,
        { code: 'MISSING_FEATURE_REFERENCE', dependencyId, featureId: featureId || null }
      );
    }
  }
  if (predecessorId === dependentId) {
    throw new HardDependencyBlockingError(
      `Dependency ${label} cannot reference the same feature as predecessor and dependent.`,
      { code: 'SELF_DEPENDENCY', dependencyId, featureId: predecessorId }
    );
  }

  const dependencyType = String(dependency.dependency_type ?? '').trim();
  if (!['Hard', 'Normal'].includes(dependencyType)) {
    throw new HardDependencyBlockingError(`Dependency ${label} has an invalid dependency_type.`, {
      code: 'INVALID_DEPENDENCY_TYPE',
      dependencyId,
    });
  }

  const dependencyStatus = String(dependency.dependency_status ?? '').trim();
  if (!['Unresolved', 'Resolved'].includes(dependencyStatus)) {
    throw new HardDependencyBlockingError(`Dependency ${label} has an invalid dependency_status.`, {
      code: 'INVALID_DEPENDENCY_STATUS',
      dependencyId,
    });
  }

  const rawActivity = dependency.affected_activity;
  const normalizedActivity = String(rawActivity ?? '').trim();
  const affectedActivity = normalizedActivity === '' ? null : normalizedActivity;
  if (affectedActivity !== null && !['Build', 'ST', 'Both'].includes(affectedActivity)) {
    throw new HardDependencyBlockingError(`Dependency ${label} has an invalid affected_activity.`, {
      code: 'INVALID_AFFECTED_ACTIVITY',
      dependencyId,
    });
  }
  if (dependencyType === 'Hard' && affectedActivity === null) {
    throw new HardDependencyBlockingError(`Hard dependency ${label} requires affected_activity.`, {
      code: 'INVALID_AFFECTED_ACTIVITY',
      dependencyId,
    });
  }

  const rawPercentage = dependency.blocking_pct;
  const percentageMissing =
    rawPercentage === null ||
    rawPercentage === undefined ||
    (typeof rawPercentage === 'string' && rawPercentage.trim() === '');
  if (dependencyType === 'Hard' && percentageMissing) {
    throw new HardDependencyBlockingError(`Hard dependency ${label} requires blocking_pct.`, {
      code: 'INVALID_BLOCKING_PERCENTAGE',
      dependencyId,
    });
  }

  let blockingPct = null;
  if (!percentageMissing) {
    blockingPct = Number(rawPercentage);
    if (!Number.isFinite(blockingPct) || blockingPct < 0 || blockingPct > 100) {
      throw new HardDependencyBlockingError(
        `Dependency ${label} blocking_pct must be between 0 and 100.`,
        { code: 'INVALID_BLOCKING_PERCENTAGE', dependencyId }
      );
    }
  }

  return {
    dependencyId: dependencyId ?? `dependency-${index}`,
    predecessorId,
    dependentId,
    dependencyType,
    dependencyStatus,
    affectedActivity,
    blockingPct,
  };
}

function makeActivityResult(remainingEffort, contributions) {
  const blockingPercentageTotal = contributions.reduce(
    (total, contribution) => total + contribution.blockingPct,
    0
  );
  const uncappedBlockedEffort = (remainingEffort * blockingPercentageTotal) / 100;
  const blockedEffort = Math.min(remainingEffort, uncappedBlockedEffort);

  return {
    remaining_effort: remainingEffort,
    blocking_percentage_total: blockingPercentageTotal,
    uncapped_blocked_effort: uncappedBlockedEffort,
    blocked_effort: blockedEffort,
    allocatable_effort: remainingEffort - blockedEffort,
    contributions: contributions.map((contribution) => ({
      dependency_id: contribution.dependencyId,
      blocking_pct: contribution.blockingPct,
      blocked_effort: (remainingEffort * contribution.blockingPct) / 100,
    })),
  };
}

function calculateHardDependencyBlocking(features, dependencies) {
  if (!Array.isArray(features) || !Array.isArray(dependencies)) {
    throw new TypeError('Features and dependencies must be arrays.');
  }

  const featuresById = new Map();
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') {
      throw new HardDependencyBlockingError('Every feature must be a record.', {
        code: 'INVALID_FEATURE',
      });
    }
    const featureId = String(feature.feature_id ?? '').trim();
    if (!featureId) {
      throw new HardDependencyBlockingError('Every feature must have a feature_id.', {
        code: 'INVALID_FEATURE',
      });
    }
    if (featuresById.has(featureId)) {
      throw new HardDependencyBlockingError(`Feature ${featureId} appears more than once.`, {
        code: 'DUPLICATE_FEATURE',
        featureId,
      });
    }
    featuresById.set(featureId, feature);
  }

  const normalizedDependencies = dependencies.map((dependency, index) =>
    normalizeDependency(dependency, index, featuresById)
  );
  const byDependentFeature = new Map([...featuresById.keys()].map((featureId) => [featureId, []]));
  for (const dependency of normalizedDependencies) {
    if (dependency.dependencyType !== 'Hard' || dependency.dependencyStatus !== 'Unresolved') {
      continue;
    }
    byDependentFeature.get(dependency.dependentId).push(dependency);
  }

  return [...featuresById.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([featureId, feature]) => {
      const buildEstimate = toNonNegativeNumber(
        feature.build_estimate_current,
        'build_estimate_current',
        featureId
      );
      const buildActual = toNonNegativeNumber(
        feature.build_actual_spent,
        'build_actual_spent',
        featureId
      );
      const stEstimate = toNonNegativeNumber(
        feature.st_estimate_current,
        'st_estimate_current',
        featureId
      );
      const stActual = toNonNegativeNumber(feature.st_actual_spent, 'st_actual_spent', featureId);
      const blockers = byDependentFeature
        .get(featureId)
        .sort((left, right) =>
          left.dependencyId < right.dependencyId
            ? -1
            : left.dependencyId > right.dependencyId
              ? 1
              : 0
        );
      const buildContributions = blockers
        .filter((dependency) => ['Build', 'Both'].includes(dependency.affectedActivity))
        .map((dependency) => ({
          dependencyId: dependency.dependencyId,
          blockingPct: dependency.blockingPct,
        }));
      const stContributions = blockers
        .filter((dependency) => ['ST', 'Both'].includes(dependency.affectedActivity))
        .map((dependency) => ({
          dependencyId: dependency.dependencyId,
          blockingPct: dependency.blockingPct,
        }));

      return {
        feature_id: featureId,
        build: makeActivityResult(Math.max(0, buildEstimate - buildActual), buildContributions),
        st: makeActivityResult(Math.max(0, stEstimate - stActual), stContributions),
      };
    });
}

module.exports = { HardDependencyBlockingError, calculateHardDependencyBlocking };
