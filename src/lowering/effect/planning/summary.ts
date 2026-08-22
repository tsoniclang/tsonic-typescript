import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { EffectPropagationEvidence } from "../closure/blocker-propagation.js";
import {
  cooperativeEffectFallbackReasons,
  type CooperativeEffectBlockable,
  type CooperativeEffectFallbackReason,
  type CooperativeEffectRetentionDecisions,
} from "../closure/retention.js";
import type { InterfaceDispatchEvidence } from "../flow/interface/decision.js";
import type { CooperativeResultConsumptionEvidence } from "../flow/return/result-consumption.js";
import type { CooperativeAwaitAttribution } from "../inventory/awaits.js";
import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../../occurrence.js";

export interface CooperativeEffectFallbackEvidence {
  readonly reason: CooperativeEffectFallbackReason;
  readonly directCallableCount: number;
  readonly retainedCallableCount: number;
  readonly directExamples: readonly CooperativeEffectFallbackOccurrence[];
}

export type CooperativeEffectFallbackOccurrence = OptimizationOccurrence;

export interface CooperativeEffectPlanSummary {
  readonly candidateCount: number;
  readonly settledCallableCount: number;
  readonly retainedCallableCount: number;
  readonly settledAwaitCount: number;
  readonly awaitAttribution: CooperativeAwaitAttribution;
  readonly fallbackReasons: readonly CooperativeEffectFallbackEvidence[];
  readonly propagation: EffectPropagationEvidence;
  readonly resultConsumption: CooperativeResultConsumptionEvidence;
  readonly interfaceDispatch: InterfaceDispatchEvidence;
}

export function summarizeCooperativeEffects(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  candidates: Iterable<CooperativeEffectBlockable>,
  retentions: CooperativeEffectRetentionDecisions,
  settledCallableCount: number,
  settledAwaitCount: number,
  propagation: EffectPropagationEvidence,
  awaitAttribution: CooperativeAwaitAttribution,
  resultConsumption: CooperativeResultConsumptionEvidence,
  interfaceDispatch: InterfaceDispatchEvidence,
): CooperativeEffectPlanSummary {
  const all = [...candidates];
  const directCounts = new Map<CooperativeEffectFallbackReason, number>();
  const retainedCounts = new Map<CooperativeEffectFallbackReason, number>();
  const directExamples = new Map<
    CooperativeEffectFallbackReason,
    CooperativeEffectFallbackOccurrence[]
  >();
  for (const candidate of all) {
    for (const [reason, nodes] of candidate.directBlockerNodes) {
      directCounts.set(reason, (directCounts.get(reason) ?? 0) + 1);
      const occurrences = [...nodes].map((node) =>
        optimizationOccurrence(source, node, sourceIdentityFor)
      );
      const examples = directExamples.get(reason);
      if (examples === undefined) {
        directExamples.set(reason, occurrences);
      } else {
        examples.push(...occurrences);
      }
    }
    const retained = retentions.get(candidate);
    if (retained !== undefined) {
      retainedCounts.set(retained, (retainedCounts.get(retained) ?? 0) + 1);
    }
  }
  const fallbackReasons = cooperativeEffectFallbackReasons.flatMap((reason) => {
    const directCallableCount = directCounts.get(reason) ?? 0;
    const retainedCallableCount = retainedCounts.get(reason) ?? 0;
    return retainedCallableCount === 0 && directCallableCount === 0
      ? []
      : [Object.freeze({
          reason,
          directCallableCount,
          retainedCallableCount,
          directExamples: Object.freeze(
            [...directExamples.get(reason) ?? []]
              .sort(compareOptimizationOccurrences)
              .slice(0, 8),
          ),
        })];
  });
  const retainedTotal = fallbackReasons.reduce(
    (total, entry) => total + entry.retainedCallableCount,
    0,
  );
  if (
    settledCallableCount + retentions.size !== all.length ||
    retainedTotal !== retentions.size ||
    settledAwaitCount !== awaitAttribution.settledAwaitCount
  ) {
    throw new Error("cooperative-effect decisions do not partition candidates");
  }
  return Object.freeze({
    candidateCount: all.length,
    settledCallableCount,
    retainedCallableCount: retentions.size,
    settledAwaitCount,
    awaitAttribution,
    fallbackReasons: Object.freeze(fallbackReasons),
    propagation,
    resultConsumption,
    interfaceDispatch,
  });
}
