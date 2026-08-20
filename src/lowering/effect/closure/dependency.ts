import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceEdgeKind } from "../provenance/model.js";

export type CooperativeEffectDependencyEvidence = ReadonlyMap<
  EffectProvenanceEdgeKind,
  ReadonlySet<Node>
>;

export interface MutableCooperativeEffectDependencyVertex<
  Vertex extends MutableCooperativeEffectDependencyVertex<Vertex>,
> {
  readonly dependencies: Set<Vertex>;
  readonly dependencyEvidence: Map<
    Vertex,
    Map<EffectProvenanceEdgeKind, Set<Node>>
  >;
}

export function connectCooperativeEffectDependency<
  Vertex extends MutableCooperativeEffectDependencyVertex<Vertex>,
>(
  owner: Vertex,
  dependency: Vertex,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
): void {
  owner.dependencies.add(dependency);
  let kinds = owner.dependencyEvidence.get(dependency);
  if (kinds === undefined) {
    kinds = new Map();
    owner.dependencyEvidence.set(dependency, kinds);
  }
  let occurrences = kinds.get(kind);
  if (occurrences === undefined) {
    occurrences = new Set();
    kinds.set(kind, occurrences);
  }
  occurrences.add(occurrence);
}

export function assertCooperativeEffectDependencyEvidence<
  Vertex extends MutableCooperativeEffectDependencyVertex<Vertex>,
>(vertex: Vertex): void {
  if (
    vertex.dependencies.size !== vertex.dependencyEvidence.size ||
    [...vertex.dependencies].some((dependency) => {
      const evidence = vertex.dependencyEvidence.get(dependency);
      return evidence === undefined || evidence.size === 0 ||
        [...evidence.values()].some((occurrences) => occurrences.size === 0);
    }) ||
    [...vertex.dependencyEvidence.keys()].some((dependency) =>
      !vertex.dependencies.has(dependency)
    )
  ) {
    throw new Error(
      "cooperative-effect dependency set and evidence ledger disagree",
    );
  }
}
