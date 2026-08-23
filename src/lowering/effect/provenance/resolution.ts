import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceBoundary,
  EffectProvenanceGraph,
  EffectProvenanceOrigin,
  EffectProvenanceResolution,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "./model.js";
import {
  createEffectProvenanceComponentAdjacency,
  type EffectProvenanceComponentAdjacency,
  requiredComponentIndex,
} from "./component-adjacency.js";
import { condenseEffectProvenance } from "./scc.js";

const noEvidence: readonly never[] = Object.freeze([]);

export function resolveEffectProvenance<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
): EffectProvenanceResolutionIndex<Reason> {
  const condensation = condenseEffectProvenance(graph.vertices, graph.edges);
  const componentCount = condensation.componentCount;
  const adjacency = createEffectProvenanceComponentAdjacency(
    componentCount,
    (consume) => {
      for (const edge of graph.edges) {
        const source = condensation.componentFor(edge.source);
        const destination = condensation.componentFor(edge.destination);
        if (source !== destination) {
          consume(destination, source);
        }
      }
    },
  );
  const directOrigins = new Map<number, EffectProvenanceOrigin[]>();
  const directBoundaries = new Map<
    number,
    EffectProvenanceBoundary<Reason>[]
  >();
  const hasOrigin = new Uint8Array(componentCount);
  const hasBoundary = new Uint8Array(componentCount);
  let work = condensation.work + adjacency.dependencies.length;
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
    const remaining = requiredComponentIndex(
      adjacency.dependencyOffsets,
      component + 1,
    ) - requiredComponentIndex(adjacency.dependencyOffsets, component);
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
    const dependentStart = requiredComponentIndex(
      adjacency.dependentOffsets,
      component,
    );
    const dependentEnd = requiredComponentIndex(
      adjacency.dependentOffsets,
      component + 1,
    );
    for (let edge = dependentStart; edge < dependentEnd; edge += 1) {
      const dependent = requiredComponentIndex(adjacency.dependents, edge);
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
  const boundaryReasonReachability = new Map<Reason, Uint8Array>();
  const originOccurrences = new WeakMap<object, readonly Node[]>();
  const resolutions = new WeakMap<
    EffectProvenanceVertex,
    EffectProvenanceResolution<Reason>
  >();
  const originsFor = (component: number): readonly Node[] => {
    const evidence = evidenceFor(
      component,
      adjacency,
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
    adjacency,
    directBoundaries,
    boundaryEvidence,
  );
  const hasBoundaryReason = (component: number, reason: Reason): boolean => {
    let reachable = boundaryReasonReachability.get(reason);
    if (reachable === undefined) {
      reachable = boundaryReasonComponents(
        reason,
        componentCount,
        directBoundaries,
        adjacency,
      );
      boundaryReasonReachability.set(reason, reachable);
    }
    return reachable[component] === 1;
  };

  return Object.freeze({
    componentCount,
    edgeCount: graph.edges.length,
    work,
    componentFor(vertex: EffectProvenanceVertex): number {
      return condensation.componentFor(vertex);
    },
    componentDependencyCount(component: number): number {
      return requiredComponentIndex(
        adjacency.dependencyOffsets,
        component + 1,
      ) - requiredComponentIndex(adjacency.dependencyOffsets, component);
    },
    componentDependency(
      component: number,
      index: number,
    ): number {
      const start = requiredComponentIndex(
        adjacency.dependencyOffsets,
        component,
      );
      const end = requiredComponentIndex(
        adjacency.dependencyOffsets,
        component + 1,
      );
      if (!Number.isSafeInteger(index) || index < 0 || start + index >= end) {
        throw new Error("effect provenance component dependency is missing");
      }
      return requiredComponentIndex(adjacency.dependencies, start + index);
    },
    componentDependentCount(component: number): number {
      return requiredComponentIndex(
        adjacency.dependentOffsets,
        component + 1,
      ) - requiredComponentIndex(adjacency.dependentOffsets, component);
    },
    componentDependent(
      component: number,
      index: number,
    ): number {
      const start = requiredComponentIndex(
        adjacency.dependentOffsets,
        component,
      );
      const end = requiredComponentIndex(
        adjacency.dependentOffsets,
        component + 1,
      );
      if (!Number.isSafeInteger(index) || index < 0 || start + index >= end) {
        throw new Error("effect provenance component dependent is missing");
      }
      return requiredComponentIndex(adjacency.dependents, start + index);
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
              adjacency,
              directOrigins,
              originEvidence,
            );
          },
          get boundaries(): readonly EffectProvenanceBoundary<Reason>[] {
            return boundariesFor(component);
          },
          hasBoundaryReason(reason: Reason): boolean {
            return hasBoundaryReason(component, reason);
          },
        });
        resolutions.set(vertex, resolution);
      }
      return resolution;
    },
  });
}

