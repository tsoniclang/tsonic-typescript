import { defineExtensionFactKey } from "@tsonic/tsts";

import type {
  ProviderInvocationConditionalContract,
  ProviderInvocationContract,
  ProviderInvocationStateContract,
  ProviderInvocationTargetContract,
} from "../../../../config/provider-invocation-manifest.js";

export const providerInvocationExtensionId =
  "tsonic.typescript.provider-invocation";

export type ProviderInvocationFact = ProviderInvocationContract;

export const providerInvocationFactKey =
  defineExtensionFactKey<ProviderInvocationFact>({
    extensionId: providerInvocationExtensionId,
    name: "transport",
    snapshot: snapshotProviderInvocationFact,
    equals: providerInvocationFactsEqual,
  });

function snapshotProviderInvocationFact(
  value: ProviderInvocationFact,
): ProviderInvocationFact {
  return Object.freeze({
    ...value,
    target: snapshotTarget(value.target),
    inputParameters: Object.freeze([...value.inputParameters]),
    resultOriginParameters: Object.freeze([
      ...value.resultOriginParameters,
    ]),
    ...(value.state === undefined
      ? {}
      : { state: snapshotState(value.state) }),
    ...(value.conditional === undefined
      ? {}
      : { conditional: snapshotConditional(value.conditional) }),
  });
}

function snapshotTarget(
  value: ProviderInvocationTargetContract,
): ProviderInvocationTargetContract {
  return Object.freeze({ ...value });
}

function snapshotConditional(
  value: ProviderInvocationConditionalContract,
): ProviderInvocationConditionalContract {
  return Object.freeze({
    callableParameters: Object.freeze([...value.callableParameters]),
    replacement: snapshotTarget(value.replacement),
  });
}

function snapshotState(
  value: ProviderInvocationStateContract,
): ProviderInvocationStateContract {
  return Object.freeze({
    ...value,
    writeParameters: Object.freeze([...value.writeParameters]),
  });
}

function providerInvocationFactsEqual(
  left: ProviderInvocationFact,
  right: ProviderInvocationFact,
): boolean {
  return left.identity === right.identity &&
    left.semanticKey === right.semanticKey &&
    left.sourceIdentity === right.sourceIdentity &&
    targetsEqual(left.target, right.target) &&
    indexesEqual(left.inputParameters, right.inputParameters) &&
    indexesEqual(
      left.resultOriginParameters,
      right.resultOriginParameters,
    ) &&
    statesEqual(left.state, right.state) &&
    conditionalsEqual(left.conditional, right.conditional);
}

function targetsEqual(
  left: ProviderInvocationTargetContract,
  right: ProviderInvocationTargetContract,
): boolean {
  return left.specifier === right.specifier &&
    left.sourcePath === right.sourcePath &&
    left.declarationPath === right.declarationPath &&
    left.declarationFileName === right.declarationFileName &&
    left.access === right.access &&
    left.exportName === right.exportName &&
    left.member === right.member &&
    left.targetType === right.targetType &&
    left.targetFingerprint === right.targetFingerprint;
}

function conditionalsEqual(
  left: ProviderInvocationConditionalContract | undefined,
  right: ProviderInvocationConditionalContract | undefined,
): boolean {
  return left === right || (
    left !== undefined &&
    right !== undefined &&
    indexesEqual(left.callableParameters, right.callableParameters) &&
    targetsEqual(left.replacement, right.replacement)
  );
}

function statesEqual(
  left: ProviderInvocationStateContract | undefined,
  right: ProviderInvocationStateContract | undefined,
): boolean {
  return left === right || (
    left !== undefined &&
    right !== undefined &&
    left.kind === right.kind &&
    left.carrierParameter === right.carrierParameter &&
    left.read === right.read &&
    indexesEqual(left.writeParameters, right.writeParameters)
  );
}

function indexesEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
