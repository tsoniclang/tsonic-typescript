export function closeDependencyCandidates<T>(
  candidates: ReadonlySet<T>,
  dependencyMaps: readonly ReadonlyMap<T, ReadonlySet<T>>[],
  destinationIsRelevant: (destination: T) => boolean = () => true,
): ReadonlySet<T> {
  const closed = new Set(candidates);
  const predecessors = new Map<T, Set<T>>();
  const rejected: T[] = [];
  for (const source of candidates) {
    for (const dependencies of dependencyMaps) {
      for (const destination of dependencies.get(source) ?? []) {
        if (!destinationIsRelevant(destination)) {
          continue;
        }
        if (!closed.has(destination)) {
          rejected.push(source);
          continue;
        }
        const existing = predecessors.get(destination);
        if (existing === undefined) {
          predecessors.set(destination, new Set([source]));
        } else {
          existing.add(source);
        }
      }
    }
  }
  while (rejected.length !== 0) {
    const declaration = rejected.pop();
    if (declaration === undefined || !closed.delete(declaration)) {
      continue;
    }
    for (const predecessor of predecessors.get(declaration) ?? []) {
      rejected.push(predecessor);
    }
  }
  return closed;
}
