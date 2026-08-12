import type {
  Node,
  PointerOperationFact,
  SourceCallMarkerKind,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { PointerLoweringError } from "./diagnostic.js";
import { exactPointerSelections } from "./marker-usage.js";

export function validatePointerOperationFact(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
): void {
  if (!source.ast.is.IsCallExpression(operation.call)) {
    fail(operation, "is not attached to a call expression");
  }
  validateSelectedMarker(source, operation);
  validateSelectedPointee(source, operation);
  const arguments_ = source.ast.arguments(operation.call);
  const expected = operationOperands(operation);
  if (arguments_.length !== expected.length) {
    fail(
      operation,
      `has ${arguments_.length} arguments, expected ${expected.length}`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (arguments_[index] !== expected[index]) {
      fail(operation, `argument ${index} disagrees with its exact fact operand`);
    }
  }
  validateLocationIdentity(operation);
}

function validateSelectedMarker(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
): void {
  const call = source.ast.as.AsCallExpression(operation.call);
  const target = call?.Expression;
  const selected = target === undefined
    ? []
    : exactPointerSelections(source, target).flatMap((selection) =>
        selection.marker?.kind === "call-marker"
          ? [selection.marker.marker]
          : []
      );
  const unique = [...new Set(selected)];
  if (unique.length !== 1 || unique[0] !== operation.operation) {
    const actual = unique.length === 0 ? "none" : unique.join(",");
    fail(
      operation,
      `selected marker '${actual}' disagrees with '${operation.operation}'`,
    );
  }
}

function validateSelectedPointee(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
): void {
  const semantics = source.semantics.forNode(operation.call);
  const call = semantics.getResolvedCallInfo(operation.call);
  const selected = call?.sourceSelectedMethodTypeArguments ?? [];
  const expectedCount = operation.operation === "project-pointer" ? 2 : 1;
  const selectedPointee = selected[expectedCount - 1];
  if (
    call?.sourceSelectedSignatureKind !== "resolved" ||
    selected.length !== expectedCount ||
    selectedPointee?.selectedType === undefined ||
    semantics.getTypeRelationship(
      selectedPointee.selectedType,
      operation.pointeeType,
    ) !== "identical"
  ) {
    fail(operation, "pointee disagrees with its exact selected type argument");
  }
  if (selectedPointee.explicitTypeNode !== operation.explicitPointeeTypeNode) {
    fail(operation, "explicit pointee syntax disagrees with its selected type");
  }
  if (operation.operation !== "project-pointer") {
    return;
  }
  const sourcePointee = selected[0];
  if (
    sourcePointee?.selectedType === undefined ||
    semantics.getTypeRelationship(
      sourcePointee.selectedType,
      operation.sourcePointeeType,
    ) !== "identical" ||
    sourcePointee.explicitTypeNode !== operation.explicitSourcePointeeTypeNode
  ) {
    fail(operation, "source pointee disagrees with its exact selected type argument");
  }
}

function operationOperands(operation: PointerOperationFact): readonly Node[] {
  switch (operation.operation) {
    case "address-of":
      return [operation.storageExpression];
    case "allocate":
      return [operation.initialExpression];
    case "load":
    case "hash-pointer":
      return [operation.pointerExpression];
    case "store":
      return [operation.pointerExpression, operation.valueExpression];
    case "equal-pointer":
      return [operation.leftExpression, operation.rightExpression];
    case "bind-pointer":
      return [
        operation.identityExpression,
        operation.readExpression,
        operation.writeExpression,
      ];
    case "project-pointer":
      return [
        operation.pointerExpression,
        operation.fromSourceExpression,
        operation.toSourceExpression,
      ];
  }
}

function validateLocationIdentity(operation: PointerOperationFact): void {
  const disagrees = operation.operation === "address-of"
    ? operation.locationIdentity !== operation.storageExpression
    : operation.operation === "allocate"
    ? operation.locationIdentity !== operation.call
    : operation.operation === "bind-pointer"
    ? operation.locationIdentity !== operation.identityExpression
    : false;
  if (disagrees) {
    fail(operation, "location identity disagrees with its exact source owner");
  }
}

function fail(
  operation: { readonly operation: SourceCallMarkerKind },
  detail: string,
): never {
  throw new PointerLoweringError(
    `pointer ${operation.operation} fact ${detail}`,
  );
}
