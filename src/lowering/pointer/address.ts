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

import { PointerLoweringError } from "./diagnostic.js";
import { locationBindingExpression } from "./location-binding.js";
import type { PointerLoweringPlan } from "./plan.js";
import { runtimeCall } from "./runtime-ast.js";

export function lowerAddressOf(
  source: TargetSourceProgram,
  factory: NodeFactory,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  updatedStorage: Node,
  plan: PointerLoweringPlan,
  updatedNodes: ReadonlyMap<Node, Node>,
): Node {
  if (source.ast.is.IsIdentifier(operation.storageExpression)) {
    const binding = plan.addressBindings.get(operation.storageExpression);
    if (binding === undefined) {
      throw new PointerLoweringError(
        "addressed identifier lacks its exact location binding",
      );
    }
    return locationBindingExpression(factory, binding);
  }
  const property = IsPropertyAccessExpression(updatedStorage)
    ? AsPropertyAccessExpression(updatedStorage)
    : undefined;
  if (property !== undefined) {
    if (!source.ast.is.IsPropertyAccessExpression(operation.storageExpression)) {
      throw new PointerLoweringError(
        "addressed property has no exact original property expression",
      );
    }
    const originalProperty = source.ast.as.AsPropertyAccessExpression(
      operation.storageExpression,
    );
    if (property.Expression === undefined || property.name === undefined) {
      throw new PointerLoweringError(
        "addressed property lost its exact base or name",
      );
    }
    if (originalProperty?.name === undefined) {
      throw new PointerLoweringError(
        "addressed property has no exact original name",
      );
    }
    requireAddressablePropertyName(source, originalProperty.name);
    const parentLocation = lowerValueParentLocation(
      source,
      factory,
      originalProperty.Expression,
      property.Expression,
      plan,
      updatedNodes,
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
    if (!source.ast.is.IsElementAccessExpression(operation.storageExpression)) {
      throw new PointerLoweringError(
        "addressed element has no exact original element expression",
      );
    }
    const originalElement = source.ast.as.AsElementAccessExpression(
      operation.storageExpression,
    );
    if (element.Expression === undefined || element.ArgumentExpression === undefined) {
      throw new PointerLoweringError(
        "addressed element lost its exact base or key",
      );
    }
    if (originalElement?.Expression === undefined) {
      throw new PointerLoweringError(
        "addressed element has no exact original base",
      );
    }
    const parentLocation = lowerValueParentLocation(
      source,
      factory,
      originalElement.Expression,
      element.Expression,
      plan,
      updatedNodes,
    );
    return runtimeCall(
      factory,
      plan.runtimeAlias,
      parentLocation === undefined
        ? "propertyLocation"
        : "nestedPropertyLocation",
      [],
      [parentLocation ?? element.Expression, element.ArgumentExpression],
    );
  }
  throw new PointerLoweringError(
    "address-of storage is outside the TypeScript location model",
  );
}

function lowerValueParentLocation(
  source: TargetSourceProgram,
  factory: NodeFactory,
  original: Node | undefined,
  updated: Node,
  plan: PointerLoweringPlan,
  updatedNodes: ReadonlyMap<Node, Node>,
): Node | undefined {
  if (original === undefined) {
    throw new PointerLoweringError(
      "addressed property lost its exact original base",
    );
  }
  if (source.ast.is.IsIdentifier(original)) {
    const binding = plan.addressBindings.get(original);
    return binding === undefined
      ? undefined
      : locationBindingExpression(factory, binding);
  }
  const operation = plan.operations.get(original);
  if (operation?.operation === "load") {
    const pointer = updatedNodes.get(operation.pointerExpression);
    if (pointer === undefined) {
      throw new PointerLoweringError(
        "addressed pointer-load parent lacks its exact transformed pointer",
      );
    }
    return pointer;
  }
  if (source.ast.is.IsPropertyAccessExpression(original)) {
    const originalProperty = source.ast.as.AsPropertyAccessExpression(original);
    const updatedProperty = IsPropertyAccessExpression(updated)
      ? AsPropertyAccessExpression(updated)
      : undefined;
    if (
      originalProperty?.Expression === undefined ||
      originalProperty.name === undefined ||
      updatedProperty?.Expression === undefined
    ) {
      throw new PointerLoweringError(
        "addressed value path lost an exact property segment",
      );
    }
    requireAddressablePropertyName(source, originalProperty.name);
    const parent = lowerValueParentLocation(
      source,
      factory,
      originalProperty.Expression,
      updatedProperty.Expression,
      plan,
      updatedNodes,
    );
    const key = requiredNode(
      NewStringLiteral(factory, source.ast.text(originalProperty.name), 0),
      "addressed value path segment",
    );
    return runtimeCall(
      factory,
      plan.runtimeAlias,
      parent === undefined ? "propertyLocation" : "nestedPropertyLocation",
      [],
      [parent ?? updatedProperty.Expression, key],
    );
  }
  if (!source.ast.is.IsElementAccessExpression(original)) {
    return undefined;
  }
  const originalElement = source.ast.as.AsElementAccessExpression(original);
  const updatedElement = IsElementAccessExpression(updated)
    ? AsElementAccessExpression(updated)
    : undefined;
  if (
    originalElement?.Expression === undefined ||
    originalElement.ArgumentExpression === undefined ||
    updatedElement?.Expression === undefined ||
    updatedElement.ArgumentExpression === undefined
  ) {
    throw new PointerLoweringError(
      "addressed value path lost an exact element segment",
    );
  }
  const parent = lowerValueParentLocation(
    source,
    factory,
    originalElement.Expression,
    updatedElement.Expression,
    plan,
    updatedNodes,
  );
  return runtimeCall(
    factory,
    plan.runtimeAlias,
    parent === undefined ? "propertyLocation" : "nestedPropertyLocation",
    [],
    [parent ?? updatedElement.Expression, updatedElement.ArgumentExpression],
  );
}

function requireAddressablePropertyName(
  source: TargetSourceProgram,
  name: Node,
): void {
  if (source.ast.is.IsPrivateIdentifier(name)) {
    throw new PointerLoweringError(
      "address-of does not support private field storage",
    );
  }
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
