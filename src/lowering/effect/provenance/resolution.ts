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

interface MutableComponentResolution<Reason extends string> {
  readonly dependencies: Set<number>;
  readonly dependents: Set<number>;
  readonly origins: Set<EffectProvenanceOrigin>;
  readonly boundaries: Set<EffectProvenanceBoundary<Reason>>;
  remainingDependencies: number;
  resolved: boolean;
}

export function resolveEffectProvenance<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
): EffectProvenanceResolutionIndex<Reason> {
  const condensation = condenseEffectProvenance(graph.vertices, graph.edges);
  const components: MutableComponentResolution<Reason>[] =
    condensation.components.map(() => ({
      dependencies: new Set(),
      dependents: new Set(),
      origins: new Set(),
      boundaries: new Set(),
      remainingDependencies: 0,
      resolved: false,
    }));
  let work = condensation.work;
  for (const edge of graph.edges) {
    const source = componentFor(condensation.componentForVertex, edge.source);
    const destination = componentFor(
      condensation.componentForVertex,
      edge.destination,
    );
    if (source === destination) {
      continue;
    }
    const selected = requiredComponent(components, destination);
    if (selected.dependencies.add(source)) {
      requiredComponent(components, source).dependents.add(destination);
      work += 1;
    }
  }
  for (const origin of graph.origins) {
    requiredComponent(
      components,
      componentFor(condensation.componentForVertex, origin.vertex),
    ).origins.add(origin);
  }
  for (const boundary of graph.boundaries) {
    const component = requiredComponent(
      components,
      componentFor(condensation.componentForVertex, boundary.vertex),
    );
    component.boundaries.add(boundary);
  }
  const pending: number[] = [];
  for (const [index, component] of components.entries()) {
    component.remainingDependencies = component.dependencies.size;
    if (component.remainingDependencies === 0) {
      pending.push(index);
    }
  }
  let resolvedCount = 0;
  while (pending.length !== 0) {
    const index = pending.pop();
    if (index === undefined) {
      continue;
    }
    const component = requiredComponent(components, index);
    if (component.resolved) {
      continue;
    }
    component.resolved = true;
    resolvedCount += 1;
    work += 1;
    for (const dependentIndex of component.dependents) {
      const dependent = requiredComponent(components, dependentIndex);
      for (const origin of component.origins) {
        dependent.origins.add(origin);
      }
      for (const boundary of component.boundaries) {
        dependent.boundaries.add(boundary);
      }
      dependent.remainingDependencies -= 1;
      if (dependent.remainingDependencies === 0) {
        pending.push(dependentIndex);
      }
    }
  }
  if (resolvedCount !== components.length) {
    throw new Error("effect provenance component graph remained cyclic");
  }
  const resolutions = graph.vertices.map((vertex) => {
    const componentIndex = componentFor(
      condensation.componentForVertex,
      vertex,
    );
    const component = requiredComponent(components, componentIndex);
    const originEvidence = Object.freeze([...component.origins]);
    const origins = Object.freeze(originEvidence.map((origin) =>
      origin.occurrence
    ));
    const boundaries = Object.freeze([...component.boundaries]);
    return Object.freeze({
      vertex,
      component: componentIndex,
      closed: origins.length !== 0 && boundaries.length === 0,
      originless: origins.length === 0,
      origins,
      originEvidence,
      boundaries,
    });
  });
  return Object.freeze({
    componentCount: components.length,
    edgeCount: graph.edges.length,
    work,
    resolutionFor(vertex: EffectProvenanceVertex) {
      const resolution = resolutions[vertex.index];
      if (resolution === undefined || resolution.vertex !== vertex) {
        throw new Error("effect provenance resolution received foreign vertex");
      }
      return resolution as EffectProvenanceResolution<Reason>;
    },
  });
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

function requiredComponent<Reason extends string>(
  components: readonly MutableComponentResolution<Reason>[],
  index: number,
): MutableComponentResolution<Reason> {
  const component = components[index];
  if (component === undefined) {
    throw new Error("effect provenance component is missing");
  }
  return component;
}
