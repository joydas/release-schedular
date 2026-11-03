'use strict';

const { buildDependencyGraph, DependencyGraphError } = require('./dependencyGraph');

class FeatureOrderingError extends Error {
  constructor(message, { code, featureId = null, dependencyId = null } = {}) {
    super(message);
    this.name = 'FeatureOrderingError';
    this.code = code;
    this.featureId = featureId;
    this.dependencyId = dependencyId;
  }
}

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareReadyFeatures(leftId, rightId, featureById) {
  const left = featureById.get(leftId);
  const right = featureById.get(rightId);
  const leftTeamId = String(left.team_id ?? '').trim();
  const rightTeamId = String(right.team_id ?? '').trim();
  const sameAssignedTeam = leftTeamId !== '' && leftTeamId === rightTeamId;
  return (
    (sameAssignedTeam ? Number(left.priority) - Number(right.priority) : 0) ||
    Number(left.input_order) - Number(right.input_order) ||
    compareIds(leftId, rightId)
  );
}

function push(heap, value, compare) {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compare(heap[parent], heap[index]) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function pop(heap, compare) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && compare(heap[left], heap[smallest]) < 0) smallest = left;
      if (right < heap.length && compare(heap[right], heap[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }
  return first;
}

function validateOrderingFields(features) {
  const featureById = new Map();
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') {
      throw new FeatureOrderingError('Every feature must be a record.', {
        code: 'INVALID_FEATURE',
      });
    }
    const featureId = String(feature.feature_id ?? '').trim();
    const priorityValue = String(feature.priority ?? '').trim();
    const inputOrderValue = String(feature.input_order ?? '').trim();
    if (!Number.isSafeInteger(Number(priorityValue)) || priorityValue === '') {
      throw new FeatureOrderingError(
        `Feature ${featureId || '(missing ID)'} has an invalid priority.`,
        {
          code: 'INVALID_PRIORITY',
          featureId: featureId || null,
        }
      );
    }
    if (!Number.isSafeInteger(Number(inputOrderValue)) || inputOrderValue === '') {
      throw new FeatureOrderingError(
        `Feature ${featureId || '(missing ID)'} has an invalid input_order.`,
        { code: 'INVALID_INPUT_ORDER', featureId: featureId || null }
      );
    }
    featureById.set(featureId, feature);
  }
  return featureById;
}

function validateDependencyPriorities(features, dependencies, featureById) {
  dependencies.forEach((dependency, index) => {
    const dependencyId = dependency?.dependency_id ?? `at index ${index}`;
    const predecessorId = String(dependency?.predecessor_feature_id ?? '').trim();
    const dependentId = String(dependency?.dependent_feature_id ?? '').trim();
    const predecessor = featureById.get(predecessorId);
    const dependent = featureById.get(dependentId);
    if (!predecessor || !dependent) return;

    const predecessorPriority = Number(predecessor.priority);
    const dependentPriority = Number(dependent.priority);
    const predecessorTeamId = String(predecessor.team_id ?? '').trim();
    const dependentTeamId = String(dependent.team_id ?? '').trim();
    if (!predecessorTeamId || predecessorTeamId !== dependentTeamId) return;
    if (
      !Number.isSafeInteger(predecessorPriority) ||
      !Number.isSafeInteger(dependentPriority) ||
      predecessorPriority >= dependentPriority
    ) {
      throw new FeatureOrderingError(
        `Dependency ${dependencyId} requires predecessor ${predecessorId} (team ${predecessorTeamId}, priority ${predecessor.priority}) to have a strictly higher priority than dependent ${dependentId} (team ${dependentTeamId}, priority ${dependent.priority}).`,
        {
          code: 'INVALID_DEPENDENCY_PRIORITY',
          featureId: predecessorId,
          dependencyId: dependency?.dependency_id ?? null,
        }
      );
    }
  });
}

function getFeatureConsiderationOrder(features, dependencies) {
  if (!Array.isArray(features) || !Array.isArray(dependencies)) {
    throw new TypeError('Features and dependencies must be arrays.');
  }

  const featureById = validateOrderingFields(features);
  for (let index = 0; index < dependencies.length; index += 1) {
    const dependency = dependencies[index];
    if (!dependency || typeof dependency !== 'object') continue;
    const label = dependency.dependency_id ?? `at index ${index}`;
    if (!['Hard', 'Normal'].includes(String(dependency.dependency_type ?? '').trim())) {
      throw new DependencyGraphError(`Dependency ${label} has an invalid dependency_type.`, {
        code: 'INVALID_DEPENDENCY_TYPE',
        dependencyId: dependency.dependency_id ?? null,
      });
    }
    if (!['Unresolved', 'Resolved'].includes(String(dependency.dependency_status ?? '').trim())) {
      throw new DependencyGraphError(`Dependency ${label} has an invalid dependency_status.`, {
        code: 'INVALID_DEPENDENCY_STATUS',
        dependencyId: dependency.dependency_id ?? null,
      });
    }
  }
  const graph = buildDependencyGraph(features, dependencies);

  const outgoing = new Map(graph.nodes.map((featureId) => [featureId, []]));
  const inDegree = new Map(graph.nodes.map((featureId) => [featureId, 0]));
  for (const edge of graph.edges) {
    outgoing.get(edge.predecessor_feature_id).push(edge.dependent_feature_id);
    inDegree.set(edge.dependent_feature_id, inDegree.get(edge.dependent_feature_id) + 1);
  }

  const compare = (leftId, rightId) => compareReadyFeatures(leftId, rightId, featureById);
  const ready = [];
  for (const featureId of graph.nodes) {
    if (inDegree.get(featureId) === 0) push(ready, featureId, compare);
  }

  const orderedFeatureIds = [];
  while (ready.length > 0) {
    const featureId = pop(ready, compare);
    orderedFeatureIds.push(featureId);
    for (const dependentId of outgoing.get(featureId)) {
      const nextDegree = inDegree.get(dependentId) - 1;
      inDegree.set(dependentId, nextDegree);
      if (nextDegree === 0) push(ready, dependentId, compare);
    }
  }

  if (orderedFeatureIds.length !== graph.nodes.length) {
    throw new DependencyGraphError('Dependency graph contains a directed cycle.', {
      code: 'DEPENDENCY_CYCLE',
      featureIds: graph.nodes.filter((featureId) => inDegree.get(featureId) > 0),
    });
  }
  validateDependencyPriorities(features, dependencies, featureById);
  return orderedFeatureIds;
}

module.exports = { FeatureOrderingError, getFeatureConsiderationOrder };
