import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceGraph,
  EffectProvenanceVertex,
} from "../../../provenance/model.js";

interface ReachableDependency {
  readonly source: EffectProvenanceVertex;
  readonly occurrence: Node;
}

export function collectClosedIndirectCallableReferences<Reason extends string>(
  root: EffectProvenanceVertex,
  graph: EffectProvenanceGraph<Reason>,
  references: Set<Node>,
): void {
  const dependencies = new Map<number, ReachableDependency[]>();
  for (const edge of graph.edges) {
    const dependency = { source: edge.source, occurrence: edge.occurrence };
    const selected = dependencies.get(edge.destination.index);
    if (selected === undefined) {
      dependencies.set(edge.destination.index, [dependency]);
    } else {
      selected.push(dependency);
    }
  }
  const pending = [root];
  const visited = new Set<number>();
  while (pending.length !== 0) {
    const vertex = pending.pop();
    if (vertex === undefined || visited.has(vertex.index)) {
      continue;
    }
    visited.add(vertex.index);
    references.add(vertex.occurrence);
    for (const dependency of dependencies.get(vertex.index) ?? []) {
      references.add(dependency.occurrence);
      pending.push(dependency.source);
    }
  }
}
