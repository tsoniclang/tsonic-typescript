import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceGraph,
  EffectProvenanceOrigin,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "./model.js";

export interface ExactProvenanceValueSet<Value> {
  readonly count: number;
  values(): Iterable<Value>;
}

export type EffectProvenanceOriginSelector<Value> = (
  origin: EffectProvenanceOrigin,
) => Value | undefined;

export interface EffectProvenanceOriginIndex<Value> {
  readonly work: number;
  selectionFor(
    vertex: EffectProvenanceVertex,
    originClass: number,
  ): ExactProvenanceValueSet<Value>;
}

interface OriginClassState<Value> {
  readonly indexes: ReadonlyMap<Value, number>;
  readonly values: readonly Value[];
  readonly sets: PersistentIndexSets<Value>;
  readonly direct: Map<number, IndexTrieNode>;
  readonly propagated: Map<number, IndexTrieNode>;
}

interface IndexTrieNode {
  readonly id: number;
  readonly count: number;
  readonly left?: IndexTrieNode;
  readonly right?: IndexTrieNode;
  readonly value?: number;
}

const emptyValueSet: ExactProvenanceValueSet<never> = Object.freeze({
  count: 0,
  values(): Iterable<never> {
    return Object.freeze([]);
  },
});

export function selectOriginOccurrences(
  selected: ReadonlySet<Node>,
): EffectProvenanceOriginSelector<Node> {
  return (origin) => selected.has(origin.occurrence)
    ? origin.occurrence
    : undefined;
}

export function createEffectProvenanceOriginIndex<
  Reason extends string,
  Value,
>(
  graph: EffectProvenanceGraph<Reason>,
  resolutions: EffectProvenanceResolutionIndex<Reason>,
  originClasses: readonly EffectProvenanceOriginSelector<Value>[],
): EffectProvenanceOriginIndex<Value> {
  if (originClasses.length === 0) {
    throw new Error("effect provenance origin index requires an origin class");
  }
  const componentCount = resolutions.componentCount;
  const classes = originClasses.map((select): OriginClassState<Value> => {
    const values: Value[] = [];
    const indexes = new Map<Value, number>();
    for (const origin of graph.origins) {
      const selected = select(origin);
      if (selected !== undefined) {
        appendOriginIndex(indexes, values, selected);
      }
    }
    return {
      indexes,
      values,
      sets: createPersistentIndexSets(values.length),
      direct: new Map(),
      propagated: new Map(),
    };
  });
  const dependencies = new Map<number, Set<number>>();
  const dependents = new Map<number, Set<number>>();
  let work = graph.vertices.length;
  resolutions.forEachComponentDependency((destination, source) => {
    if (appendComponent(dependencies, destination, source)) {
      appendComponent(dependents, source, destination);
    }
    work += 1;
  });

  for (const origin of graph.origins) {
    const component = resolutions.componentFor(origin.vertex);
    for (let index = 0; index < classes.length; index += 1) {
      const state = classes[index];
      const selectedValue = originClasses[index]?.(origin);
      const selected = selectedValue === undefined
        ? undefined
        : state?.indexes.get(selectedValue);
      if (state !== undefined && selected !== undefined) {
        const direct = state.sets.union(
          state.direct.get(component),
          state.sets.singleton(selected),
        );
        if (direct !== undefined) {
          state.direct.set(component, direct);
        }
      }
    }
    work += 1;
  }

  const remainingDependencies = new Uint32Array(componentCount);
  const pending = new Uint32Array(componentCount);
  let pendingCount = 0;
  for (let component = 0; component < componentCount; component += 1) {
    const remaining = componentsFor(dependencies, component).size;
    remainingDependencies[component] = remaining;
    if (remaining === 0) {
      pending[pendingCount] = component;
      pendingCount += 1;
    }
  }
  let resolvedCount = 0;
  while (pendingCount !== 0) {
    pendingCount -= 1;
    const component = requiredIndex(pending, pendingCount);
    resolvedCount += 1;
    for (const state of classes) {
      let selected = state.direct.get(component);
      for (const dependency of componentsFor(dependencies, component)) {
        selected = state.sets.union(
          selected,
          state.propagated.get(dependency),
        );
      }
      if (selected !== undefined) {
        state.propagated.set(component, selected);
      }
    }
    for (const dependent of componentsFor(dependents, component)) {
      const remaining = requiredIndex(remainingDependencies, dependent);
      if (remaining === 0) {
        throw new Error("effect provenance origin dependency count underflowed");
      }
      remainingDependencies[dependent] = remaining - 1;
      if (remaining === 1) {
        pending[pendingCount] = dependent;
        pendingCount += 1;
      }
    }
    work += 1;
  }
  if (resolvedCount !== componentCount) {
    throw new Error("effect provenance origin component graph remained cyclic");
  }

  return Object.freeze({
    get work(): number {
      return work + classes.reduce((sum, state) => sum + state.sets.work, 0);
    },
    selectionFor(
      vertex: EffectProvenanceVertex,
      originClass: number,
    ): ExactProvenanceValueSet<Value> {
      if (graph.vertices[vertex.index] !== vertex) {
        throw new Error("effect provenance origin index received a foreign vertex");
      }
      const state = classes[originClass];
      if (state === undefined) {
        throw new Error("effect provenance origin class is invalid");
      }
      const component = resolutions.componentFor(vertex);
      return state.sets.valueSet(state.propagated.get(component), state.values);
    },
  });
}

