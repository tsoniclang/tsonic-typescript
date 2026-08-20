import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceBoundary,
  EffectProvenanceGraph,
  EffectProvenanceOrigin,
  EffectProvenanceResolution,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "./model.js";
import { condenseEffectProvenance } from "./scc.js";

const noEvidence: readonly never[] = Object.freeze([]);

export function resolveEffectProvenance<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
): EffectProvenanceResolutionIndex<Reason> {
  const condensation = condenseEffectProvenance(graph.vertices, graph.edges);
  const componentCount = condensation.components.length;
  const dependencies = emptySets(componentCount);
  const dependents = emptySets(componentCount);
  const directOrigins = emptyLists<EffectProvenanceOrigin>(componentCount);
  const directBoundaries = emptyLists<EffectProvenanceBoundary<Reason>>(
    componentCount,
  );
  const hasOrigin = new Uint8Array(componentCount);
  const hasBoundary = new Uint8Array(componentCount);
  let work = condensation.work;

  for (const edge of graph.edges) {
    const source = componentFor(condensation.componentForVertex, edge.source);
    const destination = componentFor(
      condensation.componentForVertex,
      edge.destination,
    );
    if (
      source !== destination &&
      requiredSet(dependencies, destination).add(source)
    ) {
      requiredSet(dependents, source).add(destination);
      work += 1;
    }
  }
  for (const origin of graph.origins) {
    const component = componentFor(
      condensation.componentForVertex,
      origin.vertex,
    );
    requiredMutableList(directOrigins, component).push(origin);
    hasOrigin[component] = 1;
  }
  for (const boundary of graph.boundaries) {
    const component = componentFor(
      condensation.componentForVertex,
      boundary.vertex,
    );
    requiredMutableList(directBoundaries, component).push(boundary);
    hasBoundary[component] = 1;
  }

  const remainingDependencies = new Uint32Array(componentCount);
  const pending: number[] = [];
  for (let component = 0; component < componentCount; component += 1) {
    const remaining = requiredSet(dependencies, component).size;
    remainingDependencies[component] = remaining;
    if (remaining === 0) {
      pending.push(component);
    }
  }
  let resolvedCount = 0;
  while (pending.length !== 0) {
    const component = pending.pop();
    if (component === undefined) {
      continue;
    }
    resolvedCount += 1;
    work += 1;
    for (const dependent of requiredSet(dependents, component)) {
      if (hasOrigin[component] === 1) {
        hasOrigin[dependent] = 1;
      }
      if (hasBoundary[component] === 1) {
        hasBoundary[dependent] = 1;
      }
      const remaining = remainingDependencies[dependent];
      if (remaining === undefined || remaining === 0) {
        throw new Error("effect provenance dependency count underflowed");
      }
      remainingDependencies[dependent] = remaining - 1;
      if (remaining === 1) {
        pending.push(dependent);
      }
    }
  }
  if (resolvedCount !== componentCount) {
    throw new Error("effect provenance component graph remained cyclic");
  }

  const sealedOrigins = Object.freeze(
    directOrigins.map((selected) => Object.freeze(selected)),
  );
  const sealedBoundaries = Object.freeze(
    directBoundaries.map((selected) => Object.freeze(selected)),
  );
  const originEvidence = new Array<
    readonly EffectProvenanceOrigin[] | undefined
  >(componentCount);
  const boundaryEvidence = new Array<
    readonly EffectProvenanceBoundary<Reason>[] | undefined
  >(componentCount);
  const originOccurrences = new WeakMap<object, readonly Node[]>();
  const dependencyLists = new Array<readonly number[] | undefined>(
    componentCount,
  );
  const resolutions = new Array<
    EffectProvenanceResolution<Reason> | undefined
  >(graph.vertices.length);
  const componentForVertex = condensation.componentForVertex;
  const vertices = graph.vertices;
  const dependenciesFor = (component: number): readonly number[] => {
    let selected = dependencyLists[component];
    if (selected === undefined) {
      selected = Object.freeze([...requiredSet(dependencies, component)]);
      dependencyLists[component] = selected;
    }
    return selected;
  };

  const originsFor = (component: number): readonly Node[] => {
    const evidence = evidenceFor(
      component,
      componentCount,
      dependenciesFor,
      sealedOrigins,
      originEvidence,
    );
    let occurrences = originOccurrences.get(evidence as object);
    if (occurrences === undefined) {
      occurrences = Object.freeze(evidence.map((origin) => origin.occurrence));
      originOccurrences.set(evidence as object, occurrences);
    }
    return occurrences;
  };
  const boundariesFor = (
    component: number,
  ): readonly EffectProvenanceBoundary<Reason>[] => evidenceFor(
    component,
    componentCount,
    dependenciesFor,
    sealedBoundaries,
    boundaryEvidence,
  );

  return Object.freeze({
    componentCount,
    edgeCount: graph.edges.length,
    work,
    resolutionFor(vertex: EffectProvenanceVertex) {
      if (vertices[vertex.index] !== vertex) {
        throw new Error("effect provenance resolution received foreign vertex");
      }
      let resolution = resolutions[vertex.index];
      if (resolution === undefined) {
        const component = componentFor(componentForVertex, vertex);
        resolution = Object.freeze({
          vertex,
          component,
          closed: hasOrigin[component] === 1 && hasBoundary[component] === 0,
          originless: hasOrigin[component] === 0,
          get origins(): readonly Node[] {
            return originsFor(component);
          },
          get originEvidence(): readonly EffectProvenanceOrigin[] {
            return evidenceFor(
              component,
              componentCount,
              dependenciesFor,
              sealedOrigins,
              originEvidence,
            );
          },
          get boundaries(): readonly EffectProvenanceBoundary<Reason>[] {
            return boundariesFor(component);
          },
        });
        resolutions[vertex.index] = resolution;
      }
      return resolution;
    },
  });
}

