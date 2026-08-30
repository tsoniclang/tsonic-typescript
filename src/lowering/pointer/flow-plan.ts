import type {
  PointerOperationFact,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../occurrence.js";
import type { TargetProgramIndex } from "../program-index.js";
import type { ProgramGeneratedNames } from "../generated-names.js";
import {
  canonicalRepresentationTransportContract,
  type RepresentationTransportContract,
} from "../representation/transport-contract.js";
import type { InlineRepresentationTransport } from "../representation/transport-selection.js";
import {
  censusPointerFlows,
} from "./flow-census.js";
import type { DirectObjectReplacement } from "./direct-object-replacement.js";
import {
  planDirectReferenceFamilies,
  type DirectReferenceFamilyPlan,
} from "./flow-families.js";
import {
  retainedDirectReferenceFamilyHotspots,
  type PointerFlowFamilyHotspot,
} from "./flow-family-hotspots.js";
import type { DirectReferenceFamilyFallback } from "./flow-family-evidence.js";
import type {
  PointerFlowBlocker,
  PointerFlowBlockerOccurrence,
  PointerFlowComponent,
} from "./flow-graph.js";
import {
  selectPointerFlowRepresentation,
  type PointerFlowDecision,
  type PointerFlowRepresentation,
} from "./flow-representation.js";
import {
  planPointerProjectionFusions,
  type PointerProjectionFusion,
} from "./projection-fusion.js";
import {
  planProjectedPropertyLocations,
  type ProjectedPropertyLocationFusion,
} from "./projected-property.js";
import {
  planCanonicalPointerKeyMaps,
  type CanonicalPointerKeyMapPlan,
  type CanonicalPointerKeyMapRewrite,
} from "./map/plan.js";
import {
  PointerPlanningLedger,
  totalPointerPlanningOperations,
  type PointerPlanningCandidateCounts,
  type PointerPlanningOperations,
} from "./planning-ledger.js";
import { closePointerValueEvidence } from "./value-evidence.js";

export type { PointerFlowBlocker } from "./flow-graph.js";
export type { PointerFlowRepresentation } from "./flow-representation.js";

const noReplacements = Object.freeze([]) as readonly DirectObjectReplacement[];

interface SelectedDirectObjectReplacements {
  readonly byNode: ReadonlyMap<Node, DirectObjectReplacement>;
  readonly byFile: ReadonlyMap<SourceFile, readonly DirectObjectReplacement[]>;
  readonly count: number;
}

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
  operationFor(node: Node | undefined): PointerOperationFact | undefined;
  valueRepresentationFor(
    node: Node | undefined,
  ): PointerFlowRepresentation | undefined;
  representationFor(node: Node | undefined): PointerFlowRepresentation;
  componentFor(node: Node | undefined): PointerFlowComponentSummary | undefined;
  projectionFusionFor(node: Node): PointerProjectionFusion | undefined;
  ownsFusedProjection(node: Node): boolean;
  projectedPropertyLocationFor(
    node: Node,
  ): ProjectedPropertyLocationFusion | undefined;
  ownsProjectedPropertyAddress(node: Node): boolean;
  directObjectReplacementFor(node: Node): DirectObjectReplacement | undefined;
  directObjectReplacementsFor(sourceFile: SourceFile): readonly DirectObjectReplacement[];
  pointerKeyMapRewriteFor(node: Node): CanonicalPointerKeyMapRewrite | undefined;
  pointerKeyMapsFor(sourceFile: SourceFile): readonly CanonicalPointerKeyMapPlan[];
  representationTransportInlineFor(node: Node): InlineRepresentationTransport | undefined;
  readonly components: readonly PointerFlowComponentSummary[];
  readonly optimizedComponentCount: number;
  readonly optimizedFamilyCount: number;
  readonly retainedFamilyCount: number;
  readonly retainedFamilyHotspots: readonly PointerFlowFamilyHotspot[];
  readonly directObjectReplacementCount: number;
  readonly optimizedProjectionReadCount: number;
  readonly optimizedProjectionStoreCount: number;
  readonly optimizedProjectedPropertyLocationCount: number;
  readonly optimizedPointerKeyMapCount: number;
  readonly representationTransportCallCount: number;
  readonly representationTransportInlineCount: number;
  readonly planningOperationCount: number;
  readonly planningOperations: PointerPlanningOperations;
  readonly planningCandidates: PointerPlanningCandidateCounts;
  readonly representationCounts: Readonly<Record<PointerFlowRepresentation, number>>;
  readonly fallbackReasons: readonly PointerFlowFallbackEvidence[];
  readonly familyFallbackReasons: readonly PointerFlowFallbackEvidence[];
}

