import type { Node, PointerOperationFact, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { OptimizationOccurrence } from "../occurrence.js";
import type {
  InlineRepresentationTransport,
} from "../representation/transport-selection.js";
import type { DirectObjectReplacement } from "./direct-object-replacement.js";
import type { PointerFlowFamilyHotspot } from "./flow-family-hotspots.js";
import type { PointerFlowBlocker } from "./flow-graph.js";
import type { PointerFlowRepresentation } from "./flow-representation.js";
import type {
  CanonicalPointerKeyMapPlan,
  CanonicalPointerKeyMapRewrite,
} from "./map/plan.js";
import type {
  PointerPlanningCandidateCounts,
  PointerPlanningOperations,
} from "./planning-ledger.js";
import type { PointerProjectionFusion } from "./projection-fusion.js";
import type {
  ProjectedPropertyLocationFusion,
} from "./projected-property.js";

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
  directObjectReplacementsFor(
    sourceFile: SourceFile,
  ): readonly DirectObjectReplacement[];
  pointerKeyMapRewriteFor(node: Node): CanonicalPointerKeyMapRewrite | undefined;
  pointerKeyMapsFor(sourceFile: SourceFile): readonly CanonicalPointerKeyMapPlan[];
  representationTransportInlineFor(
    node: Node,
  ): InlineRepresentationTransport | undefined;
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
