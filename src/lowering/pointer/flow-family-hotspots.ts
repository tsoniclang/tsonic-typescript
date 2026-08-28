import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../occurrence.js";
import type { DirectReferenceFamilyRetention } from "./flow-families.js";
import type { PointerFlowBlocker } from "./flow-graph.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

const retainedFamilyHotspotLimit = 32;
const retainedFamilyExampleLimit = 8;

export interface PointerFlowFamilyHotspotReason {
  readonly reason: PointerFlowBlocker;
  readonly occurrenceCount: number;
  readonly examples: readonly OptimizationOccurrence[];
}

export interface PointerFlowFamilyHotspot {
  readonly identity: OptimizationOccurrence;
  readonly pointerTypeCount: number;
  readonly operationCount: number;
  readonly reasons: readonly PointerFlowFamilyHotspotReason[];
}

export function retainedDirectReferenceFamilyHotspots(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  retainedFamilies: readonly DirectReferenceFamilyRetention[],
  ledger: PointerPlanningLedger,
): readonly PointerFlowFamilyHotspot[] {
  const hotspots = retainedFamilies.map((family) => {
    ledger.record("evidence");
    return Object.freeze({
      identity: optimizationOccurrence(
        source,
        family.identity,
        sourceIdentityFor,
      ),
      pointerTypeCount: family.pointerTypeCount,
      operationCount: family.operationCount,
      reasons: sealReasons(
        source,
        sourceIdentityFor,
        family.blockerEvidence,
        ledger,
      ),
    });
  });
  hotspots.sort((left, right) => {
    ledger.record("evidence");
    const leftCount = left.pointerTypeCount + left.operationCount;
    const rightCount = right.pointerTypeCount + right.operationCount;
    return rightCount - leftCount ||
      right.operationCount - left.operationCount ||
      compareOptimizationOccurrences(left.identity, right.identity);
  });
  return Object.freeze(hotspots.slice(0, retainedFamilyHotspotLimit));
}

function sealReasons(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  evidence: readonly {
    readonly reason: PointerFlowBlocker;
    readonly occurrences: readonly Node[];
  }[],
  ledger: PointerPlanningLedger,
): readonly PointerFlowFamilyHotspotReason[] {
  return Object.freeze(evidence.map((entry) => {
    ledger.record("evidence");
    const examples = entry.occurrences.map((node) => {
      ledger.record("evidence");
      return optimizationOccurrence(source, node, sourceIdentityFor);
    });
    examples.sort((left, right) => {
      ledger.record("evidence");
      return compareOptimizationOccurrences(left, right);
    });
    return Object.freeze({
      reason: entry.reason,
      occurrenceCount: entry.occurrences.length,
      examples: Object.freeze(examples.slice(0, retainedFamilyExampleLimit)),
    });
  }));
}