function boundaryReasonComponents<Reason extends string>(
  reason: Reason,
  componentCount: number,
  directBoundaries: ReadonlyMap<
    number,
    readonly EffectProvenanceBoundary<Reason>[]
  >,
  adjacency: EffectProvenanceComponentAdjacency,
): Uint8Array {
  const reachable = new Uint8Array(componentCount);
  const pending = new Uint32Array(componentCount);
  let pendingCount = 0;
  for (const [component, boundaries] of directBoundaries) {
    if (
      reachable[component] === 0 &&
      boundaries.some((boundary) => boundary.reason === reason)
    ) {
      reachable[component] = 1;
      pending[pendingCount] = component;
      pendingCount += 1;
    }
  }
  let next = 0;
  while (next < pendingCount) {
    const component = requiredIndex(pending, next);
    next += 1;
    const start = requiredComponentIndex(
      adjacency.dependentOffsets,
      component,
    );
    const end = requiredComponentIndex(
      adjacency.dependentOffsets,
      component + 1,
    );
    for (let edge = start; edge < end; edge += 1) {
      const dependent = requiredComponentIndex(adjacency.dependents, edge);
      if (reachable[dependent] === 1) {
        continue;
      }
      reachable[dependent] = 1;
      pending[pendingCount] = dependent;
      pendingCount += 1;
    }
  }
  return reachable;
}

function evidenceFor<Evidence>(
  root: number,
  adjacency: EffectProvenanceComponentAdjacency,
  directEvidence: ReadonlyMap<number, readonly Evidence[]>,
  cache: Map<number, readonly Evidence[]>,
): readonly Evidence[] {
  const existing = cache.get(root);
  if (existing !== undefined) {
    return existing;
  }
  const visiting = new Set<number>([root]);
  const pending: Array<{
    readonly component: number;
    readonly end: number;
    next: number;
  }> = [
    evidenceFrame(root, adjacency),
  ];
  while (pending.length !== 0) {
    const frame = pending[pending.length - 1];
    if (frame === undefined) {
      throw new Error("effect provenance evidence traversal lost its frame");
    }
    if (frame.next < frame.end) {
      const dependency = requiredComponentIndex(
        adjacency.dependencies,
        frame.next,
      );
      frame.next += 1;
      if (cache.get(dependency) === undefined) {
        if (visiting.has(dependency)) {
          throw new Error("effect provenance component evidence remained cyclic");
        }
        visiting.add(dependency);
        pending.push(evidenceFrame(dependency, adjacency));
      }
      continue;
    }
    cache.set(
      frame.component,
      mergeEvidence(
        directEvidence.get(frame.component) ?? noEvidence,
        dependencyEvidence(frame.component, adjacency, cache),
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

function evidenceFrame(
  component: number,
  adjacency: EffectProvenanceComponentAdjacency,
): { readonly component: number; readonly end: number; next: number } {
  return {
    component,
    next: requiredComponentIndex(adjacency.dependencyOffsets, component),
    end: requiredComponentIndex(adjacency.dependencyOffsets, component + 1),
  };
}

function dependencyEvidence<Evidence>(
  component: number,
  adjacency: EffectProvenanceComponentAdjacency,
  cache: ReadonlyMap<number, readonly Evidence[]>,
): readonly (readonly Evidence[])[] {
  const result: (readonly Evidence[])[] = [];
  const start = requiredComponentIndex(
    adjacency.dependencyOffsets,
    component,
  );
  const end = requiredComponentIndex(
    adjacency.dependencyOffsets,
    component + 1,
  );
  for (let edge = start; edge < end; edge += 1) {
    const dependency = requiredComponentIndex(adjacency.dependencies, edge);
    const evidence = cache.get(dependency);
    if (evidence === undefined) {
      throw new Error("effect provenance dependency evidence is missing");
    }
    result.push(evidence);
  }
  return result;
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
