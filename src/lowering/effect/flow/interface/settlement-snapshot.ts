import type { Node } from "@tsonic/tsts";

import {
  sameExactInvocationInputIndexSnapshot,
  snapshotExactInvocationInputIndex,
  type ExactInvocationInputIndexSnapshot,
} from "../invocation/inputs.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import {
  interfaceFamilyResolutionsRefine,
  sameInterfaceFamilyResolutions,
} from "./dispatch/family-resolution.js";
import type {
  DeclaredInterfaceImplementationSelection,
  InterfaceFamilyResolution,
} from "./dispatch/model.js";
import type { DeclaredInterfaceDispatch } from "./dispatch.js";
import type { CallableReturnRewrite } from "../../model/callable-contract.js";
import type { TypeScriptInterfaceDispatchProfile } from "../../../profile.js";

export interface InterfaceSettlementSnapshot {
  readonly profile: TypeScriptInterfaceDispatchProfile;
  readonly consideredContractCount: number;
  readonly consideredFamilyCount: number;
  readonly rejectedFamilyCount: number;
  readonly families: readonly InterfaceFamilyResolution[];
  readonly invocationInputs: ExactInvocationInputIndexSnapshot;
  readonly invocationTransportCalls: readonly Node[];
}

export interface DetachedInterfaceSettlement {
  readonly snapshot: InterfaceSettlementSnapshot;
  readonly implementationsForCall: ExactCallImplementations;
}

export function detachInterfaceSettlement(
  dispatch: DeclaredInterfaceDispatch,
): DetachedInterfaceSettlement {
  const implementations = new Map<Node, readonly Node[]>();
  for (const call of dispatch.calls.keys()) {
    const selected = dispatch.implementationsForCall(call);
    if (selected !== undefined) {
      implementations.set(call, Object.freeze([...selected]));
    }
  }
  return Object.freeze({
    snapshot: Object.freeze({
      profile: dispatch.profile,
      consideredContractCount: dispatch.consideredContractCount,
      consideredFamilyCount: dispatch.consideredFamilyCount,
      rejectedFamilyCount: dispatch.rejectedFamilyCount,
      families: detachInterfaceFamilyResolutions(dispatch.families),
      invocationInputs: snapshotExactInvocationInputIndex(
        dispatch.invocationInputs,
      ),
      invocationTransportCalls: Object.freeze([
        ...dispatch.invocationTransportCalls,
      ]),
    }),
    implementationsForCall(call: Node): readonly Node[] | undefined {
      return implementations.get(call);
    },
  });
}

function detachInterfaceFamilyResolutions(
  families: readonly InterfaceFamilyResolution[],
): readonly InterfaceFamilyResolution[] {
  return Object.freeze(families.map((family) => Object.freeze({
    implementationSelections: Object.freeze(
      family.implementationSelections.map(detachImplementationSelection),
    ),
    contractDeclarations: Object.freeze([...family.contractDeclarations]),
    calls: Object.freeze([...family.calls]),
    implementations: Object.freeze([...family.implementations]),
    valueImplementationBindings: Object.freeze([
      ...family.valueImplementationBindings,
    ]),
    candidateDeclarations: Object.freeze([...family.candidateDeclarations]),
    returnRewrites: Object.freeze(family.returnRewrites.map(detachReturnRewrite)),
    returnContractBlockers: Object.freeze([...family.returnContractBlockers]),
  })));
}

function detachImplementationSelection(
  selection: DeclaredInterfaceImplementationSelection,
): DeclaredInterfaceImplementationSelection {
  return Object.freeze({
    declaration: selection.declaration,
    implementations: Object.freeze([...selection.implementations]),
    valueImplementationBindings: Object.freeze([
      ...selection.valueImplementationBindings,
    ]),
  });
}

function detachReturnRewrite(
  rewrite: CallableReturnRewrite,
): CallableReturnRewrite {
  return Object.freeze({
    target: rewrite.target,
    selection: Object.freeze({ ...rewrite.selection }),
  });
}

export function interfaceDispatchMatchesSnapshot(
  dispatch: DeclaredInterfaceDispatch,
  snapshot: InterfaceSettlementSnapshot,
): boolean {
  return dispatch.profile === snapshot.profile &&
    dispatch.consideredContractCount === snapshot.consideredContractCount &&
    dispatch.consideredFamilyCount === snapshot.consideredFamilyCount &&
    dispatch.rejectedFamilyCount === snapshot.rejectedFamilyCount &&
    sameInterfaceFamilyResolutions(dispatch.families, snapshot.families) &&
    sameNodes(
      dispatch.invocationTransportCalls,
      snapshot.invocationTransportCalls,
    ) &&
    sameExactInvocationInputIndexSnapshot(
      snapshot.invocationInputs,
      dispatch.invocationInputs,
    );
}

export function interfaceDispatchRefinesSnapshot(
  dispatch: DeclaredInterfaceDispatch,
  snapshot: InterfaceSettlementSnapshot,
): boolean {
  return dispatch.profile === snapshot.profile &&
    dispatch.consideredContractCount === snapshot.consideredContractCount &&
    dispatch.consideredFamilyCount === snapshot.consideredFamilyCount &&
    dispatch.rejectedFamilyCount >= snapshot.rejectedFamilyCount &&
    interfaceFamilyResolutionsRefine(dispatch.families, snapshot.families) &&
    nodesAreSubset(
      snapshot.invocationTransportCalls,
      dispatch.invocationTransportCalls,
    );
}

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length && nodesAreSubset(left, right);
}

function nodesAreSubset(left: readonly Node[], right: readonly Node[]): boolean {
  const selected = new Set(right);
  return left.every((node) => selected.has(node));
}
