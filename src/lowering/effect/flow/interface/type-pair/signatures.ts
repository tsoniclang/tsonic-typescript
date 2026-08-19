import type { Signature, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

import { sameSelectedType, typeMaySuspend } from "../../../model/synchronous.js";
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
    enqueue(
      semantics,
      directEffectResultType(semantics, sourceReturn) ?? sourceReturn,
      directEffectResultType(semantics, targetReturn) ?? targetReturn,
      state,
    );
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

function directEffectResultType(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  const selected = semantics.removeMissingOrUndefined(type);
  if (selected === undefined || semantics.isNever(selected)) {
    return selected;
  }
  if (!semantics.isUnion(selected)) {
    if (!typeMaySuspend(semantics, selected)) {
      return selected;
    }
    return exactThenableFulfillmentType(semantics, selected);
  }
  const members = semantics.getUnionOrIntersectionTypes(selected);
  if (members.some((member) => member === undefined)) {
    return undefined;
  }
  const direct: Type[] = [];
  const fulfilled: Type[] = [];
  for (const member of members) {
    if (member === undefined) {
      return undefined;
    }
    const value = exactThenableFulfillmentType(semantics, member);
    if (value === undefined) {
      direct.push(member);
    } else {
      fulfilled.push(value);
    }
  }
  if (fulfilled.length === 0) {
    return !typeMaySuspend(semantics, selected) ? selected : undefined;
  }
  const value = fulfilled[0]!;
  if (
    !fulfilled.slice(1).every((candidate) =>
      sameSelectedType(semantics, value, candidate)
    ) ||
    (direct.length !== 0 && !sameTypeMembers(semantics, direct, value))
  ) {
    return undefined;
  }
  return value;
}

function exactThenableFulfillmentType(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  if (
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.isNever(type)
  ) {
    return undefined;
  }
  const then = semantics.getPropertyInfos(type).filter((property) =>
    property.name === "then"
  );
  if (then.length !== 1) {
    return undefined;
  }
  const thenCallable = singleCallableAlternative(semantics, then[0]!.type);
  if (thenCallable === undefined) {
    return undefined;
  }
  const thenSignatures = semantics.getCallSignatures(thenCallable);
  if (thenSignatures.length !== 1 || thenSignatures[0] === undefined) {
    return undefined;
  }
  const callback = firstParameterType(semantics, thenSignatures[0]);
  if (callback === undefined) {
    return undefined;
  }
  const callbackCallable = singleCallableAlternative(semantics, callback);
  if (callbackCallable === undefined) {
    return undefined;
  }
  const callbackSignatures = semantics.getCallSignatures(callbackCallable);
  if (callbackSignatures.length !== 1 || callbackSignatures[0] === undefined) {
    return undefined;
  }
  return firstParameterType(semantics, callbackSignatures[0]);
}

function firstParameterType(
  semantics: SourceFileSemantics,
  signature: Signature,
): Type | undefined {
  const parameters = semantics.getSignatureParameterInfos(signature);
  return parameters.length === 0
    ? undefined
    : semantics.removeMissingOrUndefined(parameters[0]!.type);
}

function singleCallableAlternative(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  const selected = semantics.removeMissingOrUndefined(type);
  if (selected === undefined) {
    return undefined;
  }
  if (!semantics.isUnion(selected)) {
    return semantics.getCallSignatures(selected).length === 0
      ? undefined
      : selected;
  }
  const callable = semantics.getUnionOrIntersectionTypes(selected).filter(
    (member): member is Type =>
      member !== undefined &&
      !semantics.isNullish(member) &&
      semantics.getCallSignatures(member).length !== 0,
  );
  const nonCallable = semantics.getUnionOrIntersectionTypes(selected).filter(
    (member): member is Type =>
      member !== undefined &&
      !semantics.isNullish(member) &&
      semantics.getCallSignatures(member).length === 0,
  );
  return callable.length === 1 && nonCallable.length === 0
    ? callable[0]
    : undefined;
}

function sameTypeMembers(
  semantics: SourceFileSemantics,
  direct: readonly Type[],
  fulfilled: Type,
): boolean {
  const expected = semantics.isUnion(fulfilled)
    ? semantics.getUnionOrIntersectionTypes(fulfilled).filter(
      (member): member is Type => member !== undefined,
    )
    : [fulfilled];
  if (direct.length !== expected.length) {
    return false;
  }
  const unmatched = new Set(expected.keys());
  for (const member of direct) {
    const match = [...unmatched].find((index) =>
      sameSelectedType(semantics, member, expected[index])
    );
    if (match === undefined) {
      return false;
    }
    unmatched.delete(match);
  }
  return unmatched.size === 0;
}
