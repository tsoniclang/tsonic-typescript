import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { EffectPropagationEvidence } from "./blocker-propagation.js";
import type { CooperativeResultConsumptionEvidence } from "./result-consumption.js";
import type { InterfaceDispatchEvidence } from "./interface-dispatch.js";
import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../occurrence.js";

export const cooperativeEffectFallbackReasons = Object.freeze([
  "escaping-callable",
  "incompatible-return",
  "open-dispatch",
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
  readonly resultConsumption: CooperativeResultConsumptionEvidence;
  readonly interfaceDispatch: InterfaceDispatchEvidence;
}

export interface CooperativeEffectBlockable {
  readonly declaration: Node;
  readonly dependencies: ReadonlySet<CooperativeEffectBlockable>;
  readonly directBlockerNodes: Map<
    CooperativeEffectFallbackReason,
    Set<Node>
  >;
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}

export type CooperativeEffectRetentionDecisions = ReadonlyMap<
  CooperativeEffectBlockable,
  CooperativeEffectFallbackReason
>;

export function blockCooperativeEffect(
  candidate: CooperativeEffectBlockable,
  reason: CooperativeEffectFallbackReason,
  occurrence: Node,
): void {
  const existing = candidate.directBlockerNodes.get(reason);
  if (existing === undefined) {
    candidate.directBlockerNodes.set(reason, new Set([occurrence]));
  } else {
    existing.add(occurrence);
  }
  candidate.blockers.add(reason);
}

export function decideCooperativeEffectRetentions(
  candidates: readonly CooperativeEffectBlockable[],
): CooperativeEffectRetentionDecisions {
  const candidateSet = new Set(candidates);
  const selected = new Map<
    CooperativeEffectBlockable,
    CooperativeEffectFallbackReason
  >();
  for (const candidate of candidates) {
    for (const dependency of candidate.dependencies) {
      if (!candidateSet.has(dependency)) {
        throw new Error("cooperative-effect dependency is outside its candidate set");
      }
    }
    const reason = cooperativeEffectFallbackReasons.find((candidateReason) =>
      candidate.blockers.has(candidateReason)
    );
    if (reason !== undefined) {
      selected.set(candidate, reason);
    }
  }
  for (const candidate of candidates) {
    const decision = selected.get(candidate);
    if (
      (candidate.blockers.size !== 0) !== (decision !== undefined) ||
      (decision !== undefined && !candidate.blockers.has(decision))
    ) {
      throw new Error(
        "cooperative-effect retention decision does not match blocker closure",
      );
    }
  }
  return selected;
}

export function summarizeCooperativeEffects(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  candidates: Iterable<CooperativeEffectBlockable>,
  retentions: CooperativeEffectRetentionDecisions,
  settledCallableCount: number,
  settledAwaitCount: number,
  propagation: EffectPropagationEvidence,
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
    retainedTotal !== retentions.size
  ) {
    throw new Error("cooperative-effect decisions do not partition candidates");
  }
  return Object.freeze({
    candidateCount: all.length,
    settledCallableCount,
    retainedCallableCount: retentions.size,
    settledAwaitCount,
    fallbackReasons: Object.freeze(fallbackReasons),
    propagation,
    resultConsumption,
    interfaceDispatch,
  });
}
