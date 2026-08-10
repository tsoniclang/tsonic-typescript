import type { EffectPropagationEvidence } from "./blocker-propagation.js";
import {
  compareOptimizationOccurrences,
  type OptimizationOccurrence,
} from "../occurrence.js";

export const cooperativeEffectFallbackReasons = Object.freeze([
  "escaping-callable",
  "incompatible-return",
  "promise-observed",
  "promise-producing-return",
  "unresolved-call",
] as const);

export type CooperativeEffectFallbackReason =
  typeof cooperativeEffectFallbackReasons[number];

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
  readonly fallbackReasons: readonly CooperativeEffectFallbackEvidence[];
  readonly propagation: EffectPropagationEvidence;
}

export interface CooperativeEffectBlockable {
  readonly occurrence: CooperativeEffectFallbackOccurrence;
  readonly directBlockers: Set<CooperativeEffectFallbackReason>;
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}

export function blockCooperativeEffect(
  candidate: CooperativeEffectBlockable,
  reason: CooperativeEffectFallbackReason,
): void {
  candidate.directBlockers.add(reason);
  candidate.blockers.add(reason);
}

export function summarizeCooperativeEffects(
  candidates: Iterable<CooperativeEffectBlockable>,
  settledCallableCount: number,
  settledAwaitCount: number,
  propagation: EffectPropagationEvidence,
): CooperativeEffectPlanSummary {
  const all = [...candidates];
  const directCounts = new Map<CooperativeEffectFallbackReason, number>();
  const retainedCounts = new Map<CooperativeEffectFallbackReason, number>();
  const directExamples = new Map<
    CooperativeEffectFallbackReason,
    CooperativeEffectFallbackOccurrence[]
  >();
  for (const candidate of all) {
    for (const reason of candidate.directBlockers) {
      directCounts.set(reason, (directCounts.get(reason) ?? 0) + 1);
      const examples = directExamples.get(reason);
      if (examples === undefined) {
        directExamples.set(reason, [candidate.occurrence]);
      } else {
        examples.push(candidate.occurrence);
      }
    }
    for (const reason of candidate.blockers) {
      retainedCounts.set(reason, (retainedCounts.get(reason) ?? 0) + 1);
    }
  }
  const fallbackReasons = cooperativeEffectFallbackReasons.flatMap((reason) => {
    const directCallableCount = directCounts.get(reason) ?? 0;
    const retainedCallableCount = retainedCounts.get(reason) ?? 0;
    return retainedCallableCount === 0
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
  return Object.freeze({
    candidateCount: all.length,
    settledCallableCount,
    retainedCallableCount: all.length - settledCallableCount,
    settledAwaitCount,
    fallbackReasons: Object.freeze(fallbackReasons),
    propagation,
  });
}
