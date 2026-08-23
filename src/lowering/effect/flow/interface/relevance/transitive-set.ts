export interface TransitiveSetExpansion<Key, Value> {
  readonly values: readonly Value[];
  readonly dependencies: readonly Key[];
}

export interface TransitiveSetIndex<Key extends object, Value> {
  valuesFor(key: Key): readonly Value[];
}

interface PendingVertex<Key extends object, Value> {
  readonly key: Key;
  readonly values: readonly Value[];
  readonly dependencies: readonly number[];
  readonly settledDependencies: readonly (readonly Value[])[];
}

interface CondensedGraph {
  readonly componentCount: number;
  readonly componentForVertex: Uint32Array;
  readonly members: readonly (readonly number[])[];
}

const noValues = Object.freeze([]) as readonly never[];
const noIndexes = Object.freeze([]) as readonly number[];

export function createTransitiveSetIndex<Key extends object, Value>(
  expand: (key: Key) => TransitiveSetExpansion<Key, Value>,
): TransitiveSetIndex<Key, Value> {
  const settled = new WeakMap<Key, readonly Value[]>();
  return Object.freeze({
    valuesFor(key: Key): readonly Value[] {
      const existing = settled.get(key);
      if (existing !== undefined) {
        return existing;
      }
      settleReachableTypes(key, expand, settled);
      const result = settled.get(key);
      if (result === undefined) {
        throw new Error("interface relevance did not settle its requested type");
      }
      return result;
    },
  });
}

function settleReachableTypes<Key extends object, Value>(
  root: Key,
  expand: (key: Key) => TransitiveSetExpansion<Key, Value>,
  settled: WeakMap<Key, readonly Value[]>,
): void {
  const keys: Key[] = [];
  const indexForKey = new Map<Key, number>();
  const addKey = (key: Key): number => {
    const existing = indexForKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = keys.length;
    keys.push(key);
    indexForKey.set(key, index);
    return index;
  };
  addKey(root);

  const vertices: PendingVertex<Key, Value>[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = requiredValue(keys, index, "interface relevance key");
    const expansion = expand(key);
    const dependencies = new Set<number>();
    const settledDependencies: Array<readonly Value[]> = [];
    for (const dependency of expansion.dependencies) {
      const existing = settled.get(dependency);
      if (existing === undefined) {
        dependencies.add(addKey(dependency));
      } else {
        settledDependencies.push(existing);
      }
    }
    vertices.push({
      key,
      values: expansion.values,
      dependencies: dependencies.size === 0
        ? noIndexes
        : Object.freeze([...dependencies]),
      settledDependencies: Object.freeze(settledDependencies),
    });
  }

  const condensed = condense(vertices);
  settleComponents(vertices, condensed, settled);
}

function condense<Key extends object, Value>(
  vertices: readonly PendingVertex<Key, Value>[],
): CondensedGraph {
  const reverse = Array.from(
    { length: vertices.length },
    (): number[] => [],
  );
  for (let vertex = 0; vertex < vertices.length; vertex += 1) {
    for (const dependency of requiredVertex(vertices, vertex).dependencies) {
      requiredValue(reverse, dependency, "interface relevance reverse row").push(
        vertex,
      );
    }
  }

  const visited = new Uint8Array(vertices.length);
  const order: number[] = [];
  for (let root = 0; root < vertices.length; root += 1) {
    if (visited[root] === 1) {
      continue;
    }
    const stackVertices = [root];
    const stackOffsets = [0];
    visited[root] = 1;
    while (stackVertices.length !== 0) {
      const frame = stackVertices.length - 1;
      const vertex = requiredValue(
        stackVertices,
        frame,
        "interface relevance DFS vertex",
      );
      const offset = requiredValue(
        stackOffsets,
        frame,
        "interface relevance DFS offset",
      );
      const dependencies = requiredVertex(vertices, vertex).dependencies;
      const dependency = dependencies[offset];
      if (dependency !== undefined) {
        stackOffsets[frame] = offset + 1;
        if (visited[dependency] === 0) {
          visited[dependency] = 1;
          stackVertices.push(dependency);
          stackOffsets.push(0);
        }
        continue;
      }
      order.push(vertex);
      stackVertices.pop();
      stackOffsets.pop();
    }
  }

  const componentForVertex = new Uint32Array(vertices.length);
  const assigned = new Uint8Array(vertices.length);
  const members: number[][] = [];
  for (let orderIndex = order.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const root = requiredValue(
      order,
      orderIndex,
      "interface relevance component root",
    );
    if (assigned[root] === 1) {
      continue;
    }
    const component = members.length;
    const selectedMembers: number[] = [];
    const pending = [root];
    assigned[root] = 1;
    while (pending.length !== 0) {
      const vertex = pending.pop();
      if (vertex === undefined) {
        throw new Error("interface relevance component stack underflowed");
      }
      componentForVertex[vertex] = component;
      selectedMembers.push(vertex);
      for (const dependent of requiredValue(
        reverse,
        vertex,
        "interface relevance reverse dependency",
      )) {
        if (assigned[dependent] === 0) {
          assigned[dependent] = 1;
          pending.push(dependent);
        }
      }
    }
    members.push(selectedMembers);
  }
  if (order.length !== vertices.length) {
    throw new Error("interface relevance SCC omitted a type");
  }
  return {
    componentCount: members.length,
    componentForVertex,
    members,
  };
}

