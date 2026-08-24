import type { Signature, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import { sameSelectedType, typeMaySuspend } from "../../../model/synchronous.js";
import type { InterfaceContractRelevance } from "../relevance.js";
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
  const sourceCalls = semantics.types.callSignatures(source);
  const targetCalls = semantics.types.callSignatures(target);
  const sourceConstructs = semantics.types.constructSignatures(source);
  const targetConstructs = semantics.types.constructSignatures(target);
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
  const pairs = exactUniqueSignaturePairs(
    semantics,
    sources,
    targets,
    state.relevance,
  );
  if (pairs === undefined) {
    markIncompatibleSignatures(semantics, sourceType, targetType, state);
    return;
  }
  for (const [source, target] of pairs) {
    pairSignature(semantics, source, target, state, enqueue);
  }
}

function pairSignature(
  semantics: SourceFileSemantics,
  source: Signature,
  target: Signature,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  const sourceParameters = semantics.types.signatureParameterInfos(source);
  const targetParameters = semantics.types.signatureParameterInfos(target);
  for (let index = 0; index < sourceParameters.length; index += 1) {
    enqueue(
      semantics,
      targetParameters[index]!.type,
      sourceParameters[index]!.type,
      state,
    );
  }
  const sourceReturn = semantics.types.returnType(source);
  const targetReturn = semantics.types.returnType(target);
  if (sourceReturn !== undefined && targetReturn !== undefined) {
    enqueue(
      semantics,
      directEffectResultType(semantics, sourceReturn) ?? sourceReturn,
      directEffectResultType(semantics, targetReturn) ?? targetReturn,
      state,
    );
  }
}

export function exactUniqueSignaturePairs(
  semantics: SourceFileSemantics,
  sources: readonly (Signature | undefined)[],
  targets: readonly (Signature | undefined)[],
  relevance: InterfaceContractRelevance,
): readonly (readonly [Signature, Signature])[] | undefined {
  if (sources.length !== targets.length || sources.length === 0) {
    return undefined;
  }
  const sourceSignatures = sources.filter(
    (signature): signature is Signature => signature !== undefined,
  );
  const targetSignatures = targets.filter(
    (signature): signature is Signature => signature !== undefined,
  );
  if (
    sourceSignatures.length !== sources.length ||
    targetSignatures.length !== targets.length
  ) {
    return undefined;
  }
  const candidates = sourceSignatures.map((source) =>
    targetSignatures.map((target, index) =>
      signatureCanPair(semantics, source, target, relevance) ? index : -1
    ).filter((index) => index >= 0)
  );
  const selected = perfectSignatureMatching(candidates, targets.length);
  if (selected === undefined) {
    return undefined;
  }
  for (let sourceIndex = 0; sourceIndex < selected.length; sourceIndex += 1) {
    const targetIndex = selected[sourceIndex];
    if (
      targetIndex === undefined ||
      perfectSignatureMatching(
          candidates,
          targets.length,
          sourceIndex,
          targetIndex,
        ) !== undefined
    ) {
      return undefined;
    }
  }
  return Object.freeze(selected.map((targetIndex, sourceIndex) =>
    Object.freeze([
      sourceSignatures[sourceIndex]!,
      targetSignatures[targetIndex]!,
    ] as const)
  ));
}

function perfectSignatureMatching(
  candidates: readonly (readonly number[])[],
  targetCount: number,
  excludedSource: number = -1,
  excludedTarget: number = -1,
): readonly number[] | undefined {
  const sourceForTarget = new Array<number>(targetCount).fill(-1);
  const visit = (sourceIndex: number, seen: Set<number>): boolean => {
    for (const targetIndex of candidates[sourceIndex] ?? []) {
      if (
        (sourceIndex === excludedSource && targetIndex === excludedTarget) ||
        seen.has(targetIndex)
      ) {
        continue;
      }
      seen.add(targetIndex);
      const previous = sourceForTarget[targetIndex] ?? -1;
      if (previous === -1 || visit(previous, seen)) {
        sourceForTarget[targetIndex] = sourceIndex;
        return true;
      }
    }
    return false;
  };
  for (let sourceIndex = 0; sourceIndex < candidates.length; sourceIndex += 1) {
    if (!visit(sourceIndex, new Set())) {
      return undefined;
    }
  }
  const targetForSource = new Array<number>(candidates.length).fill(-1);
  for (let targetIndex = 0; targetIndex < sourceForTarget.length; targetIndex += 1) {
    const sourceIndex = sourceForTarget[targetIndex] ?? -1;
    if (sourceIndex >= 0) {
      targetForSource[sourceIndex] = targetIndex;
    }
  }
  return targetForSource.some((target) => target < 0)
    ? undefined
    : Object.freeze(targetForSource);
}

