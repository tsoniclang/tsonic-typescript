import type {
  EffectProvenanceEdge,
  EffectProvenanceVertex,
} from "./model.js";

export interface EffectProvenanceComponents {
  readonly componentCount: number;
  readonly work: number;
  componentFor(vertex: EffectProvenanceVertex): number;
}

interface ProvenanceAdjacency {
  readonly dependencies: Uint32Array;
  readonly dependencyOffsets: Uint32Array;
  readonly dependents: Uint32Array;
  readonly dependentOffsets: Uint32Array;
}

export function condenseEffectProvenance(
  vertices: readonly EffectProvenanceVertex[],
  edges: readonly EffectProvenanceEdge[],
): EffectProvenanceComponents {
  const adjacency = createAdjacency(vertices.length, edges);
  const visited = new Uint8Array(vertices.length);
  const order = new Uint32Array(vertices.length);
  const stackVertices = new Uint32Array(vertices.length);
  const stackOffsets = new Uint32Array(vertices.length);
  let orderLength = 0;
  let work = 0;
  for (let root = 0; root < vertices.length; root += 1) {
    if (visited[root] === 1) {
      continue;
    }
    let depth = 0;
    stackVertices[0] = root;
    stackOffsets[0] = adjacency.dependencyOffsets[root] ?? 0;
    visited[root] = 1;
    while (depth >= 0) {
      const vertex = requiredIndex(stackVertices, depth);
      const next = requiredIndex(stackOffsets, depth);
      const end = requiredIndex(adjacency.dependencyOffsets, vertex + 1);
      if (next < end) {
        stackOffsets[depth] = next + 1;
        const dependency = requiredIndex(adjacency.dependencies, next);
        work += 1;
        if (visited[dependency] === 0) {
          visited[dependency] = 1;
          depth += 1;
          stackVertices[depth] = dependency;
          stackOffsets[depth] = requiredIndex(
            adjacency.dependencyOffsets,
            dependency,
          );
        }
        continue;
      }
      order[orderLength] = vertex;
      orderLength += 1;
      depth -= 1;
    }
  }
  if (orderLength !== vertices.length) {
    throw new Error("effect provenance SCC did not order every vertex");
  }

  const assigned = new Uint8Array(vertices.length);
  const componentForVertex = new Uint32Array(vertices.length);
  const pending = new Uint32Array(vertices.length);
  let componentCount = 0;
  for (let index = orderLength - 1; index >= 0; index -= 1) {
    const root = requiredIndex(order, index);
    if (assigned[root] === 1) {
      continue;
    }
    let pendingCount = 1;
    pending[0] = root;
    assigned[root] = 1;
    while (pendingCount !== 0) {
      pendingCount -= 1;
      const current = requiredIndex(pending, pendingCount);
      componentForVertex[current] = componentCount;
      work += 1;
      const start = requiredIndex(adjacency.dependentOffsets, current);
      const end = requiredIndex(adjacency.dependentOffsets, current + 1);
      for (let edge = start; edge < end; edge += 1) {
        const dependent = requiredIndex(adjacency.dependents, edge);
        work += 1;
        if (assigned[dependent] === 0) {
          assigned[dependent] = 1;
          pending[pendingCount] = dependent;
          pendingCount += 1;
        }
      }
    }
    componentCount += 1;
  }
  return Object.freeze({
    componentCount,
    work,
    componentFor(vertex: EffectProvenanceVertex): number {
      if (vertices[vertex.index] !== vertex) {
        throw new Error("effect provenance SCC received a foreign vertex");
      }
      return requiredIndex(componentForVertex, vertex.index);
    },
  });
}

function createAdjacency(
  vertexCount: number,
  edges: readonly EffectProvenanceEdge[],
): ProvenanceAdjacency {
  const dependencyCounts = new Uint32Array(vertexCount);
  const dependentCounts = new Uint32Array(vertexCount);
  for (const edge of edges) {
    increment(dependencyCounts, edge.destination.index);
    increment(dependentCounts, edge.source.index);
  }
  const dependencyOffsets = offsetsFor(dependencyCounts);
  const dependentOffsets = offsetsFor(dependentCounts);
  dependencyCounts.fill(0);
  dependentCounts.fill(0);
  const dependencies = new Uint32Array(edges.length);
  const dependents = new Uint32Array(edges.length);
  for (const edge of edges) {
    const dependencyIndex = requiredIndex(
      dependencyOffsets,
      edge.destination.index,
    ) + requiredIndex(dependencyCounts, edge.destination.index);
    dependencies[dependencyIndex] = edge.source.index;
    increment(dependencyCounts, edge.destination.index);
    const dependentIndex = requiredIndex(
      dependentOffsets,
      edge.source.index,
    ) + requiredIndex(dependentCounts, edge.source.index);
    dependents[dependentIndex] = edge.destination.index;
    increment(dependentCounts, edge.source.index);
  }
  return { dependencies, dependencyOffsets, dependents, dependentOffsets };
}

function offsetsFor(counts: Uint32Array): Uint32Array {
  const offsets = new Uint32Array(counts.length + 1);
  let next = 0;
  for (let index = 0; index < counts.length; index += 1) {
    offsets[index] = next;
    next += requiredIndex(counts, index);
  }
  offsets[counts.length] = next;
  return offsets;
}

function increment(values: Uint32Array, index: number): void {
  const current = values[index];
  if (current === undefined || current === 0xffff_ffff) {
    throw new Error("effect provenance adjacency count overflowed");
  }
  values[index] = current + 1;
}

function requiredIndex(values: Uint32Array, index: number): number {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance adjacency index is missing");
  }
  return selected;
}
