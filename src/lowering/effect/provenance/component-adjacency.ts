export interface EffectProvenanceComponentAdjacency {
  readonly dependencies: Uint32Array;
  readonly dependencyOffsets: Uint32Array;
  readonly dependents: Uint32Array;
  readonly dependentOffsets: Uint32Array;
}

export type EffectProvenanceComponentEdgeSource = (
  consume: (destination: number, source: number) => void,
) => void;

export function createEffectProvenanceComponentAdjacency(
  componentCount: number,
  edges: EffectProvenanceComponentEdgeSource,
): EffectProvenanceComponentAdjacency {
  if (!Number.isSafeInteger(componentCount) || componentCount < 0) {
    throw new Error("effect provenance component count is invalid");
  }
  const dependencyCounts = new Uint32Array(componentCount);
  edges((destination, source) => {
    assertComponent(destination, componentCount);
    assertComponent(source, componentCount);
    increment(dependencyCounts, destination);
  });
  const rawDependencyOffsets = offsetsFor(dependencyCounts);
  const rawDependencies = new Uint32Array(
    requiredIndex(rawDependencyOffsets, componentCount),
  );
  dependencyCounts.fill(0);
  edges((destination, source) => {
    assertComponent(destination, componentCount);
    assertComponent(source, componentCount);
    const offset = requiredIndex(rawDependencyOffsets, destination) +
      requiredIndex(dependencyCounts, destination);
    if (offset >= requiredIndex(rawDependencyOffsets, destination + 1)) {
      throw new Error("effect provenance component edge source changed");
    }
    rawDependencies[offset] = source;
    increment(dependencyCounts, destination);
  });
  for (let component = 0; component < componentCount; component += 1) {
    const expected = requiredIndex(rawDependencyOffsets, component + 1) -
      requiredIndex(rawDependencyOffsets, component);
    if (requiredIndex(dependencyCounts, component) !== expected) {
      throw new Error("effect provenance component edge source changed");
    }
  }
  const uniqueCounts = new Uint32Array(componentCount);
  for (let component = 0; component < componentCount; component += 1) {
    const start = requiredIndex(rawDependencyOffsets, component);
    const end = requiredIndex(rawDependencyOffsets, component + 1);
    const selected = rawDependencies.subarray(start, end);
    selected.sort();
    uniqueCounts[component] = compactSorted(selected);
  }
  const dependencyOffsets = offsetsFor(uniqueCounts);
  const dependencies = new Uint32Array(
    requiredIndex(dependencyOffsets, componentCount),
  );
  for (let component = 0; component < componentCount; component += 1) {
    const rawStart = requiredIndex(rawDependencyOffsets, component);
    const count = requiredIndex(uniqueCounts, component);
    dependencies.set(
      rawDependencies.subarray(rawStart, rawStart + count),
      requiredIndex(dependencyOffsets, component),
    );
  }
  const dependentCounts = new Uint32Array(componentCount);
  for (const source of dependencies) {
    increment(dependentCounts, source);
  }
  const dependentOffsets = offsetsFor(dependentCounts);
  const dependents = new Uint32Array(
    requiredIndex(dependentOffsets, componentCount),
  );
  dependentCounts.fill(0);
  for (let destination = 0; destination < componentCount; destination += 1) {
    const start = requiredIndex(dependencyOffsets, destination);
    const end = requiredIndex(dependencyOffsets, destination + 1);
    for (let edge = start; edge < end; edge += 1) {
      const source = requiredIndex(dependencies, edge);
      const offset = requiredIndex(dependentOffsets, source) +
        requiredIndex(dependentCounts, source);
      dependents[offset] = destination;
      increment(dependentCounts, source);
    }
  }
  return Object.freeze({
    dependencies,
    dependencyOffsets,
    dependents,
    dependentOffsets,
  });
}

function compactSorted(values: Uint32Array): number {
  let count = 0;
  let previous: number | undefined;
  for (const value of values) {
    if (value === previous) {
      continue;
    }
    values[count] = value;
    count += 1;
    previous = value;
  }
  return count;
}

function offsetsFor(counts: Uint32Array): Uint32Array {
  const offsets = new Uint32Array(counts.length + 1);
  let next = 0;
  for (let index = 0; index < counts.length; index += 1) {
    offsets[index] = next;
    next += requiredIndex(counts, index);
    if (!Number.isSafeInteger(next) || next > 0xffff_ffff) {
      throw new Error("effect provenance component edge count overflowed");
    }
  }
  offsets[counts.length] = next;
  return offsets;
}

function assertComponent(component: number, count: number): void {
  if (!Number.isSafeInteger(component) || component < 0 || component >= count) {
    throw new Error("effect provenance component edge is outside its graph");
  }
}

function increment(values: Uint32Array, index: number): void {
  const current = values[index];
  if (current === undefined || current === 0xffff_ffff) {
    throw new Error("effect provenance component adjacency count overflowed");
  }
  values[index] = current + 1;
}

function requiredIndex(
  values: Uint32Array,
  index: number,
): number {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance component adjacency index is missing");
  }
  return selected;
}

export { requiredIndex as requiredComponentIndex };
