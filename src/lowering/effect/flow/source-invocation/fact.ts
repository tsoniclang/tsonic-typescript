import { defineExtensionFactKey } from "@tsonic/tsts";

import type {
  SourceInvocationContract,
} from "../../../../config/source-invocation-manifest.js";

export const sourceInvocationExtensionId =
  "tsonic.typescript.source-invocation";

export interface SourceBodyCertification {
  readonly identity: string;
  readonly sourceFileName: string;
  readonly sourceDigest: string;
}

export const sourceInvocationFactKey =
  defineExtensionFactKey<SourceInvocationContract>({
    extensionId: sourceInvocationExtensionId,
    name: "invocation",
    snapshot: snapshotSourceInvocationFact,
    equals: sourceInvocationFactsEqual,
  });

export const sourceBodyCertificationFactKey =
  defineExtensionFactKey<SourceBodyCertification>({
    extensionId: sourceInvocationExtensionId,
    name: "body-certification",
    snapshot(value): SourceBodyCertification {
      return Object.freeze({ ...value });
    },
    equals(left, right): boolean {
      return left.identity === right.identity &&
        left.sourceFileName === right.sourceFileName &&
        left.sourceDigest === right.sourceDigest;
    },
  });

function snapshotSourceInvocationFact(
  value: SourceInvocationContract,
): SourceInvocationContract {
  return Object.freeze({
    ...value,
    file: Object.freeze({ ...value.file }),
    inputParameters: Object.freeze([...value.inputParameters]),
    resultOriginParameters: Object.freeze([
      ...value.resultOriginParameters,
    ]),
  });
}

function sourceInvocationFactsEqual(
  left: SourceInvocationContract,
  right: SourceInvocationContract,
): boolean {
  return left.identity === right.identity &&
    left.semanticKey === right.semanticKey &&
    left.sourceIdentity === right.sourceIdentity &&
    left.exportName === right.exportName &&
    left.file.identity === right.file.identity &&
    left.file.sourcePath === right.file.sourcePath &&
    left.file.sourceFileName === right.file.sourceFileName &&
    left.file.sourceDigest === right.file.sourceDigest &&
    left.file.exact === right.file.exact &&
    left.exactImplementation === right.exactImplementation &&
    sameIndexes(left.inputParameters, right.inputParameters) &&
    sameIndexes(left.resultOriginParameters, right.resultOriginParameters);
}

function sameIndexes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
