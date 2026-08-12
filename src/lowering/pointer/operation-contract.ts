import type {
  Node,
  PointerOperationFact,
  ResolvedSourceCallInfo,
  SourceCallMarkerKind,
  Type,
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
  const semantics = source.semantics.forNode(operation.call);
  const call = semantics.getResolvedCallInfo(operation.call);
  if (call?.sourceSelectedSignatureKind !== "resolved") {
    fail(operation, "has no exact resolved-call evidence");
  }
  validateSelectedMarker(source, operation);
  validateSelectedPointee(source, operation, call);
  validateResultType(source, operation, call);
  const expected = operationOperandContracts(operation);
  if (call.sourceArguments.length !== expected.length) {
    fail(
      operation,
      `has ${call.sourceArguments.length} arguments, expected ${expected.length}`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const selected = call.sourceArguments[index];
    const owned = expected[index];
    if (selected?.expression !== owned?.expression) {
      fail(
        operation,
        `${owned?.role ?? `argument ${index}`} expression disagrees with its exact checker operand`,
      );
    }
    if (
      selected?.type === undefined ||
      owned?.type === undefined ||
      semantics.getTypeRelationship(selected.type, owned.type) !== "identical"
    ) {
      fail(
        operation,
        `${owned?.role ?? `argument ${index}`} type disagrees with its exact checker type`,
      );
    }
  }
  validateAddressedStorage(source, operation);
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
  call: ResolvedSourceCallInfo,
): void {
  const semantics = source.semantics.forNode(operation.call);
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

function validateResultType(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
  call: ResolvedSourceCallInfo,
): void {
  if (
    source.semantics.forNode(operation.call).getTypeRelationship(
      call.sourceResultType,
      operation.resultType,
    ) !== "identical"
  ) {
    fail(operation, "result type disagrees with its exact checker type");
  }
}

interface PointerOperandContract {
  readonly role: string;
  readonly expression: Node;
  readonly type: Type;
}

function operationOperandContracts(
  operation: PointerOperationFact,
): readonly PointerOperandContract[] {
  switch (operation.operation) {
    case "address-of":
      return [
        owned("storage", operation.storageExpression, operation.storageType),
      ];
    case "allocate":
      return [
        owned("initial", operation.initialExpression, operation.initialType),
      ];
    case "load":
    case "hash-pointer":
      return [
        owned("pointer", operation.pointerExpression, operation.pointerType),
      ];
    case "store":
      return [
        owned("pointer", operation.pointerExpression, operation.pointerType),
        owned("value", operation.valueExpression, operation.valueType),
      ];
    case "equal-pointer":
      return [
        owned("left", operation.leftExpression, operation.leftType),
        owned("right", operation.rightExpression, operation.rightType),
      ];
    case "bind-pointer":
      return [
        owned(
          "identity",
          operation.identityExpression,
          operation.identityType,
        ),
        owned("read", operation.readExpression, operation.readType),
        owned("write", operation.writeExpression, operation.writeType),
      ];
    case "project-pointer":
      return [
        owned("pointer", operation.pointerExpression, operation.pointerType),
        owned(
          "from-source",
          operation.fromSourceExpression,
          operation.fromSourceType,
        ),
        owned("to-source", operation.toSourceExpression, operation.toSourceType),
      ];
  }
}

function owned(
  role: string,
  expression: Node,
  type: Type,
): PointerOperandContract {
  return { role, expression, type };
}

function validateAddressedStorage(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
): void {
  if (operation.operation !== "address-of") {
    return;
  }
  const semantics = source.semantics.forNode(operation.storageExpression);
  const storage = semantics.getResolvedStorageInfo(operation.storageExpression);
  if (
    storage === undefined ||
    !storage.writable ||
    storage.storageExpression !== operation.storageExpression ||
    semantics.getTypeRelationship(
      storage.type,
      operation.storageType,
    ) !== "identical" ||
    storage.symbol !== operation.storageSymbol ||
    storage.declaration !== operation.storageDeclaration
  ) {
    fail(operation, "storage evidence disagrees with its exact checker owner");
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
