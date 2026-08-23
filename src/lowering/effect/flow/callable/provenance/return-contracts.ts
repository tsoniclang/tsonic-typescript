import type { Node } from "@tsonic/tsts";

import type { CallableReturnRewrite } from "../../../model/callable-contract.js";
import type { CallableState } from "../provenance-flow.js";

export interface MutableCallableReturnContract {
  readonly rewrite: CallableReturnRewrite;
  readonly states: CallableState[];
  readonly sources: CallableReturnContractSource[];
}

export type CallableReturnContractSourceKind =
  | "call-result"
  | "callable-value";

export interface CallableReturnContractSource {
  readonly expression: Node;
  readonly kind: CallableReturnContractSourceKind;
}

export function appendReturnTypeContract(
  target: Map<Node, MutableCallableReturnContract>,
  rewrite: CallableReturnRewrite,
  state: CallableState,
  sources: readonly CallableReturnContractSource[],
): void {
  const existing = target.get(rewrite.target);
  if (existing === undefined) {
    target.set(rewrite.target, {
      rewrite,
      states: [state],
      sources: [...sources],
    });
    return;
  }
  if (
    existing.rewrite.selection.kind !== rewrite.selection.kind ||
    existing.rewrite.selection.index !== rewrite.selection.index
  ) {
    throw new Error("callable return contract has conflicting exact selections");
  }
  if (!existing.states.includes(state)) {
    existing.states.push(state);
  }
  for (const source of sources) {
    if (!existing.sources.some(({ expression, kind }) =>
      expression === source.expression && kind === source.kind
    )) {
      existing.sources.push(source);
    }
  }
}
