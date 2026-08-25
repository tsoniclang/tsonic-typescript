import type { Node, PointerOperationFact } from "@tsonic/tsts";

import type {
  PointerFlowBlocker,
  PointerFlowBlockerOccurrence,
} from "./flow-graph.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

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
  readonly canonicalNodes: Map<
    Node,
    Map<PointerFlowBlocker, Set<Node>>
  >;
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
  affectedNode: Node = occurrence,
): void {
  blockDirectReferenceFamily(family, reason, occurrence);
  let evidence = family.canonicalNodes.get(affectedNode);
  if (evidence === undefined) {
    evidence = new Map();
    family.canonicalNodes.set(affectedNode, evidence);
  }
  const occurrences = evidence.get(reason);
  if (occurrences === undefined) {
    evidence.set(reason, new Set([occurrence]));
  } else {
    occurrences.add(occurrence);
  }
}

export function canonicalDirectReferenceNodeEvidence(
  family: MutableDirectReferenceFamily,
  node: Node,
  ledger: PointerPlanningLedger,
): readonly PointerFlowBlockerOccurrence[] {
  const evidence = family.canonicalNodes.get(node);
  if (evidence === undefined) {
    throw new Error("canonical pointer-family node has no exact evidence");
  }
  return Object.freeze([...evidence]
    .sort(([left], [right]) => {
      ledger.record("evidence");
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([reason, selected]) => {
      ledger.record("evidence");
      const occurrences: Node[] = [];
      for (const occurrence of selected) {
        ledger.record("evidence");
        occurrences.push(occurrence);
      }
      return Object.freeze({
        reason,
        occurrences: Object.freeze(occurrences),
      });
    }));
}
