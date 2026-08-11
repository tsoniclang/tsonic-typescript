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
import type { DirectReferenceFamilyFallback } from "./flow-family-evidence.js";
import type {
  PointerFlowBlocker,
  PointerFlowBlockerOccurrence,
  PointerFlowComponent,
} from "./flow-graph.js";
import { describePointerPointee } from "./pointee-classification.js";
import {
  planPointerProjectionFusions,
  type PointerProjectionFusion,
} from "./projection-fusion.js";

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
  projectionFusionFor(node: Node): PointerProjectionFusion | undefined;
  ownsFusedProjection(node: Node): boolean;
  readonly components: readonly PointerFlowComponentSummary[];
  readonly optimizedComponentCount: number;
  readonly optimizedFamilyCount: number;
  readonly optimizedProjectionReadCount: number;
  readonly optimizedProjectionStoreCount: number;
  readonly fallbackReasons: readonly PointerFlowFallbackEvidence[];
  readonly familyFallbackReasons: readonly PointerFlowFallbackEvidence[];
}

interface PointerFlowDecision {
  readonly representation: PointerFlowRepresentation;
  readonly blockers: readonly PointerFlowBlocker[];
  readonly blockerEvidence: readonly PointerFlowBlockerOccurrence[];
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
        representations.set(vertex.node, representations.get(vertex.node) ?? representation);
      }
      for (const operation of component.operations) {
        representations.set(operation, representations.get(operation) ?? representation);
      }
      for (const pointerType of component.pointerTypes) {
        representations.set(pointerType, representations.get(pointerType) ?? representation);
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
      decision,
      fallbackReasons,
    );
  }
  const projectionFusions = planPointerProjectionFusions(
    source,
    nodes,
    (node) => (representations.get(node) ?? "location") === "location",
  );
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
    projectionFusionFor(node: Node): PointerProjectionFusion | undefined {
      return projectionFusions.fusionForConsumer(node);
    },
    ownsFusedProjection(node: Node): boolean {
      return projectionFusions.ownsProjection(node);
    },
    components: frozenSummaries,
    optimizedComponentCount,
    optimizedFamilyCount: familyPlan.familyCount,
    optimizedProjectionReadCount: projectionFusions.readCount,
    optimizedProjectionStoreCount: projectionFusions.storeCount,
    fallbackReasons: sealFallbackEvidence(fallbackReasons),
    familyFallbackReasons: sealFamilyFallbackEvidence(
      source,
      sourceIdentityFor,
      familyPlan.fallbackReasons,
    ),
  });
}

function sealFamilyFallbackEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  fallback: readonly DirectReferenceFamilyFallback[],
): readonly PointerFlowFallbackEvidence[] {
  return Object.freeze(fallback.map((entry) => Object.freeze({
    reason: entry.reason,
    count: entry.count,
    examples: Object.freeze(entry.occurrences.map((node) =>
      optimizationOccurrence(source, node, sourceIdentityFor)
    ).sort(compareOptimizationOccurrences).slice(0, 8)),
  })));
}

function appendFallbackEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  decision: PointerFlowDecision,
  fallback: Map<
    PointerFlowBlocker,
    { count: number; examples: OptimizationOccurrence[] }
  >,
): void {
  for (const blocker of decision.blockerEvidence) {
    const examples = blocker.occurrences.map((node) =>
      optimizationOccurrence(source, node, sourceIdentityFor)
    );
    if (examples.length === 0) {
      throw new Error(`pointer fallback '${blocker.reason}' has no occurrence`);
    }
    const existing = fallback.get(blocker.reason);
    if (existing === undefined) {
      fallback.set(blocker.reason, { count: 1, examples: [...examples] });
    } else {
      existing.count += 1;
      existing.examples.push(...examples);
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
    return locationDecision(
      component,
      "unsupported-producer",
      componentAnchors(component),
    );
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
    return locationDecision(
      component,
      "unsupported-pointee",
      component.pointees.map((evidence) => evidence.anchor),
    );
  }
  const category = description.category;
  const operations = component.operations.map((node) =>
    source.sourceFacts.getFact(node, pointerOperationFactKey)
  );
  if (operations.some((operation) => operation === undefined)) {
    return locationDecision(
      component,
      "unsupported-flow",
      component.operations.filter((node, index) => operations[index] === undefined),
    );
  }
  const hasStore = operations.some((operation) => operation?.operation === "store");
  const producersAreDirect = component.producers.every((producer) =>
    producer.operation === "allocate" || producer.operation === "address-of"
  );
  if (!producersAreDirect) {
    return locationDecision(
      component,
      "unsupported-producer",
      component.producers.map((producer) => producer.call),
    );
  }
  if (hasStore) {
    const representation = component.producers.every(
        (producer) => producer.operation === "allocate",
      ) && (category === "scalar" || category === "direct-reference")
      ? "mutable-cell"
      : "location";
    return representation === "location"
      ? locationDecision(
          component,
          "unsupported-flow",
          component.operations.filter((node) =>
            source.sourceFacts.getFact(node, pointerOperationFactKey)
              ?.operation === "store"
          ),
        )
      : optimizedDecision(representation);
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
  blocker?: PointerFlowBlocker,
  occurrences: readonly Node[] = [],
): PointerFlowDecision {
  const evidence = new Map<PointerFlowBlocker, Set<Node>>(
    component.blockerEvidence.map((entry) => [
      entry.reason,
      new Set(entry.occurrences),
    ]),
  );
  if (blocker !== undefined) {
    const selected = occurrences.length === 0
      ? componentAnchors(component)
      : occurrences;
    const existing = evidence.get(blocker);
    if (existing === undefined) {
      evidence.set(blocker, new Set(selected));
    } else {
      for (const occurrence of selected) {
        existing.add(occurrence);
      }
    }
  }
  for (const reason of component.blockers) {
    if (!evidence.has(reason)) {
      throw new Error(`pointer blocker '${reason}' has no exact occurrence`);
    }
  }
  const blockerEvidence = [...evidence]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
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

function componentAnchors(component: PointerFlowComponent): readonly Node[] {
  const anchors = component.vertices.map((vertex) => vertex.node);
  if (anchors.length === 0) {
    throw new Error("pointer flow component has no source anchor");
  }
  return anchors;
}
