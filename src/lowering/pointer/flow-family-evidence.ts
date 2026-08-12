import type { Node } from "@tsonic/tsts";

import type { PointerFlowBlocker } from "./flow-graph.js";

export interface DirectReferenceFamilyFallback {
  readonly reason: PointerFlowBlocker;
  readonly count: number;
  readonly occurrences: readonly Node[];
}

export type FamilyFallbackLedger = Map<
  PointerFlowBlocker,
  { count: number; occurrences: Set<Node> }
>;

export function appendFamilyFallback(
  target: FamilyFallbackLedger,
  blockers: ReadonlyMap<PointerFlowBlocker, ReadonlySet<Node>>,
): void {
  for (const [reason, occurrences] of blockers) {
    const existing = target.get(reason);
    if (existing === undefined) {
      target.set(reason, { count: 1, occurrences: new Set(occurrences) });
      continue;
    }
    existing.count += 1;
    for (const occurrence of occurrences) {
      existing.occurrences.add(occurrence);
    }
  }
}

export function sealFamilyFallback(
  source: ReadonlyMap<
    PointerFlowBlocker,
    { readonly count: number; readonly occurrences: ReadonlySet<Node> }
  >,
): readonly DirectReferenceFamilyFallback[] {
  return Object.freeze([...source]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, evidence]) => Object.freeze({
      reason,
      count: evidence.count,
      occurrences: Object.freeze([...evidence.occurrences]),
    })));
}
