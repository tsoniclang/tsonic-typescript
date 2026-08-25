import type { Node } from "@tsonic/tsts";

import type { CooperativeEffectCandidate } from "../../../inventory/candidates.js";
import type { CallableReturnRewrite } from "../../../model/callable-contract.js";
import type { InterfaceContractComponent } from "../graph.js";

export interface InterfaceFamilyResolution {
  readonly implementationSelections: readonly DeclaredInterfaceImplementationSelection[];
  readonly contractDeclarations: readonly Node[];
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
  readonly valueImplementationBindings: readonly Node[];
  readonly candidateDeclarations: readonly Node[];
  readonly returnRewrites: readonly CallableReturnRewrite[];
  readonly returnContractBlockers: readonly Node[];
}

export interface DeclaredInterfaceDispatchFamily
  extends InterfaceFamilyResolution {
  readonly component: InterfaceContractComponent;
  readonly candidates: readonly CooperativeEffectCandidate[];
  readonly coordinator?: CooperativeEffectCandidate;
}

export interface DeclaredInterfaceImplementationSelection {
  readonly declaration: Node;
  readonly implementations: readonly Node[];
  readonly valueImplementationBindings: readonly Node[];
}
