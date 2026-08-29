import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type {
  PointerFlowBlocker,
  PointerFlowBlockerOccurrence,
  PointerFlowComponent,
} from "./flow-graph.js";
import type { DirectReferenceFamilyDecision } from "./flow-family-state.js";
import { nonBijectiveIdentityOccurrences } from "./flow-family-identity.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";
import { describePointerPointee } from "./pointee-classification.js";

export type PointerFlowRepresentation =
  | "location"
  | "direct-snapshot"
  | "mutable-cell"
  | "direct-object";

export interface PointerFlowDecision {
  readonly representation: PointerFlowRepresentation;
  readonly blockers: readonly PointerFlowBlocker[];
  readonly blockerEvidence: readonly PointerFlowBlockerOccurrence[];
  readonly settledLocalIdentity: boolean;
}

export function selectPointerFlowRepresentation(
  source: TargetSourceProgram,
  component: PointerFlowComponent,
  facts: PointerTypedFactLedger,
  hasDirectObjectReplacement: (storeCall: Node) => boolean,
  familyDecisions: readonly DirectReferenceFamilyDecision[],
  hasBindingWrite: (declaration: Node | undefined) => boolean,
  ledger: PointerPlanningLedger,
): PointerFlowDecision {
  const localIdentityCandidate = component.blockers.length === 1 &&
    component.blockers[0] === "identity-observed";
  if (component.blockers.length !== 0 && !localIdentityCandidate) {
    return settleFamilyDecision(
      component,
      locationDecision(component, ledger),
      familyDecisions,
      ledger,
    );
  }
  const descriptions = component.pointees.map((evidence) => {
    ledger.record("representation");
    return describePointerPointee(source, evidence.anchor, evidence.type);
  });
  const description = descriptions[0];
  if (
    description === undefined ||
    descriptions.some((candidate) => {
      ledger.record("representation");
      return candidate === undefined ||
        candidate.category !== description.category ||
        candidate.identity !== description.identity;
    })
  ) {
    const decision = component.blockers.length !== 0
      ? locationDecision(component, ledger)
      : locationDecision(
          component,
          ledger,
          "unsupported-pointee",
          component.pointees.map((evidence) => {
            ledger.record("representation");
            return evidence.anchor;
          }),
        );
    return settleFamilyDecision(
      component,
      decision,
      familyDecisions,
      ledger,
    );
  }
  const category = description.category;
  const operations = component.operations.map((node) => {
    ledger.record("representation");
    return facts.operationFor(node);
  });
  if (operations.some((operation) => {
    ledger.record("representation");
    return operation === undefined;
  })) {
    const decision = component.blockers.length !== 0
      ? locationDecision(component, ledger)
      : locationDecision(
          component,
          ledger,
          "unsupported-flow",
          component.operations.filter((node, index) => {
            ledger.record("representation");
            return operations[index] === undefined;
          }),
        );
    return settleFamilyDecision(
      component,
      decision,
      familyDecisions,
      ledger,
    );
  }
  const settledLocalIdentity = canSettleLocalIdentity(
    source,
    component,
    description,
    operations,
    hasBindingWrite,
    ledger,
  );
  let decision: PointerFlowDecision;
  if (component.blockers.length !== 0 && !settledLocalIdentity) {
    decision = locationDecision(component, ledger);
    return settleFamilyDecision(component, decision, familyDecisions, ledger);
  }
  if (component.producers.length === 0) {
    decision = locationDecision(
      component,
      ledger,
      "unsupported-producer",
      componentAnchors(component, ledger),
    );
    return settleFamilyDecision(component, decision, familyDecisions, ledger);
  }
  const stores = operations.filter((operation) => {
    ledger.record("representation");
    return operation?.operation === "store";
  });
  const producersAreDirect = component.producers.every((producer) => {
    ledger.record("representation");
    return producer.operation === "allocate" || producer.operation === "address-of";
  });
  if (!producersAreDirect) {
    decision = locationDecision(
      component,
      ledger,
      "unsupported-producer",
      component.producers.map((producer) => {
        ledger.record("representation");
        return producer.call;
      }),
    );
    return settleFamilyDecision(component, decision, familyDecisions, ledger);
  }
  if (stores.length !== 0) {
    const allocatedCell = component.producers.every(
        (producer) => {
          ledger.record("representation");
          return producer.operation === "allocate";
        },
      ) && (category === "scalar" || category === "direct-reference");
    if (allocatedCell) {
      decision = optimizedDecision("mutable-cell", settledLocalIdentity);
      return settleFamilyDecision(component, decision, familyDecisions, ledger);
    }
    const replaceableAddressedObject = category === "direct-reference" &&
      stores.every((operation) => {
        ledger.record("representation");
        return operation !== undefined &&
          hasDirectObjectReplacement(operation.call);
      });
    decision = replaceableAddressedObject
      ? optimizedDecision("direct-object", settledLocalIdentity)
      : locationDecision(
          component,
          ledger,
          "unsupported-flow",
          stores.flatMap((operation) =>
            operation === undefined ? [] : [operation.call]
          ),
        );
    return settleFamilyDecision(component, decision, familyDecisions, ledger);
  }
  decision = optimizedDecision(
    category === "scalar" ? "direct-snapshot" : "direct-object",
    settledLocalIdentity,
  );
  return settleFamilyDecision(component, decision, familyDecisions, ledger);
}

