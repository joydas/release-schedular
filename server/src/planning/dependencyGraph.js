'use strict';

class DependencyGraphError extends Error {
  constructor(message, { code, dependencyId = null, featureIds = [], cycle = [] } = {}) {
    super(message);
    this.name = 'DependencyGraphError';
    this.code = code;
    this.dependencyId = dependencyId;
    this.featureIds = featureIds;
    this.cycle = cycle;
  }
}

function compareFeatureIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFeatures(left, right) {
  const inputOrder = (value) => {
    const normalized = String(value ?? '').trim();
    return normalized !== '' && Number.isSafeInteger(Number(normalized))
      ? Number(normalized)
      : Number.POSITIVE_INFINITY;
  };
  const leftOrder = inputOrder(left.input_order);
  const rightOrder = inputOrder(right.input_order);

  return leftOrder - rightOrder || compareFeatureIds(left.feature_id, right.feature_id);
}

function pushHeap(heap, value, compare) {
  heap.push(value);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compare(heap[parent], heap[index]) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function popHeap(heap, compare) {
  if (heap.length === 0) return undefined;
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

function findCycle(adjacency, remainingFeatureIds) {
  const remaining = new Set(remainingFeatureIds);
  const state = new Map();
  const path = [];
  const pathPositions = new Map();

  for (const featureId of remainingFeatureIds) {
    if (state.has(featureId)) continue;
    state.set(featureId, 1);
    pathPositions.set(featureId, path.length);
    path.push(featureId);
    const stack = [{ featureId, nextNeighborIndex: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame.featureId) || [];
      if (frame.nextNeighborIndex >= neighbors.length) {
        stack.pop();
        path.pop();
        pathPositions.delete(frame.featureId);
        state.set(frame.featureId, 2);
        continue;
      }

      const dependentId = neighbors[frame.nextNeighborIndex];
      frame.nextNeighborIndex += 1;
      if (!remaining.has(dependentId)) continue;
      if (state.get(dependentId) === 1) {
        return path.slice(pathPositions.get(dependentId)).concat(dependentId);
      }
      if (!state.has(dependentId)) {
        state.set(dependentId, 1);
        pathPositions.set(dependentId, path.length);
        path.push(dependentId);
        stack.push({ featureId: dependentId, nextNeighborIndex: 0 });
      }
    }
  }
  return [];
}

function buildDependencyGraph(features, dependencies) {
  if (!Array.isArray(features) || !Array.isArray(dependencies)) {
    throw new TypeError('Features and dependencies must be arrays.');
  }

  const orderedFeatures = features.map((feature) => {
    if (!feature || typeof feature !== 'object') {
      throw new DependencyGraphError('Every feature must be a record.', {
        code: 'INVALID_FEATURE',
      });
    }
    const featureId = String(feature.feature_id ?? '').trim();
    if (!featureId) {
      throw new DependencyGraphError('Every feature must have a feature_id.', {
        code: 'INVALID_FEATURE',
      });
    }
    return { feature, featureId };
  });

  const featuresById = new Map();
  for (const { feature, featureId } of orderedFeatures) {
    if (featuresById.has(featureId)) {
      throw new DependencyGraphError(`Feature ${featureId} appears more than once.`, {
        code: 'DUPLICATE_FEATURE',
        featureIds: [featureId],
      });
    }
    featuresById.set(featureId, feature);
  }

  const featureIds = [...featuresById.keys()].sort((left, right) =>
    compareFeatures(featuresById.get(left), featuresById.get(right))
  );
  const compareNodeIds = (left, right) =>
    compareFeatures(featuresById.get(left), featuresById.get(right));
  const adjacency = new Map(featureIds.map((featureId) => [featureId, []]));
  const inDegree = new Map(featureIds.map((featureId) => [featureId, 0]));
  const edges = [];

  dependencies.forEach((dependency, index) => {
    if (!dependency || typeof dependency !== 'object') {
      throw new DependencyGraphError(`Dependency at index ${index} must be a record.`, {
        code: 'INVALID_DEPENDENCY',
      });
    }

    const predecessorId = String(dependency.predecessor_feature_id ?? '').trim();
    const dependentId = String(dependency.dependent_feature_id ?? '').trim();
    const missingFeatureIds = [predecessorId, dependentId].filter(
      (featureId) => !featureId || !featuresById.has(featureId)
    );
    if (missingFeatureIds.length > 0) {
      const reportedIds = [...new Set(missingFeatureIds)];
      const dependencyLabel = dependency.dependency_id ?? `at index ${index}`;
      throw new DependencyGraphError(
        `Dependency ${dependencyLabel} references missing feature${reportedIds.length === 1 ? '' : 's'}: ${reportedIds.map((id) => id || '(blank)').join(', ')}.`,
        {
          code: 'MISSING_FEATURE_REFERENCE',
          dependencyId: dependency.dependency_id ?? null,
          featureIds: reportedIds,
        }
      );
    }

    adjacency.get(predecessorId).push(dependentId);
    inDegree.set(dependentId, inDegree.get(dependentId) + 1);
    edges.push({
      dependency_id: dependency.dependency_id ?? null,
      predecessor_feature_id: predecessorId,
      dependent_feature_id: dependentId,
      dependency_type: dependency.dependency_type ?? null,
      dependency_status: dependency.dependency_status ?? null,
    });
  });

  for (const dependents of adjacency.values()) {
    dependents.sort(compareFeatureIds);
  }
  edges.sort(
    (left, right) =>
      compareFeatureIds(left.predecessor_feature_id, right.predecessor_feature_id) ||
      compareFeatureIds(left.dependent_feature_id, right.dependent_feature_id) ||
      compareFeatureIds(String(left.dependency_id ?? ''), String(right.dependency_id ?? ''))
  );

  const ready = [];
  for (const featureId of featureIds) {
    if (inDegree.get(featureId) === 0) pushHeap(ready, featureId, compareNodeIds);
  }

  const topologicalOrder = [];
  while (ready.length > 0) {
    const featureId = popHeap(ready, compareNodeIds);
    topologicalOrder.push(featureId);
    for (const dependentId of adjacency.get(featureId)) {
      const nextInDegree = inDegree.get(dependentId) - 1;
      inDegree.set(dependentId, nextInDegree);
      if (nextInDegree === 0) pushHeap(ready, dependentId, compareNodeIds);
    }
  }

  if (topologicalOrder.length !== featureIds.length) {
    const remainingFeatureIds = featureIds.filter((featureId) => inDegree.get(featureId) > 0);
    const cycle = findCycle(adjacency, remainingFeatureIds);
    throw new DependencyGraphError(
      `Dependency graph contains a directed cycle${cycle.length > 0 ? `: ${cycle.join(' → ')}` : '.'}`,
      {
        code: 'DEPENDENCY_CYCLE',
        featureIds: cycle.length > 0 ? [...new Set(cycle)] : remainingFeatureIds,
        cycle,
      }
    );
  }

  return {
    nodes: featureIds,
    edges,
    topologicalOrder,
  };
}

module.exports = { DependencyGraphError, buildDependencyGraph };
