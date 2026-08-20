import type { Node } from "@tsonic/tsts";

import type { CallableReturnRewrite } from "../../../model/callable-contract.js";
import type { CallableState } from "../provenance-flow.js";

export interface MutableCallableReturnContract {
  readonly rewrite: CallableReturnRewrite;
  readonly states: CallableState[];
}

export function appendReturnTypeContract(
  target: Map<Node, MutableCallableReturnContract>,
  rewrite: CallableReturnRewrite,
  state: CallableState,
): void {
  const existing = target.get(rewrite.target);
  if (existing === undefined) {
    target.set(rewrite.target, { rewrite, states: [state] });
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
}
