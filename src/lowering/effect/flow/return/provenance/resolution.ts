import type { Node } from "@tsonic/tsts";

import type { ExactProvenanceNodeSet } from "../../../provenance/origin-index.js";

export interface ReturnProvenanceResolution {
  readonly closed: boolean;
  readonly dependencyCount: number;
  dependencyNodes(): Iterable<Node>;
}

export function createReturnProvenanceResolution(
  closed: boolean,
  dependencies: ExactProvenanceNodeSet,
): ReturnProvenanceResolution {
  return Object.freeze({
    closed,
    dependencyCount: dependencies.count,
    dependencyNodes(): Iterable<Node> {
      return dependencies.nodes();
    },
  });
}
