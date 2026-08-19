import { defineExtensionFactKey } from "@tsonic/tsts";

import type {
  ProviderInvocationContract,
  ProviderInvocationStateContract,
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
    inputParameters: Object.freeze([...value.inputParameters]),
    resultOriginParameters: Object.freeze([
      ...value.resultOriginParameters,
    ]),
    ...(value.state === undefined
      ? {}
      : { state: snapshotState(value.state) }),
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
    left.specifier === right.specifier &&
    left.sourcePath === right.sourcePath &&
    left.declarationPath === right.declarationPath &&
    left.declarationFileName === right.declarationFileName &&
    left.exportName === right.exportName &&
    left.member === right.member &&
    left.targetType === right.targetType &&
    left.targetFingerprint === right.targetFingerprint &&
    indexesEqual(left.inputParameters, right.inputParameters) &&
    indexesEqual(
      left.resultOriginParameters,
      right.resultOriginParameters,
    ) &&
    statesEqual(left.state, right.state);
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
