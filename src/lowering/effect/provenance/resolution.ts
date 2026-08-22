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
const noComponents: ReadonlySet<number> = Object.freeze(new Set<number>());

export function resolveEffectProvenance<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
): EffectProvenanceResolutionIndex<Reason> {
  const condensation = condenseEffectProvenance(graph.vertices, graph.edges);
  const componentCount = condensation.componentCount;
  const dependencies = new Map<number, Set<number>>();
  const dependents = new Map<number, Set<number>>();
  const directOrigins = new Map<number, EffectProvenanceOrigin[]>();
  const directBoundaries = new Map<
    number,
    EffectProvenanceBoundary<Reason>[]
  >();
  const hasOrigin = new Uint8Array(componentCount);
  const hasBoundary = new Uint8Array(componentCount);
  let work = condensation.work;

  for (const edge of graph.edges) {
    const source = condensation.componentFor(edge.source);
    const destination = condensation.componentFor(edge.destination);
    if (
      source !== destination &&
      appendComponent(dependencies, destination, source)
    ) {
      appendComponent(dependents, source, destination);
      work += 1;
    }
  }
  for (const origin of graph.origins) {
    const component = condensation.componentFor(origin.vertex);
    appendEvidence(directOrigins, component, origin);
    hasOrigin[component] = 1;
  }
  for (const boundary of graph.boundaries) {
    const component = condensation.componentFor(boundary.vertex);
    appendEvidence(directBoundaries, component, boundary);
    hasBoundary[component] = 1;
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
    work += 1;
    for (const dependent of componentsFor(dependents, component)) {
      if (hasOrigin[component] === 1) {
        hasOrigin[dependent] = 1;
      }
      if (hasBoundary[component] === 1) {
        hasBoundary[dependent] = 1;
      }
      const remaining = requiredIndex(remainingDependencies, dependent);
      if (remaining === 0) {
        throw new Error("effect provenance dependency count underflowed");
      }
      remainingDependencies[dependent] = remaining - 1;
      if (remaining === 1) {
        pending[pendingCount] = dependent;
        pendingCount += 1;
      }
    }
  }
  if (resolvedCount !== componentCount) {
    throw new Error("effect provenance component graph remained cyclic");
  }

  for (const evidence of directOrigins.values()) {
    Object.freeze(evidence);
  }
  for (const evidence of directBoundaries.values()) {
    Object.freeze(evidence);
  }
  const originEvidence = new Map<number, readonly EffectProvenanceOrigin[]>();
  const boundaryEvidence = new Map<
    number,
    readonly EffectProvenanceBoundary<Reason>[]
  >();
  const originOccurrences = new WeakMap<object, readonly Node[]>();
  const dependencyLists = new Map<number, readonly number[]>();
  const resolutions = new WeakMap<
    EffectProvenanceVertex,
    EffectProvenanceResolution<Reason>
  >();
  const dependenciesFor = (component: number): readonly number[] => {
    let selected = dependencyLists.get(component);
    if (selected === undefined) {
      selected = Object.freeze([...componentsFor(dependencies, component)]);
      dependencyLists.set(component, selected);
    }
    return selected;
  };
  const originsFor = (component: number): readonly Node[] => {
    const evidence = evidenceFor(
      component,
      dependenciesFor,
      directOrigins,
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
    dependenciesFor,
    directBoundaries,
    boundaryEvidence,
  );

  return Object.freeze({
    componentCount,
    edgeCount: graph.edges.length,
    work,
    componentFor(vertex: EffectProvenanceVertex): number {
      return condensation.componentFor(vertex);
    },
    forEachComponentDependency(
      visitor: (destination: number, source: number) => void,
    ): void {
      for (let destination = 0; destination < componentCount; destination += 1) {
        for (const source of componentsFor(dependencies, destination)) {
          visitor(destination, source);
        }
      }
    },
    resolutionFor(vertex: EffectProvenanceVertex) {
      const component = condensation.componentFor(vertex);
      let resolution = resolutions.get(vertex);
      if (resolution === undefined) {
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
              dependenciesFor,
              directOrigins,
              originEvidence,
            );
          },
          get boundaries(): readonly EffectProvenanceBoundary<Reason>[] {
            return boundariesFor(component);
          },
        });
        resolutions.set(vertex, resolution);
      }
      return resolution;
    },
  });
}

function evidenceFor<Evidence>(
  root: number,
  dependenciesFor: (component: number) => readonly number[],
  directEvidence: ReadonlyMap<number, readonly Evidence[]>,
  cache: Map<number, readonly Evidence[]>,
): readonly Evidence[] {
  const existing = cache.get(root);
  if (existing !== undefined) {
    return existing;
  }
  const visiting = new Set<number>([root]);
  const pending: Array<{ readonly component: number; next: number }> = [
    { component: root, next: 0 },
  ];
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
      if (cache.get(dependency) === undefined) {
        if (visiting.has(dependency)) {
          throw new Error("effect provenance component evidence remained cyclic");
        }
        visiting.add(dependency);
        pending.push({ component: dependency, next: 0 });
      }
      continue;
    }
    cache.set(
      frame.component,
      mergeEvidence(
        directEvidence.get(frame.component) ?? noEvidence,
        selectedDependencies.map((selected) => {
          const evidence = cache.get(selected);
          if (evidence === undefined) {
            throw new Error("effect provenance dependency evidence is missing");
          }
          return evidence;
        }),
      ),
    );
    visiting.delete(frame.component);
    pending.pop();
  }
  const resolved = cache.get(root);
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

function appendComponent(
  values: Map<number, Set<number>>,
  owner: number,
  selected: number,
): boolean {
  let entries = values.get(owner);
  if (entries === undefined) {
    entries = new Set();
    values.set(owner, entries);
  }
  const previousSize = entries.size;
  entries.add(selected);
  return entries.size !== previousSize;
}

function componentsFor(
  values: ReadonlyMap<number, ReadonlySet<number>>,
  component: number,
): ReadonlySet<number> {
  return values.get(component) ?? noComponents;
}

function appendEvidence<Evidence>(
  values: Map<number, Evidence[]>,
  component: number,
  evidence: Evidence,
): void {
  const entries = values.get(component);
  if (entries === undefined) {
    values.set(component, [evidence]);
  } else {
    entries.push(evidence);
  }
}

function requiredIndex(values: Uint32Array, index: number): number {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("effect provenance component index is missing");
  }
  return selected;
}
