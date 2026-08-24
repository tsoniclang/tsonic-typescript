import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { InterfaceContractBoundaryReason } from "../boundary.js";
import type { InterfaceContractIndex } from "../graph.js";
import type { InterfaceContractRelevance } from "../relevance.js";
import type { ExactSourceBodyInspection } from "../../../model/source-membership.js";

export interface InterfaceContractPendingTypePair {
  readonly semantics: SourceFileSemantics;
  readonly source: Type;
  readonly target: Type;
}

export interface InterfaceContractTypePairState {
  readonly source: TargetSourceProgram;
  readonly contracts: InterfaceContractIndex;
  rootOccurrence: Node | undefined;
  readonly relevance: InterfaceContractRelevance;
  readonly seen: Map<Type, Set<Type>>;
  readonly pending: InterfaceContractPendingTypePair[];
  rootSourceIsFresh: boolean;
  readonly bodyInspectionIsCertified?: ExactSourceBodyInspection;
}

export type InterfaceContractTypePairEnqueue = (
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
) => void;

export function markInterfaceContractsExposed(
  semantics: SourceFileSemantics,
  root: Type,
  state: InterfaceContractTypePairState,
  reason: InterfaceContractBoundaryReason,
  occurrence: Node = currentOccurrence(state),
): void {
  for (const contract of state.relevance.contracts(semantics, root)) {
    state.contracts.boundaries.mark(contract, reason, occurrence);
  }
}

export function markInterfaceValueContractsExposed(
  semantics: SourceFileSemantics,
  root: Type,
  state: InterfaceContractTypePairState,
  reason: InterfaceContractBoundaryReason,
  occurrence: Node = currentOccurrence(state),
): void {
  for (const contract of state.relevance.valueContracts(semantics, root)) {
    state.contracts.boundaries.mark(contract, reason, occurrence);
  }
}

export function markNestedTypeMismatch(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
): void {
  const targetContracts = state.relevance.valueContracts(semantics, target);
  markContractBoundaries(state, targetContracts, "unmatched-nested-contract");
  if (targetContracts.length !== 0 || !state.rootSourceIsFresh) {
    markContractBoundaries(
      state,
      state.relevance.valueContracts(semantics, source),
      "unmatched-nested-contract",
    );
  }
}

export function markContractBoundaries(
  state: InterfaceContractTypePairState,
  contracts: readonly Node[],
  reason: InterfaceContractBoundaryReason,
): void {
  for (const contract of contracts) {
    state.contracts.boundaries.mark(
      contract,
      reason,
      currentOccurrence(state),
    );
  }
}

export function interfaceContractTypePairWasSeen(
  source: Type,
  target: Type,
  seen: Map<Type, Set<Type>>,
): boolean {
  const targets = seen.get(source);
  if (targets?.has(target) === true) {
    return true;
  }
  if (targets === undefined) {
    seen.set(source, new Set([target]));
  } else {
    targets.add(target);
  }
  return false;
}

function currentOccurrence(state: InterfaceContractTypePairState): Node {
  if (state.rootOccurrence === undefined) {
    throw new Error("interface transport boundary has no source occurrence");
  }
  return state.rootOccurrence;
}
