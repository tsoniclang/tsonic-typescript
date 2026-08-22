import type { Node } from "@tsonic/tsts";

import type { ExactProvenanceValueSet } from "../../../provenance/origin-index.js";

export interface ReturnProvenanceResolution {
  readonly closed: boolean;
  readonly dependencyCount: number;
  dependencyNodes(): Iterable<Node>;
}

export function createReturnProvenanceResolution(
  closed: boolean,
  dependencies: ExactProvenanceValueSet<Node>,
): ReturnProvenanceResolution {
  return Object.freeze({
    closed,
    dependencyCount: dependencies.count,
    dependencyNodes(): Iterable<Node> {
      return dependencies.values();
    },
  });
}
