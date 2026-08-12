import type { Node } from "@tsonic/tsts";

import type { PointerFlowBlocker } from "./flow-graph.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

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
  ledger: PointerPlanningLedger,
): void {
  for (const [reason, occurrences] of blockers) {
    ledger.record("evidence");
    const existing = target.get(reason);
    if (existing === undefined) {
      target.set(reason, { count: 1, occurrences: new Set(occurrences) });
      continue;
    }
    existing.count += 1;
    for (const occurrence of occurrences) {
      ledger.record("evidence");
      existing.occurrences.add(occurrence);
    }
  }
}

export function sealFamilyFallback(
  source: ReadonlyMap<
    PointerFlowBlocker,
    { readonly count: number; readonly occurrences: ReadonlySet<Node> }
  >,
  ledger: PointerPlanningLedger,
): readonly DirectReferenceFamilyFallback[] {
  return Object.freeze([...source]
    .sort(([left], [right]) => {
      ledger.record("evidence");
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([reason, evidence]) => {
      ledger.record("evidence");
      const occurrences: Node[] = [];
      for (const occurrence of evidence.occurrences) {
        ledger.record("evidence");
        occurrences.push(occurrence);
      }
      return Object.freeze({
        reason,
        count: evidence.count,
        occurrences: Object.freeze(occurrences),
      });
    }));
}
