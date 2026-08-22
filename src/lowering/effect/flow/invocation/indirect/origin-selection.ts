import type { Node } from "@tsonic/tsts";

import {
  createEffectProvenanceOriginIndex,
  selectOriginOccurrences,
} from "../../../provenance/origin-index.js";
import type {
  EffectProvenanceGraph,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "../../../provenance/model.js";

interface IndirectCallableRoot {
  readonly vertex: EffectProvenanceVertex;
}

export interface ClosedIndirectCallableOrigin {
  readonly call: Node;
  readonly vertex: EffectProvenanceVertex;
  readonly implementations: readonly Node[];
}

export function selectClosedIndirectCallableOrigins<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
  resolutions: EffectProvenanceResolutionIndex<Reason>,
  roots: ReadonlyMap<Node, IndirectCallableRoot>,
  callableOrigins: ReadonlySet<Node>,
  originIsExact: (origin: Node) => boolean,
): readonly ClosedIndirectCallableOrigin[] {
  const origins = createEffectProvenanceOriginIndex(
    graph,
    resolutions,
    [selectOriginOccurrences(callableOrigins)],
  );
  const result: ClosedIndirectCallableOrigin[] = [];
  for (const [call, root] of roots) {
    if (!resolutions.resolutionFor(root.vertex).closed) {
      continue;
    }
    const selection = origins.selectionFor(root.vertex, 0);
    if (selection.count === 0) {
      continue;
    }
    const implementations = [...selection.values()];
    if (!implementations.every(originIsExact)) {
      continue;
    }
    result.push(Object.freeze({
      call,
      vertex: root.vertex,
      implementations: Object.freeze(implementations),
    }));
  }
  return Object.freeze(result);
}
