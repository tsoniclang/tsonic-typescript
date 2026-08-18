import type { Signature, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

import {
  type InterfaceContractTypePairEnqueue,
  type InterfaceContractTypePairState,
  markInterfaceContractsExposed,
} from "./state.js";

export function pairCallableTypes(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): boolean {
  const sourceCalls = semantics.getCallSignatures(source);
  const targetCalls = semantics.getCallSignatures(target);
  const sourceConstructs = semantics.getConstructSignatures(source);
  const targetConstructs = semantics.getConstructSignatures(target);
  if (
    sourceCalls.length === 0 && targetCalls.length === 0 &&
    sourceConstructs.length === 0 && targetConstructs.length === 0
  ) {
    return false;
  }
  pairSignatureFamily(
    semantics,
    source,
    target,
    sourceCalls,
    targetCalls,
    state,
    enqueue,
  );
  pairSignatureFamily(
    semantics,
    source,
    target,
    sourceConstructs,
    targetConstructs,
    state,
    enqueue,
  );
  return true;
}

function pairSignatureFamily(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sources: readonly (Signature | undefined)[],
  targets: readonly (Signature | undefined)[],
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  if (sources.length === 0 && targets.length === 0) {
    return;
  }
  if (sources.length !== 1 || targets.length !== 1) {
    markIncompatibleSignatures(semantics, sourceType, targetType, state);
    return;
  }
  const source = sources[0];
  const target = targets[0];
  if (source === undefined || target === undefined) {
    markIncompatibleSignatures(semantics, sourceType, targetType, state);
    return;
  }
  const sourceParameters = semantics.getSignatureParameterInfos(source);
  const targetParameters = semantics.getSignatureParameterInfos(target);
  if (
    sourceParameters.length !== targetParameters.length ||
    sourceParameters.some((parameter, index) =>
      parameter.parameterKind !== targetParameters[index]?.parameterKind
    )
  ) {
    markIncompatibleSignatures(semantics, sourceType, targetType, state);
    return;
  }
  for (let index = 0; index < sourceParameters.length; index += 1) {
    enqueue(
      semantics,
      targetParameters[index]!.type,
      sourceParameters[index]!.type,
      state,
    );
  }
  const sourceReturn = semantics.getReturnTypeOfSignature(source);
  const targetReturn = semantics.getReturnTypeOfSignature(target);
  if (sourceReturn !== undefined && targetReturn !== undefined) {
    enqueue(semantics, sourceReturn, targetReturn, state);
  }
}

function markIncompatibleSignatures(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
): void {
  markInterfaceContractsExposed(
    semantics,
    source,
    state,
    "incompatible-call-signature",
  );
  markInterfaceContractsExposed(
    semantics,
    target,
    state,
    "incompatible-call-signature",
  );
}
