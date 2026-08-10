import type { Node, PointerOperationFact } from "@tsonic/tsts";

import type { PointerFlowBlocker } from "./flow-graph.js";

export interface MutableDirectReferenceFamily {
  readonly identity: Node;
  readonly pointerTypes: Set<Node>;
  readonly operations: Map<Node, PointerOperationFact>;
  readonly blockers: Map<PointerFlowBlocker, Set<Node>>;
  producerCount: number;
}

export function blockDirectReferenceFamily(
  family: MutableDirectReferenceFamily,
  reason: PointerFlowBlocker,
  occurrence: Node,
): void {
  const existing = family.blockers.get(reason);
  if (existing === undefined) {
    family.blockers.set(reason, new Set([occurrence]));
  } else {
    existing.add(occurrence);
  }
}
