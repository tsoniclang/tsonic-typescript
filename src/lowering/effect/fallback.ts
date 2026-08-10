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
  readonly callableCount: number;
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
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}

export function blockCooperativeEffect(
  candidate: CooperativeEffectBlockable,
  reason: CooperativeEffectFallbackReason,
): void {
  candidate.blockers.add(reason);
}

export function summarizeCooperativeEffects(
  candidates: Iterable<CooperativeEffectBlockable>,
  settledCallableCount: number,
  settledAwaitCount: number,
  propagation: EffectPropagationEvidence,
): CooperativeEffectPlanSummary {
  const all = [...candidates];
  const counts = new Map<CooperativeEffectFallbackReason, number>();
  for (const candidate of all) {
    for (const reason of candidate.blockers) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  const fallbackReasons = cooperativeEffectFallbackReasons.flatMap((reason) => {
    const callableCount = counts.get(reason) ?? 0;
    return callableCount === 0
      ? []
      : [Object.freeze({ reason, callableCount })];
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
