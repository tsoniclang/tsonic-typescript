import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { PointerFlowRepresentation } from "./flow-representation.js";
import { pointerNilGuardCanBeElided } from "./nil-guard-ast.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface LocationNilGuardPlan {
  owns(node: Node): boolean;
  readonly count: number;
}

export function planLocationNilGuardElisions(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  representationFor: (node: Node) => PointerFlowRepresentation,
  consumerIsFused: (node: Node) => boolean,
  ledger: PointerPlanningLedger,
): LocationNilGuardPlan {
  const selected = new Set<Node>();
  for (const { node, fact: operation } of facts.operationEntries) {
    ledger.record("projection");
    if (
      (operation.operation !== "load" && operation.operation !== "store") ||
      representationFor(node) !== "location" ||
      consumerIsFused(node) ||
      !pointerNilGuardCanBeElided(source, operation.pointerExpression)
    ) {
      continue;
    }
    selected.add(node);
  }
  return Object.freeze({
    owns(node: Node): boolean {
      return selected.has(node);
    },
    count: selected.size,
  });
}