function evidenceFor<Evidence>(
  root: number,
  componentCount: number,
  dependenciesFor: (component: number) => readonly number[],
  directEvidence: readonly (readonly Evidence[])[],
  cache: Array<readonly Evidence[] | undefined>,
): readonly Evidence[] {
  const existing = cache[root];
  if (existing !== undefined) {
    return existing;
  }
  const visiting = new Uint8Array(componentCount);
  const pending: Array<{ readonly component: number; next: number }> = [
    { component: root, next: 0 },
  ];
  visiting[root] = 1;
  while (pending.length !== 0) {
    const frame = pending[pending.length - 1];
    if (frame === undefined) {
      throw new Error("effect provenance evidence traversal lost its frame");
    }
    const selectedDependencies = dependenciesFor(frame.component);
    const dependency = selectedDependencies[frame.next];
    if (dependency !== undefined) {
      pending[pending.length - 1] = {
        component: frame.component,
        next: frame.next + 1,
      };
      if (cache[dependency] === undefined) {
        if (visiting[dependency] === 1) {
          throw new Error("effect provenance component evidence remained cyclic");
        }
        visiting[dependency] = 1;
        pending.push({ component: dependency, next: 0 });
      }
      continue;
    }
    cache[frame.component] = mergeEvidence(
      requiredList(directEvidence, frame.component),
      selectedDependencies.map((selected) => {
        const evidence = cache[selected];
        if (evidence === undefined) {
          throw new Error("effect provenance dependency evidence is missing");
        }
        return evidence;
      }),
    );
    visiting[frame.component] = 0;
    pending.pop();
  }
  const resolved = cache[root];
  if (resolved === undefined) {
    throw new Error("effect provenance evidence was not resolved");
  }
  return resolved;
}

function mergeEvidence<Evidence>(
  direct: readonly Evidence[],
  dependencies: readonly (readonly Evidence[])[],
): readonly Evidence[] {
  if (direct.length === 0) {
    const nonempty = dependencies.filter((selected) => selected.length !== 0);
    if (nonempty.length === 0) {
      return noEvidence;
    }
    if (nonempty.every((selected) => selected === nonempty[0])) {
      return nonempty[0]!;
    }
  } else if (dependencies.every((selected) => selected.length === 0)) {
    return direct;
  }
  return Object.freeze([
    ...new Set([
      ...direct,
      ...dependencies.flatMap((selected) => selected),
    ]),
  ]);
}

function emptySets(length: number): Array<Set<number>> {
  return Array.from({ length }, () => new Set<number>());
}

function emptyLists<Value>(length: number): Value[][] {
  return Array.from({ length }, (): Value[] => []);
}

function componentFor(
  components: readonly number[],
  vertex: EffectProvenanceVertex,
): number {
  const component = components[vertex.index];
  if (component === undefined) {
    throw new Error("effect provenance vertex has no component");
  }
  return component;
}

function requiredSet(
  values: readonly Set<number>[],
  index: number,
): Set<number> {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance component set is missing");
  }
  return selected;
}

function requiredList<Value>(
  values: readonly (readonly Value[])[],
  index: number,
): readonly Value[] {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance component list is missing");
  }
  return selected;
}

function requiredMutableList<Value>(
  values: Value[][],
  index: number,
): Value[] {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance component list is missing");
  }
  return selected;
}