function optimizedDecision(
  representation: Exclude<PointerFlowRepresentation, "location">,
  settledLocalIdentity = false,
): PointerFlowDecision {
  return Object.freeze({
    representation,
    blockers: Object.freeze([]),
    blockerEvidence: Object.freeze([]),
    settledLocalIdentity,
  });
}

function locationDecision(
  component: PointerFlowComponent,
  ledger: PointerPlanningLedger,
  blocker?: PointerFlowBlocker,
  occurrences: readonly Node[] = [],
): PointerFlowDecision {
  const evidence = new Map<PointerFlowBlocker, Set<Node>>();
  for (const entry of component.blockerEvidence) {
    ledger.record("representation");
    const occurrences = new Set<Node>();
    for (const occurrence of entry.occurrences) {
      ledger.record("representation");
      occurrences.add(occurrence);
    }
    evidence.set(entry.reason, occurrences);
  }
  if (blocker !== undefined) {
    const selected = occurrences.length === 0
      ? componentAnchors(component, ledger)
      : occurrences;
    const existing = evidence.get(blocker);
    if (existing === undefined) {
      evidence.set(blocker, new Set(selected));
    } else {
      for (const occurrence of selected) {
        ledger.record("representation");
        existing.add(occurrence);
      }
    }
  }
  for (const reason of component.blockers) {
    ledger.record("representation");
    if (!evidence.has(reason)) {
      throw new Error(`pointer blocker '${reason}' has no exact occurrence`);
    }
  }
  const blockerEvidence = [...evidence]
    .sort(([left], [right]) => {
      ledger.record("representation");
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([reason, selected]) => Object.freeze({
      reason,
      occurrences: Object.freeze([...selected]),
    }));
  return Object.freeze({
    representation: "location",
    blockers: Object.freeze(blockerEvidence.map((entry) => entry.reason)),
    blockerEvidence: Object.freeze(blockerEvidence),
    settledLocalIdentity: false,
  });
}

function canSettleLocalIdentity(
  source: TargetSourceProgram,
  component: PointerFlowComponent,
  description: NonNullable<ReturnType<typeof describePointerPointee>>,
  operations: readonly (PointerOperationFact | undefined)[],
  hasBindingWrite: (declaration: Node | undefined) => boolean,
  ledger: PointerPlanningLedger,
): boolean {
  if (
    component.blockers.length !== 1 ||
    component.blockers[0] !== "identity-observed" ||
    description.category !== "direct-reference" ||
    typeof description.identity === "string" ||
    operations.some((operation) => operation === undefined) ||
    operations.some((operation) => operation?.operation === "store")
  ) {
    return false;
  }
  return nonBijectiveIdentityOccurrences(
    source,
    description.identity,
    operations.filter((operation) => operation !== undefined),
    hasBindingWrite,
    ledger,
  ).length === 0;
}

function settleFamilyDecision(
  component: PointerFlowComponent,
  componentDecision: PointerFlowDecision,
  familyDecisions: readonly DirectReferenceFamilyDecision[],
  ledger: PointerPlanningLedger,
): PointerFlowDecision {
  const selected = new Set(familyDecisions);
  if (selected.has("location")) {
    return componentDecision.representation === "location"
      ? componentDecision
      : locationDecision(component, ledger);
  }
  if (componentDecision.representation !== "location" || selected.size === 0) {
    return componentDecision;
  }
  if (selected.size !== 1) {
    throw new Error("pointer component selected multiple family capabilities");
  }
  const representation = [...selected][0];
  if (representation === undefined || representation === "location") {
    throw new Error("pointer component lost its family capability");
  }
  return optimizedDecision(representation);
}

function componentAnchors(
  component: PointerFlowComponent,
  ledger: PointerPlanningLedger,
): readonly Node[] {
  const anchors = component.vertices.map((vertex) => {
    ledger.record("representation");
    return vertex.node;
  });
  if (anchors.length === 0) {
    throw new Error("pointer flow component has no source anchor");
  }
  return anchors;
}