export function createClosedPointerFlowPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  generatedNames: ProgramGeneratedNames,
  sourceIdentityFor: SourceIdentityResolver,
  representationTransports: RepresentationTransportContract =
    canonicalRepresentationTransportContract(),
): ClosedPointerFlowPlan {
  const ledger = new PointerPlanningLedger();
  const census = censusPointerFlows(
    source,
    program,
    ledger,
    representationTransports,
  );
  const components = census.components;
  const familyPlan = planDirectReferenceFamilies(
    source,
    program,
    generatedNames,
    components,
    census.facts,
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
    const decision = selectPointerFlowRepresentation(
      source,
      component,
      census.facts,
      (storeCall) =>
        familyPlan.directObjectReplacementForStore(storeCall) !== undefined,
      ledger,
    );
    const representation = finalComponentRepresentation(
      component,
      decision,
      representations,
      ledger,
    );
    for (const node of componentNodes(component)) {
      ledger.record("representation");
      representations.set(node, representation);
    }
    if (representation !== "location") {
      optimizedComponentCount += 1;
    }
    const retention = representation === "location"
      ? componentRetentionEvidence(component, decision, familyPlan, ledger)
      : Object.freeze([]);
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
        ledger,
      ),
    });
    summaries.push(summary);
    for (const node of componentNodes(component)) {
      ledger.record("evidence");
      componentByNode.set(node, summary);
    }
    appendFallbackEvidence(summary.retentionReasons, fallbackReasons, ledger);
  }
  const directObjectReplacements = selectDirectObjectReplacements(
    familyPlan.directObjectReplacements,
    representations,
  );
  const projectionFusions = planPointerProjectionFusions(
    source,
    census.facts,
    (node) => (representations.get(node) ?? "location") === "location",
    ledger,
  );
  const projectedPropertyLocations = planProjectedPropertyLocations(
    source,
    census.facts,
    (node) => node === undefined
      ? "location"
      : representations.get(node) ?? "location",
    projectionFusions.ownsProjection,
    ledger,
  );
  const pointerKeyMaps = planCanonicalPointerKeyMaps(
    source,
    census.facts,
    generatedNames,
    (node) => node === undefined
      ? "location"
      : representations.get(node) ?? "location",
    ledger,
  );
  const frozenSummaries = Object.freeze(summaries);
  const pointerValues = closePointerValueEvidence(
    source,
    census.facts.pointerTypeEntries,
    representations,
    ledger,
  );
  const representationCounts = countRepresentations(frozenSummaries, ledger);
  const sealedFallbackReasons = sealFallbackEvidence(fallbackReasons, ledger);
  const sealedFamilyFallbackReasons = sealFamilyFallbackEvidence(
    source,
    sourceIdentityFor,
    familyPlan.fallbackReasons,
    ledger,
  );
  const retainedFamilyHotspots = retainedDirectReferenceFamilyHotspots(
    source,
    sourceIdentityFor,
    familyPlan.retainedFamilies,
    ledger,
  );
  const planningOperations = ledger.snapshot();
  return Object.freeze({
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    operationFor(node: Node | undefined): PointerOperationFact | undefined {
      return census.facts.operationFor(node);
    },
    valueRepresentationFor(
      node: Node | undefined,
    ): PointerFlowRepresentation | undefined {
      return pointerValues.representationFor(node);
    },
    representationFor(node: Node | undefined): PointerFlowRepresentation {
      return node === undefined
        ? "location"
        : pointerValues.directRepresentationFor(node) ?? "location";
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
    projectedPropertyLocationFor(
      node: Node,
    ): ProjectedPropertyLocationFusion | undefined {
      return projectedPropertyLocations.fusionForProjection(node);
    },
    ownsProjectedPropertyAddress(node: Node): boolean {
      return projectedPropertyLocations.ownsAddress(node);
    },
    directObjectReplacementFor(node: Node): DirectObjectReplacement | undefined {
      return directObjectReplacements.byNode.get(node);
    },
    directObjectReplacementsFor(
      sourceFile: SourceFile,
    ): readonly DirectObjectReplacement[] {
      return directObjectReplacements.byFile.get(sourceFile) ?? noReplacements;
    },
    pointerKeyMapRewriteFor(
      node: Node,
    ): CanonicalPointerKeyMapRewrite | undefined {
      return pointerKeyMaps.rewriteFor(node);
    },
    pointerKeyMapsFor(
      sourceFile: SourceFile,
    ): readonly CanonicalPointerKeyMapPlan[] {
      return pointerKeyMaps.classesFor(sourceFile);
    },
    representationTransportInlineFor(node: Node): InlineRepresentationTransport | undefined {
      return census.representationTransportCalls.get(node)?.inline;
    },
    components: frozenSummaries,
    optimizedComponentCount,
    optimizedFamilyCount: familyPlan.familyCount,
    retainedFamilyCount: familyPlan.retainedFamilies.length,
    retainedFamilyHotspots,
    directObjectReplacementCount: directObjectReplacements.count,
    optimizedProjectionReadCount: projectionFusions.readCount,
    optimizedProjectionStoreCount: projectionFusions.storeCount,
    optimizedProjectedPropertyLocationCount: projectedPropertyLocations.count,
    optimizedPointerKeyMapCount: pointerKeyMaps.count,
    representationTransportCallCount: census.representationTransportCallCount,
    representationTransportInlineCount: census.representationTransportInlineCount,
    planningOperationCount: totalPointerPlanningOperations(planningOperations),
    planningOperations,
    planningCandidates: ledger.candidateSnapshot(),
    representationCounts,
    fallbackReasons: sealedFallbackReasons,
    familyFallbackReasons: sealedFamilyFallbackReasons,
  });
}

