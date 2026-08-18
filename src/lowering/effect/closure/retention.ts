import type { Node } from "@tsonic/tsts";

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
