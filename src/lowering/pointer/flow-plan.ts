import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { censusPointerFlows } from "./flow-census.js";
import type {
  PointerFlowBlocker,
  PointerFlowComponent,
} from "./flow-graph.js";
import { describePointerPointee } from "./pointee-classification.js";

export type { PointerFlowBlocker } from "./flow-graph.js";

export type PointerFlowRepresentation =
  | "location"
  | "direct-snapshot"
  | "mutable-cell"
  | "direct-object";

export interface PointerFlowComponentSummary {
  readonly representation: PointerFlowRepresentation;
  readonly vertexCount: number;
  readonly operationCount: number;
  readonly pointerTypeCount: number;
  readonly blockers: readonly PointerFlowBlocker[];
}

export interface ClosedPointerFlowPlan {
  owns(source: TargetSourceProgram): boolean;
  representationFor(node: Node | undefined): PointerFlowRepresentation;
  readonly components: readonly PointerFlowComponentSummary[];
  readonly optimizedComponentCount: number;
}

interface PointerFlowDecision {
  readonly representation: PointerFlowRepresentation;
  readonly blockers: readonly PointerFlowBlocker[];
}

export function createClosedPointerFlowPlan(
  source: TargetSourceProgram,
): ClosedPointerFlowPlan {
  const representations = new Map<Node, PointerFlowRepresentation>();
  const summaries: PointerFlowComponentSummary[] = [];
  let optimizedComponentCount = 0;
  for (const component of censusPointerFlows(source)) {
    const decision = selectRepresentation(source, component);
    const { representation } = decision;
    if (representation !== "location") {
      optimizedComponentCount += 1;
      for (const vertex of component.vertices) {
        representations.set(vertex.node, representation);
      }
      for (const operation of component.operations) {
        representations.set(operation, representation);
      }
      for (const pointerType of component.pointerTypes) {
        representations.set(pointerType, representation);
      }
    }
    summaries.push(Object.freeze({
      representation,
      vertexCount: component.vertices.length,
      operationCount: component.operations.length,
      pointerTypeCount: component.pointerTypes.length,
      blockers: decision.blockers,
    }));
  }
  const frozenSummaries = Object.freeze(summaries);
  return Object.freeze({
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    representationFor(node: Node | undefined): PointerFlowRepresentation {
      return node === undefined
        ? "location"
        : representations.get(node) ?? "location";
    },
    components: frozenSummaries,
    optimizedComponentCount,
  });
}

function selectRepresentation(
  source: TargetSourceProgram,
  component: PointerFlowComponent,
): PointerFlowDecision {
  if (component.blockers.length !== 0) {
    return locationDecision(component);
  }
  if (component.producers.length === 0) {
    return locationDecision(component, "unsupported-producer");
  }
  const descriptions = component.pointees.map((evidence) =>
    describePointerPointee(source, evidence.anchor, evidence.type)
  );
  const description = descriptions[0];
  if (
    description === undefined ||
    descriptions.some((candidate) =>
      candidate === undefined ||
      candidate.category !== description.category ||
      candidate.identity !== description.identity
    )
  ) {
    return locationDecision(component, "unsupported-pointee");
  }
  const category = description.category;
  const operations = component.operations.map((node) =>
    source.sourceFacts.getFact(node, pointerOperationFactKey)
  );
  if (operations.some((operation) => operation === undefined)) {
    return locationDecision(component, "unsupported-flow");
  }
  const hasStore = operations.some((operation) => operation?.operation === "store");
  const producersAreDirect = component.producers.every((producer) =>
    producer.operation === "allocate" || producer.operation === "address-of"
  );
  if (!producersAreDirect) {
    return locationDecision(component, "unsupported-producer");
  }
  if (hasStore) {
    const representation = category === "scalar" && component.producers.every(
      (producer) => producer.operation === "allocate",
    )
      ? "mutable-cell"
      : "location";
    return representation === "location"
      ? locationDecision(component, "unsupported-flow")
      : optimizedDecision(representation);
  }
  return optimizedDecision(
    category === "scalar" ? "direct-snapshot" : "direct-object",
  );
}

function optimizedDecision(
  representation: Exclude<PointerFlowRepresentation, "location">,
): PointerFlowDecision {
  return Object.freeze({ representation, blockers: Object.freeze([]) });
}

function locationDecision(
  component: PointerFlowComponent,
  blocker?: PointerFlowBlocker,
): PointerFlowDecision {
  const blockers = new Set(component.blockers);
  if (blocker !== undefined) {
    blockers.add(blocker);
  }
  return Object.freeze({
    representation: "location",
    blockers: Object.freeze([...blockers].sort()),
  });
}