function selectDirectObjectReplacements(
  candidates: readonly DirectObjectReplacement[],
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
): SelectedDirectObjectReplacements {
  const byNode = new Map<Node, DirectObjectReplacement>();
  const mutableByFile = new Map<SourceFile, DirectObjectReplacement[]>();
  let count = 0;
  for (const candidate of candidates) {
    const storeCalls = candidate.storeCalls.filter((storeCall) =>
      representations.get(storeCall) === "direct-object"
    );
    if (storeCalls.length === 0) {
      continue;
    }
    const replacement: DirectObjectReplacement = Object.freeze({
      ...candidate,
      storeCalls: Object.freeze(storeCalls),
    });
    if (byNode.has(replacement.classDeclaration)) {
      throw new Error("direct-object class selected multiple replacement plans");
    }
    byNode.set(replacement.classDeclaration, replacement);
    for (const storeCall of replacement.storeCalls) {
      if (byNode.has(storeCall)) {
        throw new Error("direct-object store selected multiple replacement plans");
      }
      byNode.set(storeCall, replacement);
    }
    const selected = mutableByFile.get(replacement.sourceFile);
    if (selected === undefined) {
      mutableByFile.set(replacement.sourceFile, [replacement]);
    } else {
      selected.push(replacement);
    }
    count += 1;
  }
  const byFile = new Map<SourceFile, readonly DirectObjectReplacement[]>();
  for (const [sourceFile, replacements] of mutableByFile) {
    byFile.set(sourceFile, Object.freeze([...replacements]));
  }
  return Object.freeze({ byNode, byFile, count });
}

function sealFamilyFallbackEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  fallback: readonly DirectReferenceFamilyFallback[],
  ledger: PointerPlanningLedger,
): readonly PointerFlowFallbackEvidence[] {
  return Object.freeze(fallback.map((entry) => {
    ledger.record("evidence");
    return Object.freeze({
      reason: entry.reason,
      count: entry.count,
      examples: Object.freeze(entry.occurrences.map((node) => {
        ledger.record("evidence");
        return optimizationOccurrence(source, node, sourceIdentityFor);
      }).sort((left, right) => {
        ledger.record("evidence");
        return compareOptimizationOccurrences(left, right);
      }).slice(0, 8)),
    });
  }));
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
  ledger: PointerPlanningLedger,
): PointerFlowRepresentation {
  const selected = new Set<PointerFlowRepresentation>();
  for (const node of componentRepresentationNodes(component)) {
    ledger.record("representation");
    const representation = representations.get(node);
    if (representation !== undefined) {
      selected.add(representation);
    }
  }
  if (
    decision.representation !== "location" &&
    !selected.has("location")
  ) {
    return decision.representation;
  }
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
  ledger: PointerPlanningLedger,
): readonly PointerFlowBlockerOccurrence[] {
  const evidence = new Map<PointerFlowBlocker, Set<Node>>();
  appendRetention(evidence, decision.blockerEvidence, ledger);
  for (const node of componentRepresentationNodes(component)) {
    ledger.record("evidence");
    const familyEvidence = familyPlan.canonicalRetentionFor(node);
    if (familyEvidence === undefined) {
      continue;
    }
    appendRetention(evidence, familyEvidence, ledger);
  }
  return Object.freeze([...evidence]
    .sort(([left], [right]) => {
      ledger.record("evidence");
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([reason, occurrences]) => Object.freeze({
      reason,
      occurrences: Object.freeze([...occurrences]),
    })));
}

function appendRetention(
  target: Map<PointerFlowBlocker, Set<Node>>,
  source: readonly PointerFlowBlockerOccurrence[],
  ledger: PointerPlanningLedger,
): void {
  for (const entry of source) {
    ledger.record("evidence");
    const occurrences = target.get(entry.reason);
    if (occurrences === undefined) {
      target.set(entry.reason, new Set(entry.occurrences));
    } else {
      for (const occurrence of entry.occurrences) {
        ledger.record("evidence");
        occurrences.add(occurrence);
      }
    }
  }
}

function sealComponentRetention(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  retention: readonly PointerFlowBlockerOccurrence[],
  ledger: PointerPlanningLedger,
): readonly PointerFlowRetentionEvidence[] {
  return Object.freeze(retention.map((entry) => {
    ledger.record("evidence");
    return Object.freeze({
      reason: entry.reason,
      occurrences: Object.freeze(entry.occurrences.map((node) => {
        ledger.record("evidence");
        return optimizationOccurrence(source, node, sourceIdentityFor);
      }).sort((left, right) => {
        ledger.record("evidence");
        return compareOptimizationOccurrences(left, right);
      })),
    });
  }));
}

function countRepresentations(
  components: readonly PointerFlowComponentSummary[],
  ledger: PointerPlanningLedger,
): Readonly<Record<PointerFlowRepresentation, number>> {
  const counts: Record<PointerFlowRepresentation, number> = {
    location: 0,
    "direct-snapshot": 0,
    "mutable-cell": 0,
    "direct-object": 0,
  };
  for (const component of components) {
    ledger.record("evidence");
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
  ledger: PointerPlanningLedger,
): void {
  for (const blocker of retention) {
    ledger.record("evidence");
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
  ledger: PointerPlanningLedger,
): readonly PointerFlowFallbackEvidence[] {
  return Object.freeze([...fallback]
    .sort(([left], [right]) => {
      ledger.record("evidence");
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([reason, evidence]) => {
      ledger.record("evidence");
      const examples: OptimizationOccurrence[] = [];
      for (const example of evidence.examples) {
        ledger.record("evidence");
        examples.push(example);
      }
      return Object.freeze({
        reason,
        count: evidence.count,
        examples: Object.freeze(
          examples
            .sort((left, right) => {
              ledger.record("evidence");
              return compareOptimizationOccurrences(left, right);
            })
            .slice(0, 8),
        ),
      });
    }));
}
