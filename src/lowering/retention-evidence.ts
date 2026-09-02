import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "./occurrence.js";

export interface BoundedOptimizationReasonEvidence<Reason extends string> {
  readonly reason: Reason;
  readonly count: number;
  readonly examples: readonly OptimizationOccurrence[];
}

export interface OptimizationRetentionLedger<Reason extends string> {
  readonly count: number;
  record(reason: Reason, node: Node): void;
  seal(): readonly BoundedOptimizationReasonEvidence<Reason>[];
}

export function createOptimizationRetentionLedger<Reason extends string>(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  reasons: readonly Reason[],
  exampleLimit = 8,
): OptimizationRetentionLedger<Reason> {
  const closedReasons = new Set(reasons);
  if (
    reasons.length === 0 ||
    closedReasons.size !== reasons.length ||
    reasons.some((reason) => reason.length === 0) ||
    !Number.isInteger(exampleLimit) ||
    exampleLimit <= 0
  ) {
    throw new Error("retention evidence requires unique reasons and a positive limit");
  }
  const counts = new Map<Reason, number>();
  const examples = new Map<Reason, OptimizationOccurrence[]>();
  let total = 0;
  let sealed = false;
  return Object.freeze({
    get count(): number {
      return total;
    },
    record(reason: Reason, node: Node): void {
      if (sealed) {
        throw new Error("retention evidence is already sealed");
      }
      if (!closedReasons.has(reason)) {
        throw new Error(`unknown retention reason '${reason}'`);
      }
      total += 1;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      const selected = examples.get(reason) ?? [];
      selected.push(optimizationOccurrence(source, node, sourceIdentityFor));
      selected.sort(compareOptimizationOccurrences);
      if (selected.length > exampleLimit) {
        selected.length = exampleLimit;
      }
      examples.set(reason, selected);
    },
    seal(): readonly BoundedOptimizationReasonEvidence<Reason>[] {
      if (sealed) {
        throw new Error("retention evidence was sealed twice");
      }
      sealed = true;
      const summary = Object.freeze(reasons.flatMap((reason) => {
        const count = counts.get(reason) ?? 0;
        return count === 0
          ? []
          : [Object.freeze({
              reason,
              count,
              examples: Object.freeze([...(examples.get(reason) ?? [])]),
            })];
      }));
      if (summary.reduce((sum, row) => sum + row.count, 0) !== total) {
        throw new Error("retention evidence lost a decision row");
      }
      return summary;
    },
  });
}
