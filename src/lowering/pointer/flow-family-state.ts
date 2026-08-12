import type { Node, PointerOperationFact } from "@tsonic/tsts";

import type {
  PointerFlowBlocker,
  PointerFlowBlockerOccurrence,
} from "./flow-graph.js";

export type DirectReferenceFamilyRepresentation =
  | "direct-object"
  | "mutable-cell";

export type DirectReferenceFamilyDecision =
  | DirectReferenceFamilyRepresentation
  | "location";

export interface MutableDirectReferenceFamily {
  readonly identity: Node;
  readonly pointerTypes: Set<Node>;
  readonly operations: Map<Node, PointerOperationFact>;
  readonly blockers: Map<PointerFlowBlocker, Set<Node>>;
  readonly canonicalBlockers: Set<PointerFlowBlocker>;
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

export function requireCanonicalDirectReferenceFamily(
  family: MutableDirectReferenceFamily,
  reason: PointerFlowBlocker,
  occurrence: Node,
): void {
  blockDirectReferenceFamily(family, reason, occurrence);
  family.canonicalBlockers.add(reason);
}

export function canonicalDirectReferenceFamilyEvidence(
  family: MutableDirectReferenceFamily,
): readonly PointerFlowBlockerOccurrence[] {
  return Object.freeze([...family.blockers]
    .filter(([reason]) => family.canonicalBlockers.has(reason))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, occurrences]) => Object.freeze({
      reason,
      occurrences: Object.freeze([...occurrences]),
    })));
}