interface PersistentIndexSets<Value> {
  readonly work: number;
  singleton(value: number): IndexTrieNode;
  union(
    left: IndexTrieNode | undefined,
    right: IndexTrieNode | undefined,
  ): IndexTrieNode | undefined;
  valueSet(
    root: IndexTrieNode | undefined,
    values: readonly Value[],
  ): ExactProvenanceValueSet<Value>;
}

function createPersistentIndexSets<Value>(
  valueCount: number,
): PersistentIndexSets<Value> {
  const bitDepth = Math.max(1, Math.ceil(Math.log2(Math.max(2, valueCount))));
  const branches = Array.from(
    { length: bitDepth },
    (): Map<string, IndexTrieNode> => new Map(),
  );
  const leaves = new Map<number, IndexTrieNode>();
  const singletons = new Map<number, IndexTrieNode>();
  const unions = new Map<string, IndexTrieNode>();
  const valueSets = new Map<number, ExactProvenanceValueSet<Value>>();
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
    valueSet(
      root: IndexTrieNode | undefined,
      values: readonly Value[],
    ): ExactProvenanceValueSet<Value> {
      if (root === undefined) {
        return emptyValueSet;
      }
      let selected = valueSets.get(root.id);
      if (selected === undefined) {
        selected = Object.freeze({
          count: root.count,
          values(): Iterable<Value> {
            return trieValues(root, values);
          },
        });
        valueSets.set(root.id, selected);
      }
      return selected;
    },
  });
}

function *trieValues<Value>(
  root: IndexTrieNode,
  values: readonly Value[],
): IterableIterator<Value> {
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

function appendOriginIndex<Value>(
  indexes: Map<Value, number>,
  values: Value[],
  occurrence: Value,
): void {
  if (indexes.has(occurrence)) {
    return;
  }
  indexes.set(occurrence, values.length);
  values.push(occurrence);
}

function appendComponent(
  values: Map<number, Set<number>>,
  component: number,
  selected: number,
): boolean {
  let entries = values.get(component);
  if (entries === undefined) {
    entries = new Set();
    values.set(component, entries);
  }
  const previousSize = entries.size;
  entries.add(selected);
  return entries.size !== previousSize;
}

const noComponents: ReadonlySet<number> = Object.freeze(new Set<number>());

function componentsFor(
  values: ReadonlyMap<number, ReadonlySet<number>>,
  component: number,
): ReadonlySet<number> {
  return values.get(component) ?? noComponents;
}

function requiredIndex(values: Uint32Array, index: number): number {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance origin component index is missing");
  }
  return selected;
}
