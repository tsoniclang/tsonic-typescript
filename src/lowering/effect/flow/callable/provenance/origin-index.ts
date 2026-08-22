import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceGraph,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "../../../provenance/model.js";
import type { ExactCallableNodeSet } from "../value-resolution.js";

export interface CallableOriginSelection {
  readonly candidates: ExactCallableNodeSet;
  readonly synchronous: ExactCallableNodeSet;
}

export interface CallableOriginIndex {
  readonly work: number;
  selectionFor(vertex: EffectProvenanceVertex): CallableOriginSelection;
}

interface IndexTrieNode {
  readonly id: number;
  readonly count: number;
  readonly left?: IndexTrieNode;
  readonly right?: IndexTrieNode;
  readonly value?: number;
}

const emptyNodeSet: ExactCallableNodeSet = Object.freeze({
  count: 0,
  nodes(): Iterable<Node> {
    return Object.freeze([]);
  },
});

export function createCallableOriginIndex<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
  resolutions: EffectProvenanceResolutionIndex<Reason>,
  candidateOrigins: ReadonlySet<Node>,
  synchronousOrigins: ReadonlySet<Node>,
): CallableOriginIndex {
  const candidateValues: Node[] = [];
  const synchronousValues: Node[] = [];
  const candidateIndexes = new Map<Node, number>();
  const synchronousIndexes = new Map<Node, number>();
  for (const origin of graph.origins) {
    if (candidateOrigins.has(origin.occurrence)) {
      appendOriginIndex(candidateIndexes, candidateValues, origin.occurrence);
    } else if (synchronousOrigins.has(origin.occurrence)) {
      appendOriginIndex(
        synchronousIndexes,
        synchronousValues,
        origin.occurrence,
      );
    }
  }

  const candidateSets = createPersistentIndexSets(candidateValues.length);
  const synchronousSets = createPersistentIndexSets(synchronousValues.length);
  const componentCount = resolutions.componentCount;
  const componentForVertex = graph.vertices.map((vertex) =>
    resolutions.resolutionFor(vertex).component
  );
  const dependencies = emptyComponentSets(componentCount);
  const dependents = emptyComponentSets(componentCount);
  let work = graph.vertices.length;
  resolutions.forEachComponentDependency((destination, source) => {
    if (requiredComponentSet(dependencies, destination).add(source)) {
      requiredComponentSet(dependents, source).add(destination);
    }
    work += 1;
  });

  const directCandidates = new Array<IndexTrieNode | undefined>(componentCount);
  const directSynchronous = new Array<IndexTrieNode | undefined>(componentCount);
  for (const origin of graph.origins) {
    const component = requiredComponent(componentForVertex, origin.vertex);
    const candidate = candidateIndexes.get(origin.occurrence);
    if (candidate !== undefined) {
      directCandidates[component] = candidateSets.union(
        directCandidates[component],
        candidateSets.singleton(candidate),
      );
    }
    const synchronous = synchronousIndexes.get(origin.occurrence);
    if (synchronous !== undefined) {
      directSynchronous[component] = synchronousSets.union(
        directSynchronous[component],
        synchronousSets.singleton(synchronous),
      );
    }
    work += 1;
  }

  const candidatesByComponent = new Array<IndexTrieNode | undefined>(
    componentCount,
  );
  const synchronousByComponent = new Array<IndexTrieNode | undefined>(
    componentCount,
  );
  const remainingDependencies = new Uint32Array(componentCount);
  const pending: number[] = [];
  for (let component = 0; component < componentCount; component += 1) {
    const remaining = requiredComponentSet(dependencies, component).size;
    remainingDependencies[component] = remaining;
    if (remaining === 0) {
      pending.push(component);
    }
  }
  let nextPending = 0;
  while (nextPending < pending.length) {
    const component = pending[nextPending];
    nextPending += 1;
    if (component === undefined) {
      throw new Error("callable origin propagation lost a component");
    }
    let candidates = directCandidates[component];
    let synchronous = directSynchronous[component];
    for (const dependency of requiredComponentSet(dependencies, component)) {
      candidates = candidateSets.union(
        candidates,
        candidatesByComponent[dependency],
      );
      synchronous = synchronousSets.union(
        synchronous,
        synchronousByComponent[dependency],
      );
      work += 1;
    }
    candidatesByComponent[component] = candidates;
    synchronousByComponent[component] = synchronous;
    for (const dependent of requiredComponentSet(dependents, component)) {
      const remaining = remainingDependencies[dependent];
      if (remaining === undefined || remaining === 0) {
        throw new Error("callable origin dependency count underflowed");
      }
      remainingDependencies[dependent] = remaining - 1;
      if (remaining === 1) {
        pending.push(dependent);
      }
    }
    work += 1;
  }
  if (pending.length !== componentCount) {
    throw new Error("callable origin component graph remained cyclic");
  }

  const selections = new Array<CallableOriginSelection | undefined>(
    componentCount,
  );
  return Object.freeze({
    get work(): number {
      return work + candidateSets.work + synchronousSets.work;
    },
    selectionFor(vertex: EffectProvenanceVertex): CallableOriginSelection {
      if (graph.vertices[vertex.index] !== vertex) {
        throw new Error("callable origin index received a foreign vertex");
      }
      const component = requiredComponent(componentForVertex, vertex);
      let selection = selections[component];
      if (selection === undefined) {
        selection = Object.freeze({
          candidates: candidateSets.nodeSet(
            candidatesByComponent[component],
            candidateValues,
          ),
          synchronous: synchronousSets.nodeSet(
            synchronousByComponent[component],
            synchronousValues,
          ),
        });
        selections[component] = selection;
      }
      return selection;
    },
  });
}

