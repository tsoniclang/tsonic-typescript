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
import type { TargetProgramIndex } from "../program-index.js";
import {
  censusPointerFlows,
} from "./flow-census.js";
import {
  planDirectReferenceFamilies,
  type DirectReferenceFamilyPlan,
} from "./flow-families.js";
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
import {
  PointerPlanningLedger,
  totalPointerPlanningOperations,
  type PointerPlanningOperations,
} from "./planning-ledger.js";

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
  readonly retentionReasons: readonly PointerFlowRetentionEvidence[];
}

export interface PointerFlowRetentionEvidence {
  readonly reason: PointerFlowBlocker;
  readonly occurrences: readonly OptimizationOccurrence[];
}

export interface PointerFlowFallbackEvidence {
  readonly reason: PointerFlowBlocker;
  readonly count: number;
  readonly examples: readonly OptimizationOccurrence[];
}

export interface ClosedPointerFlowPlan {
  owns(source: TargetSourceProgram): boolean;
  representationFor(node: Node | undefined): PointerFlowRepresentation;
  componentFor(node: Node | undefined): PointerFlowComponentSummary | undefined;
  projectionFusionFor(node: Node): PointerProjectionFusion | undefined;
  ownsFusedProjection(node: Node): boolean;
  readonly components: readonly PointerFlowComponentSummary[];
  readonly optimizedComponentCount: number;
  readonly optimizedFamilyCount: number;
  readonly optimizedProjectionReadCount: number;
  readonly optimizedProjectionStoreCount: number;
  readonly planningOperationCount: number;
  readonly planningOperations: PointerPlanningOperations;
  readonly representationCounts: Readonly<Record<PointerFlowRepresentation, number>>;
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
  program: TargetProgramIndex,
  sourceIdentityFor: SourceIdentityResolver,
): ClosedPointerFlowPlan {
  const ledger = new PointerPlanningLedger();
  const census = censusPointerFlows(source, program, ledger);
  const components = census.components;
  const familyPlan = planDirectReferenceFamilies(
    source,
    program,
    components,
    ledger,
  );
  const representations = new Map<Node, PointerFlowRepresentation>(
    familyPlan.representations,
  );
  const summaries: PointerFlowComponentSummary[] = [];
  const componentByNode = new Map<Node, PointerFlowComponentSummary>();
  const fallbackReasons = new Map<
    PointerFlowBlocker,
    { count: number; examples: OptimizationOccurrence[] }
  >();
  let optimizedComponentCount = 0;
  for (const component of components) {
    ledger.record("representation");
    const decision = selectRepresentation(source, component);
    const representation = finalComponentRepresentation(
      component,
      decision,
      representations,
    );
    for (const node of componentNodes(component)) {
      representations.set(node, representation);
    }
    if (representation !== "location") {
      optimizedComponentCount += 1;
    }
    const retention = representation === "location"
      ? componentRetentionEvidence(component, decision, familyPlan)
      : Object.freeze([]);
    ledger.record(
      "evidence",
      component.vertices.length +
        component.operations.length +
        component.pointerTypes.length +
        retention.reduce(
          (count, entry) => count + 1 + entry.occurrences.length,
          0,
        ),
    );
    if (representation === "location" && retention.length === 0) {
      throw new Error("canonical pointer component has no exact retention reason");
    }
    const summary: PointerFlowComponentSummary = Object.freeze({
      representation,
      vertexCount: component.vertices.length,
      operationCount: component.operations.length,
      pointerTypeCount: component.pointerTypes.length,
      blockers: Object.freeze(retention.map((entry) => entry.reason)),
      retentionReasons: sealComponentRetention(
        source,
        sourceIdentityFor,
        retention,
      ),
    });
    summaries.push(summary);
    for (const node of componentNodes(component)) {
      componentByNode.set(node, summary);
    }
    appendFallbackEvidence(summary.retentionReasons, fallbackReasons);
  }
  const projectionFusions = planPointerProjectionFusions(
    source,
    program,
    (node) => (representations.get(node) ?? "location") === "location",
    ledger,
  );
  const frozenSummaries = Object.freeze(summaries);
  const representationCounts = countRepresentations(frozenSummaries);
  ledger.record(
    "evidence",
    frozenSummaries.length + fallbackReasons.size,
  );
  const planningOperations = ledger.snapshot();
  return Object.freeze({
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    representationFor(node: Node | undefined): PointerFlowRepresentation {
      return node === undefined
        ? "location"
        : representations.get(node) ?? "location";
    },
    componentFor(node: Node | undefined): PointerFlowComponentSummary | undefined {
      return node === undefined ? undefined : componentByNode.get(node);
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
    planningOperationCount: totalPointerPlanningOperations(planningOperations),
    planningOperations,
    representationCounts,
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

function componentRepresentationNodes(
  component: PointerFlowComponent,
): readonly Node[] {
  return [...component.operations, ...component.pointerTypes];
}

function componentNodes(component: PointerFlowComponent): readonly Node[] {
  return [
    ...component.vertices.map((vertex) => vertex.node),
    ...componentRepresentationNodes(component),
  ];
}

function finalComponentRepresentation(
  component: PointerFlowComponent,
  decision: PointerFlowDecision,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
): PointerFlowRepresentation {
  const selected = new Set(componentRepresentationNodes(component).flatMap((node) => {
    const representation = representations.get(node);
    return representation === undefined ? [] : [representation];
  }));
  if (selected.size === 0) {
    return decision.representation;
  }
  if (selected.has("location")) {
    return "location";
  }
  if (selected.size !== 1) {
    throw new Error("pointer component selected multiple representations");
  }
  const representation = [...selected][0];
  if (representation === undefined) {
    throw new Error("pointer component lost its selected representation");
  }
  return representation;
}

function componentRetentionEvidence(
  component: PointerFlowComponent,
  decision: PointerFlowDecision,
  familyPlan: DirectReferenceFamilyPlan,
): readonly PointerFlowBlockerOccurrence[] {
  const evidence = new Map<PointerFlowBlocker, Set<Node>>();
  appendRetention(evidence, decision.blockerEvidence);
  for (const node of componentRepresentationNodes(component)) {
    const familyEvidence = familyPlan.canonicalRetentionFor(node);
    if (familyEvidence === undefined) {
      continue;
    }
    appendRetention(evidence, familyEvidence);
  }
  return Object.freeze([...evidence]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, occurrences]) => Object.freeze({
      reason,
      occurrences: Object.freeze([...occurrences]),
    })));
}

function appendRetention(
  target: Map<PointerFlowBlocker, Set<Node>>,
  source: readonly PointerFlowBlockerOccurrence[],
): void {
  for (const entry of source) {
    const occurrences = target.get(entry.reason);
    if (occurrences === undefined) {
      target.set(entry.reason, new Set(entry.occurrences));
    } else {
      for (const occurrence of entry.occurrences) {
        occurrences.add(occurrence);
      }
    }
  }
}

function sealComponentRetention(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  retention: readonly PointerFlowBlockerOccurrence[],
): readonly PointerFlowRetentionEvidence[] {
  return Object.freeze(retention.map((entry) => Object.freeze({
    reason: entry.reason,
    occurrences: Object.freeze(entry.occurrences.map((node) =>
      optimizationOccurrence(source, node, sourceIdentityFor)
    ).sort(compareOptimizationOccurrences)),
  })));
}

function countRepresentations(
  components: readonly PointerFlowComponentSummary[],
): Readonly<Record<PointerFlowRepresentation, number>> {
  const counts: Record<PointerFlowRepresentation, number> = {
    location: 0,
    "direct-snapshot": 0,
    "mutable-cell": 0,
    "direct-object": 0,
  };
  for (const component of components) {
    counts[component.representation] += 1;
  }
  return Object.freeze(counts);
}

function appendFallbackEvidence(
  retention: readonly PointerFlowRetentionEvidence[],
  fallback: Map<
    PointerFlowBlocker,
    { count: number; examples: OptimizationOccurrence[] }
  >,
): void {
  for (const blocker of retention) {
    const examples = blocker.occurrences;
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
