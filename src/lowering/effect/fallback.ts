import type { EffectPropagationEvidence } from "./blocker-propagation.js";

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
}

export interface CooperativeEffectPlanSummary {
  readonly candidateCount: number;
  readonly settledCallableCount: number;
  readonly retainedCallableCount: number;
  readonly settledAwaitCount: number;
  readonly fallbackReasons: readonly CooperativeEffectFallbackEvidence[];
  readonly propagation: EffectPropagationEvidence;
}

export interface CooperativeEffectBlockable {
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
  for (const candidate of all) {
    for (const reason of candidate.directBlockers) {
      directCounts.set(reason, (directCounts.get(reason) ?? 0) + 1);
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