function settleComponents<Key extends object, Value>(
  vertices: readonly PendingVertex<Key, Value>[],
  condensed: CondensedGraph,
  settled: WeakMap<Key, readonly Value[]>,
): void {
  const directValues = Array.from(
    { length: condensed.componentCount },
    (): Value[] => [],
  );
  const externalValues = Array.from(
    { length: condensed.componentCount },
    (): Array<readonly Value[]> => [],
  );
  const dependencies = Array.from(
    { length: condensed.componentCount },
    (): Set<number> => new Set(),
  );
  const dependents = Array.from(
    { length: condensed.componentCount },
    (): Set<number> => new Set(),
  );

  for (let vertex = 0; vertex < vertices.length; vertex += 1) {
    const selected = requiredVertex(vertices, vertex);
    const component = requiredIndex(condensed.componentForVertex, vertex);
    requiredValue(
      directValues,
      component,
      "interface relevance direct values",
    ).push(...selected.values);
    requiredValue(
      externalValues,
      component,
      "interface relevance settled dependencies",
    ).push(...selected.settledDependencies);
    for (const dependencyVertex of selected.dependencies) {
      const dependency = requiredIndex(
        condensed.componentForVertex,
        dependencyVertex,
      );
      if (dependency !== component) {
        requiredValue(
          dependencies,
          component,
          "interface relevance component dependencies",
        ).add(dependency);
        requiredValue(
          dependents,
          dependency,
          "interface relevance component dependents",
        ).add(component);
      }
    }
  }

  const remaining = new Uint32Array(condensed.componentCount);
  const pending: number[] = [];
  for (let component = 0; component < condensed.componentCount; component += 1) {
    const count = requiredValue(
      dependencies,
      component,
      "interface relevance dependency count",
    ).size;
    remaining[component] = count;
    if (count === 0) {
      pending.push(component);
    }
  }
  const results: Array<readonly Value[] | undefined> = Array.from(
    { length: condensed.componentCount },
    () => undefined,
  );
  let resolvedCount = 0;
  while (pending.length !== 0) {
    const component = pending.pop();
    if (component === undefined) {
      throw new Error("interface relevance component stack underflowed");
    }
    const inherited = requiredValue(
      externalValues,
      component,
      "interface relevance inherited values",
    );
    for (const dependency of requiredValue(
      dependencies,
      component,
      "interface relevance settled component dependencies",
    )) {
      const selected = results[dependency];
      if (selected === undefined) {
        throw new Error("interface relevance dependency was not settled");
      }
      inherited.push(selected);
    }
    const result = mergeValues(
      requiredValue(
        directValues,
        component,
        "interface relevance component values",
      ),
      inherited,
    );
    results[component] = result;
    for (const vertex of requiredValue(
      condensed.members,
      component,
      "interface relevance component members",
    )) {
      settled.set(requiredVertex(vertices, vertex).key, result);
    }
    resolvedCount += 1;
    for (const dependent of requiredValue(
      dependents,
      component,
      "interface relevance dependent components",
    )) {
      const count = requiredIndex(remaining, dependent);
      if (count === 0) {
        throw new Error("interface relevance dependency count underflowed");
      }
      remaining[dependent] = count - 1;
      if (count === 1) {
        pending.push(dependent);
      }
    }
  }
  if (resolvedCount !== condensed.componentCount) {
    throw new Error("interface relevance component graph remained cyclic");
  }
}

function mergeValues<Value>(
  direct: readonly Value[],
  dependencies: readonly (readonly Value[])[],
): readonly Value[] {
  const nonempty = dependencies.filter((selected) => selected.length !== 0);
  if (direct.length === 0) {
    if (nonempty.length === 0) {
      return noValues;
    }
    if (nonempty.every((selected) => selected === nonempty[0])) {
      return nonempty[0] ?? noValues;
    }
  }
  const values = new Set<Value>(direct);
  for (const dependency of nonempty) {
    for (const value of dependency) {
      values.add(value);
    }
  }
  return values.size === 0 ? noValues : Object.freeze([...values]);
}

function requiredVertex<Key extends object, Value>(
  vertices: readonly PendingVertex<Key, Value>[],
  index: number,
): PendingVertex<Key, Value> {
  return requiredValue(vertices, index, "interface relevance vertex");
}

function requiredValue<Value>(
  values: readonly Value[],
  index: number,
  subject: string,
): Value {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`${subject} is missing`);
  }
  return value;
}

function requiredIndex(values: Uint32Array, index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error("interface relevance typed-array index is missing");
  }
  return value;
}
