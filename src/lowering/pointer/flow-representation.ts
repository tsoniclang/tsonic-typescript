import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type {
  PointerFlowBlocker,
  PointerFlowBlockerOccurrence,
  PointerFlowComponent,
} from "./flow-graph.js";
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
}

export function selectPointerFlowRepresentation(
  source: TargetSourceProgram,
  component: PointerFlowComponent,
  facts: PointerTypedFactLedger,
  hasDirectObjectReplacement: (storeCall: Node) => boolean,
  ledger: PointerPlanningLedger,
): PointerFlowDecision {
  if (component.blockers.length !== 0) {
    return locationDecision(component, ledger);
  }
  if (component.producers.length === 0) {
    return locationDecision(
      component,
      ledger,
      "unsupported-producer",
      componentAnchors(component, ledger),
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
    return locationDecision(
      component,
      ledger,
      "unsupported-pointee",
      component.pointees.map((evidence) => {
        ledger.record("representation");
        return evidence.anchor;
      }),
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
    return locationDecision(
      component,
      ledger,
      "unsupported-flow",
      component.operations.filter((node, index) => {
        ledger.record("representation");
        return operations[index] === undefined;
      }),
    );
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
    return locationDecision(
      component,
      ledger,
      "unsupported-producer",
      component.producers.map((producer) => {
        ledger.record("representation");
        return producer.call;
      }),
    );
  }
  if (stores.length !== 0) {
    const allocatedCell = component.producers.every(
        (producer) => {
          ledger.record("representation");
          return producer.operation === "allocate";
        },
      ) && (category === "scalar" || category === "direct-reference");
    if (allocatedCell) {
      return optimizedDecision("mutable-cell");
    }
    const replaceableAddressedObject = category === "direct-reference" &&
      stores.every((operation) => {
        ledger.record("representation");
        return operation !== undefined &&
          hasDirectObjectReplacement(operation.call);
      });
    return replaceableAddressedObject
      ? optimizedDecision("direct-object")
      : locationDecision(
          component,
          ledger,
          "unsupported-flow",
          stores.flatMap((operation) =>
            operation === undefined ? [] : [operation.call]
          ),
        );
  }
  return optimizedDecision(
    category === "scalar" ? "direct-snapshot" : "direct-object",
  );
}

function optimizedDecision(
  representation: Exclude<PointerFlowRepresentation, "location">,
): PointerFlowDecision {
  return Object.freeze({
    representation,
    blockers: Object.freeze([]),
    blockerEvidence: Object.freeze([]),
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
  });
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
