import { defineExtensionFactKey } from "@tsonic/tsts";

export const typeScriptRuntimeReturnExtensionId =
  "tsonic.typescript.runtime-return";
export const typeScriptRuntimeReturnExtensionVersion = "1.0.0";

export const nonThenableTypeScriptRuntimeOperations = Object.freeze([
  "boundLocation",
  "location",
  "nestedPropertyLocation",
  "projectLocation",
  "propertyLocation",
  "rawPointer",
] as const);

export type NonThenableTypeScriptRuntimeOperation =
  (typeof nonThenableTypeScriptRuntimeOperations)[number];

export interface TypeScriptRuntimeReturnFact {
  readonly operation: NonThenableTypeScriptRuntimeOperation;
}

export const typeScriptRuntimeReturnFactKey =
  defineExtensionFactKey<TypeScriptRuntimeReturnFact>({
    extensionId: typeScriptRuntimeReturnExtensionId,
    name: "non-thenable-return",
    snapshot(value) {
      return Object.freeze({ operation: value.operation });
    },
    equals(left, right) {
      return left.operation === right.operation;
    },
  });
