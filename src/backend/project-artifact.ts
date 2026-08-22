import type {
  TargetArtifact,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";

import {
  typeScriptRuntimeModule,
  typeScriptRuntimeReference,
} from "../runtime/package-contract.js";

export function createTypeScriptProjectArtifact(
  references: readonly TargetRuntimeReference[],
  needsTypeScriptRuntime: boolean,
): TargetArtifact {
  const expectedRuntime = typeScriptRuntimeReference();
  const dependencies = new Map<string, string>();
  for (const reference of references) {
    if (reference.kind !== "npm-package") {
      throw new Error(
        `TypeScript target does not support runtime reference kind '${reference.kind}'`,
      );
    }
    if (
      reference.include.length === 0 ||
      reference.version === undefined ||
      reference.version.length === 0 ||
      reference.attributes !== undefined
    ) {
      throw new Error(
        `TypeScript target runtime reference '${reference.include}' is incomplete`,
      );
    }
    if (reference.include === typeScriptRuntimeModule && !needsTypeScriptRuntime) {
      continue;
    }
    if (dependencies.has(reference.include)) {
      throw new Error(
        `TypeScript target runtime package '${reference.include}' is duplicated`,
      );
    }
    dependencies.set(reference.include, reference.version);
  }
  if (
    needsTypeScriptRuntime &&
    dependencies.get(expectedRuntime.include) !== expectedRuntime.version
  ) {
    throw new Error(
      `TypeScript lowering requires npm-package reference '${expectedRuntime.include}@${expectedRuntime.version}'`,
    );
  }
  const dependencyDocument: Record<string, string> = {};
  for (const [name, version] of [...dependencies].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )) {
    dependencyDocument[name] = version;
  }
  return Object.freeze({
    kind: "project",
    path: "package.json",
    text: `${JSON.stringify({
      private: true,
      type: "module",
      dependencies: dependencyDocument,
    }, undefined, 2)}\n`,
  });
}
