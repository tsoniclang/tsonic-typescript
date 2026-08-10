import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../occurrence.js";
import {
  censusPointerFlows,
  collectPointerFlowNodes,
} from "./flow-census.js";
import { planDirectReferenceFamilies } from "./flow-families.js";
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

export interface PointerFlowFallbackEvidence {
  readonly reason: PointerFlowBlocker;
  readonly count: number;
  readonly examples: readonly OptimizationOccurrence[];
}

export interface ClosedPointerFlowPlan {
  owns(source: TargetSourceProgram): boolean;
  representationFor(node: Node | undefined): PointerFlowRepresentation;
  readonly components: readonly PointerFlowComponentSummary[];
  readonly optimizedComponentCount: number;
  readonly optimizedFamilyCount: number;
  readonly fallbackReasons: readonly PointerFlowFallbackEvidence[];
}

interface PointerFlowDecision {
  readonly representation: PointerFlowRepresentation;
  readonly blockers: readonly PointerFlowBlocker[];
}

export function createClosedPointerFlowPlan(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
): ClosedPointerFlowPlan {
  const nodes = collectPointerFlowNodes(source);
  const components = censusPointerFlows(source, nodes);
  const familyPlan = planDirectReferenceFamilies(
    source,
    nodes,
    components,
  );
  const representations = new Map<Node, PointerFlowRepresentation>(
    familyPlan.representations,
  );
  const summaries: PointerFlowComponentSummary[] = [];
  const fallbackReasons = new Map<
    PointerFlowBlocker,
    { count: number; examples: OptimizationOccurrence[] }
  >();
  let optimizedComponentCount = 0;
  for (const component of components) {
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
    appendFallbackEvidence(
      source,
      sourceIdentityFor,
      component,
      decision.blockers,
      fallbackReasons,
    );
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
    optimizedFamilyCount: familyPlan.familyCount,
    fallbackReasons: sealFallbackEvidence(fallbackReasons),
  });
}

function appendFallbackEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  component: PointerFlowComponent,
  blockers: readonly PointerFlowBlocker[],
  fallback: Map<
    PointerFlowBlocker,
    { count: number; examples: OptimizationOccurrence[] }
  >,
): void {
  if (blockers.length === 0) {
    return;
  }
  const example = component.vertices
    .map((vertex) =>
      optimizationOccurrence(source, vertex.node, sourceIdentityFor)
    )
    .sort(compareOptimizationOccurrences)[0];
  if (example === undefined) {
    throw new Error("pointer flow component has no source occurrence");
  }
  for (const blocker of blockers) {
    const existing = fallback.get(blocker);
    if (existing === undefined) {
      fallback.set(blocker, { count: 1, examples: [example] });
    } else {
      existing.count += 1;
      existing.examples.push(example);
    }
  }
}

function sealFallbackEvidence(
  fallback: ReadonlyMap<
    PointerFlowBlocker,
    { readonly count: number; readonly examples: OptimizationOccurrence[] }
  >,
): readonly PointerFlowFallbackEvidence[] {
  return Object.freeze([...fallback]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, evidence]) => Object.freeze({
      reason,
      count: evidence.count,
      examples: Object.freeze(
        [...evidence.examples]
          .sort(compareOptimizationOccurrences)
          .slice(0, 8),
      ),
    })));
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