function signatureCanPair(
  semantics: SourceFileSemantics,
  source: Signature,
  target: Signature,
  relevance: InterfaceContractRelevance,
): boolean {
  const sourceParameters = semantics.types.signatureParameterInfos(source);
  const targetParameters = semantics.types.signatureParameterInfos(target);
  if (
    sourceParameters.length !== targetParameters.length ||
    sourceParameters.some((parameter, index) =>
      parameter.parameterKind !== targetParameters[index]?.parameterKind ||
      !typesCanPair(
        semantics,
        parameter.type,
        targetParameters[index]!.type,
        relevance,
      )
    )
  ) {
    return false;
  }
  const sourceReturn = semantics.types.returnType(source);
  const targetReturn = semantics.types.returnType(target);
  return sourceReturn !== undefined && targetReturn !== undefined && typesCanPair(
    semantics,
    directEffectResultType(semantics, sourceReturn) ?? sourceReturn,
    directEffectResultType(semantics, targetReturn) ?? targetReturn,
    relevance,
  );
}

function typesCanPair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  relevance: InterfaceContractRelevance,
): boolean {
  const selectedSource = semantics.types.withoutMissingOrUndefined(source);
  const selectedTarget = semantics.types.withoutMissingOrUndefined(target);
  if (selectedSource === undefined || selectedTarget === undefined) {
    return selectedSource === selectedTarget;
  }
  if (
    semantics.types.relationship(selectedSource, selectedTarget) !==
      "unrelated"
  ) {
    return true;
  }
  return relevance.valueContracts(semantics, selectedSource).length !== 0 ||
    relevance.valueContracts(semantics, selectedTarget).length !== 0;
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
  const selected = semantics.types.withoutMissingOrUndefined(type);
  if (selected === undefined || semantics.types.isNever(selected)) {
    return selected;
  }
  if (!semantics.types.isUnion(selected)) {
    if (!typeMaySuspend(semantics, selected)) {
      return selected;
    }
    return exactThenableFulfillmentType(semantics, selected);
  }
  const members = semantics.types.unionOrIntersectionTypes(selected);
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
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type) ||
    semantics.types.isNever(type)
  ) {
    return undefined;
  }
  const then = semantics.types.propertyInfos(type).filter((property) =>
    property.name === "then"
  );
  if (then.length !== 1) {
    return undefined;
  }
  const thenCallable = singleCallableAlternative(semantics, then[0]!.type);
  if (thenCallable === undefined) {
    return undefined;
  }
  const thenSignatures = semantics.types.callSignatures(thenCallable);
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
  const callbackSignatures = semantics.types.callSignatures(callbackCallable);
  if (callbackSignatures.length !== 1 || callbackSignatures[0] === undefined) {
    return undefined;
  }
  return firstParameterType(semantics, callbackSignatures[0]);
}

function firstParameterType(
  semantics: SourceFileSemantics,
  signature: Signature,
): Type | undefined {
  const parameters = semantics.types.signatureParameterInfos(signature);
  return parameters.length === 0
    ? undefined
    : semantics.types.withoutMissingOrUndefined(parameters[0]!.type);
}

function singleCallableAlternative(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  const selected = semantics.types.withoutMissingOrUndefined(type);
  if (selected === undefined) {
    return undefined;
  }
  if (!semantics.types.isUnion(selected)) {
    return semantics.types.callSignatures(selected).length === 0
      ? undefined
      : selected;
  }
  const members = semantics.types.unionOrIntersectionTypes(selected);
  if (members.some((member) => member === undefined)) {
    return undefined;
  }
  const callable = members.filter(
    (member): member is Type =>
      member !== undefined &&
      !semantics.types.isNullish(member) &&
      semantics.types.callSignatures(member).length !== 0,
  );
  const nonCallable = members.filter(
    (member): member is Type =>
      member !== undefined &&
      !semantics.types.isNullish(member) &&
      semantics.types.callSignatures(member).length === 0,
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
  const expected = semantics.types.isUnion(fulfilled)
    ? semantics.types.unionOrIntersectionTypes(fulfilled)
    : [fulfilled];
  if (
    direct.length !== expected.length ||
    expected.some((member) => member === undefined)
  ) {
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
