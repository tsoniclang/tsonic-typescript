import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsElementAccessExpression,
  AsPropertyAccessExpression,
  IsElementAccessExpression,
  IsPropertyAccessExpression,
  NewStringLiteral,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { TypedLocationLoweringError } from "./diagnostic.js";
import { locationBindingExpression } from "./location-binding.js";
import type { TypedLocationPlan } from "./plan.js";
import { runtimeCall } from "./runtime-ast.js";

export function lowerAddressOf(
  source: TargetSourceProgram,
  factory: NodeFactory,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  updatedStorage: Node,
  plan: TypedLocationPlan,
): Node {
  if (source.ast.is.IsIdentifier(operation.storageExpression)) {
    const binding = plan.addressBindings.get(operation.storageExpression);
    if (binding === undefined) {
      throw new TypedLocationLoweringError(
        "addressed identifier lacks its exact location binding",
      );
    }
    return locationBindingExpression(factory, binding, updatedStorage);
  }
  const property = IsPropertyAccessExpression(updatedStorage)
    ? AsPropertyAccessExpression(updatedStorage)
    : undefined;
  if (property !== undefined) {
    if (!source.ast.is.IsPropertyAccessExpression(operation.storageExpression)) {
      throw new TypedLocationLoweringError(
        "addressed property has no exact original property expression",
      );
    }
    const originalProperty = source.ast.as.AsPropertyAccessExpression(
      operation.storageExpression,
    );
    if (property.Expression === undefined || property.name === undefined) {
      throw new TypedLocationLoweringError(
        "addressed property lost its exact base or name",
      );
    }
    if (originalProperty?.name === undefined) {
      throw new TypedLocationLoweringError(
        "addressed property has no exact original name",
      );
    }
    const parentLocation = lowerValueFieldParentLocation(
      source,
      factory,
      originalProperty.Expression,
      property.Expression,
      plan,
    );
    return runtimeCall(
      factory,
      plan.runtimeAlias,
      parentLocation === undefined
        ? "propertyLocation"
        : "nestedPropertyLocation",
      [],
      [
        parentLocation ?? property.Expression,
        requiredNode(
          NewStringLiteral(factory, source.ast.text(originalProperty.name), 0),
          "addressed property name",
        ),
      ],
    );
  }
  const element = IsElementAccessExpression(updatedStorage)
    ? AsElementAccessExpression(updatedStorage)
    : undefined;
  if (element !== undefined) {
    if (element.Expression === undefined || element.ArgumentExpression === undefined) {
      throw new TypedLocationLoweringError(
        "addressed element lost its exact base or key",
      );
    }
    return runtimeCall(
      factory,
      plan.runtimeAlias,
      "propertyLocation",
      [],
      [element.Expression, element.ArgumentExpression],
    );
  }
  throw new TypedLocationLoweringError(
    "address-of storage is outside the TypeScript location model",
  );
}

function lowerValueFieldParentLocation(
  source: TargetSourceProgram,
  factory: NodeFactory,
  original: Node | undefined,
  updated: Node,
  plan: TypedLocationPlan,
): Node | undefined {
  if (original === undefined) {
    throw new TypedLocationLoweringError(
      "addressed property lost its exact original base",
    );
  }
  if (source.ast.is.IsIdentifier(original)) {
    const binding = plan.addressBindings.get(original);
    return binding === undefined
      ? undefined
      : locationBindingExpression(factory, binding, updated);
  }
  if (!source.ast.is.IsPropertyAccessExpression(original)) {
    return undefined;
  }
  const originalProperty = source.ast.as.AsPropertyAccessExpression(original);
  const updatedProperty = IsPropertyAccessExpression(updated)
    ? AsPropertyAccessExpression(updated)
    : undefined;
  if (
    originalProperty?.Expression === undefined ||
    originalProperty.name === undefined ||
    updatedProperty?.Expression === undefined
  ) {
    throw new TypedLocationLoweringError(
      "addressed value-field path lost an exact property segment",
    );
  }
  const parent = lowerValueFieldParentLocation(
    source,
    factory,
    originalProperty.Expression,
    updatedProperty.Expression,
    plan,
  );
  if (parent === undefined) {
    return undefined;
  }
  return runtimeCall(
    factory,
    plan.runtimeAlias,
    "nestedPropertyLocation",
    [],
    [
      parent,
      requiredNode(
        NewStringLiteral(factory, source.ast.text(originalProperty.name), 0),
        "addressed value-field path segment",
      ),
    ],
  );
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new TypedLocationLoweringError(`${subject} was not created`);
  }
  return node;
}