interface PersistentIndexSets {
  readonly work: number;
  singleton(value: number): IndexTrieNode;
  union(
    left: IndexTrieNode | undefined,
    right: IndexTrieNode | undefined,
  ): IndexTrieNode | undefined;
  nodeSet(
    root: IndexTrieNode | undefined,
    values: readonly Node[],
  ): ExactCallableNodeSet;
}

function createPersistentIndexSets(valueCount: number): PersistentIndexSets {
  const bitDepth = Math.max(1, Math.ceil(Math.log2(Math.max(2, valueCount))));
  const branches = Array.from(
    { length: bitDepth },
    (): Map<string, IndexTrieNode> => new Map(),
  );
  const leaves = new Map<number, IndexTrieNode>();
  const singletons = new Map<number, IndexTrieNode>();
  const unions = new Map<string, IndexTrieNode>();
  const nodeSets = new Map<number, ExactCallableNodeSet>();
  let nextId = 1;
  let work = 0;

  const branch = (
    depth: number,
    left: IndexTrieNode | undefined,
    right: IndexTrieNode | undefined,
  ): IndexTrieNode => {
    const table = branches[depth];
    if (table === undefined) {
      throw new Error("persistent origin set branch depth is invalid");
    }
    const key = `${left?.id ?? 0}:${right?.id ?? 0}`;
    let selected = table.get(key);
    if (selected === undefined) {
      selected = Object.freeze({
        id: nextId,
        count: (left?.count ?? 0) + (right?.count ?? 0),
        ...(left === undefined ? {} : { left }),
        ...(right === undefined ? {} : { right }),
      });
      nextId += 1;
      table.set(key, selected);
    }
    work += 1;
    return selected;
  };

  const singleton = (value: number): IndexTrieNode => {
    const existing = singletons.get(value);
    if (existing !== undefined) {
      return existing;
    }
    let selected = leaves.get(value);
    if (selected === undefined) {
      selected = Object.freeze({ id: nextId, count: 1, value });
      nextId += 1;
      leaves.set(value, selected);
    }
    for (let depth = bitDepth - 1; depth >= 0; depth -= 1) {
      const bit = (value >>> (bitDepth - depth - 1)) & 1;
      selected = bit === 0
        ? branch(depth, selected, undefined)
        : branch(depth, undefined, selected);
    }
    singletons.set(value, selected);
    return selected;
  };

  const unionAt = (
    left: IndexTrieNode | undefined,
    right: IndexTrieNode | undefined,
    depth: number,
  ): IndexTrieNode | undefined => {
    if (left === undefined || right === undefined || left === right) {
      return left ?? right;
    }
    const first = left.id < right.id ? left : right;
    const second = left.id < right.id ? right : left;
    const key = `${first.id}:${second.id}`;
    const existing = unions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    if (depth === bitDepth) {
      throw new Error("persistent origin set contains conflicting leaf values");
    }
    const selected = branch(
      depth,
      unionAt(left.left, right.left, depth + 1),
      unionAt(left.right, right.right, depth + 1),
    );
    unions.set(key, selected);
    work += 1;
    return selected;
  };

  return Object.freeze({
    get work(): number {
      return work;
    },
    singleton,
    union(
      left: IndexTrieNode | undefined,
      right: IndexTrieNode | undefined,
    ): IndexTrieNode | undefined {
      return unionAt(left, right, 0);
    },
    nodeSet(
      root: IndexTrieNode | undefined,
      values: readonly Node[],
    ): ExactCallableNodeSet {
      if (root === undefined) {
        return emptyNodeSet;
      }
      let selected = nodeSets.get(root.id);
      if (selected === undefined) {
        selected = Object.freeze({
          count: root.count,
          nodes(): Iterable<Node> {
            return trieNodes(root, values);
          },
        });
        nodeSets.set(root.id, selected);
      }
      return selected;
    },
  });
}

function *trieNodes(
  root: IndexTrieNode,
  values: readonly Node[],
): IterableIterator<Node> {
  const pending = [root];
  while (pending.length !== 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    if (current.value !== undefined) {
      const selected = values[current.value];
      if (selected === undefined) {
        throw new Error("persistent origin set value is missing");
      }
      yield selected;
      continue;
    }
    if (current.right !== undefined) {
      pending.push(current.right);
    }
    if (current.left !== undefined) {
      pending.push(current.left);
    }
  }
}

function appendOriginIndex(
  indexes: Map<Node, number>,
  values: Node[],
  occurrence: Node,
): void {
  if (indexes.has(occurrence)) {
    return;
  }
  indexes.set(occurrence, values.length);
  values.push(occurrence);
}

function emptyComponentSets(length: number): Array<Set<number>> {
  return Array.from({ length }, (): Set<number> => new Set());
}

function requiredComponent(
  componentForVertex: readonly number[],
  vertex: EffectProvenanceVertex,
): number {
  const selected = componentForVertex[vertex.index];
  if (selected === undefined) {
    throw new Error("callable origin vertex has no component");
  }
  return selected;
}

function requiredComponentSet(
  values: readonly Set<number>[],
  component: number,
): Set<number> {
  const selected = values[component];
  if (selected === undefined) {
    throw new Error("callable origin component set is missing");
  }
  return selected;
}
