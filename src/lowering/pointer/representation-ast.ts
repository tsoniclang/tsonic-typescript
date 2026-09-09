import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsTypeReferenceNode,
  IsCallExpression,
  IsTypeReferenceNode,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  NewBinaryExpression,
  NewIdentifier,
  NewObjectLiteralExpression,
  NewPropertyAssignment,
  NewPropertyAccessExpression,
  NewPropertySignatureDeclaration,
  NewToken,
  NewTypeLiteralNode,
  NewVoidExpression,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { GeneratedBindingName } from "../generated-names.js";
import {
  lowerDirectObjectReplacementStore,
} from "./direct-object-replacement-ast.js";
import type { DirectObjectReplacement } from "./direct-object-replacement.js";
import { PointerLoweringError } from "./diagnostic.js";
import type { PointerFlowRepresentation } from "./flow-plan.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";
import { runtimeCall } from "./runtime-ast.js";

export function lowerOptimizedPointerType(
  factory: NodeFactory,
  updated: Node,
  representation: PointerFlowRepresentation,
): Node | undefined {
  if (representation === "location") {
    return undefined;
  }
  const reference = IsTypeReferenceNode(updated)
    ? AsTypeReferenceNode(updated)
    : undefined;
  const pointee = reference?.TypeArguments?.Nodes[0];
  if (
    reference === undefined ||
    reference.TypeArguments?.Nodes.length !== 1 ||
    pointee === undefined
  ) {
    throw new PointerLoweringError(
      "optimized Pointer<T> must retain exactly one pointee type",
    );
  }
  if (
    representation === "direct-snapshot" ||
    representation === "direct-object"
  ) {
    return pointee;
  }
  const value = requiredNode(
    NewPropertySignatureDeclaration(
      factory,
      undefined,
      NewIdentifier(factory, "value"),
      undefined,
      pointee,
      undefined,
    ),
    "mutable pointer-cell value type",
  );
  return requiredNode(
    NewTypeLiteralNode(
      factory,
      NodeFactory_NewNodeList(factory, [value]),
    ),
    "mutable pointer-cell type",
  );
}

export function lowerOptimizedPointerOperation(
  source: TargetSourceProgram,
  factory: NodeFactory,
  operation: PointerOperationFact,
  updated: Node,
  representation: PointerFlowRepresentation,
  directObjectReplacement: DirectObjectReplacement | undefined,
  runtimeAlias: GeneratedBindingName,
): Node | undefined {
  if (representation === "location") {
    return undefined;
  }
  const call = IsCallExpression(updated) ? AsCallExpression(updated) : undefined;
  const arguments_ = call?.Arguments?.Nodes ?? [];
  if (call === undefined) {
    throw new PointerLoweringError(
      `${operation.operation} optimized flow lost its exact call arguments`,
    );
  }
  const values = simplifyDisprovedNilGuards(
    source,
    operation,
    requireNodes(arguments_, operation.operation),
  );
  if (
    representation === "direct-object" ||
    representation === "mutable-cell"
  ) {
    const identity = lowerReferenceIdentityOperation(
      factory,
      operation,
      values,
      runtimeAlias,
    );
    if (identity !== undefined) {
      return identity;
    }
  }
  if (representation === "direct-snapshot") {
    if (
      operation.operation !== "allocate" &&
      operation.operation !== "address-of" &&
      operation.operation !== "load"
    ) {
      throw new PointerLoweringError(
        `${representation} cannot lower ${operation.operation}`,
      );
    }
    requireArity(operation.operation, values, 1);
    return values[0];
  }
  if (representation === "direct-object") {
    switch (operation.operation) {
      case "allocate":
      case "address-of":
      case "load":
        requireArity(operation.operation, values, 1);
        return values[0];
      case "store":
        requireArity(operation.operation, values, 2);
        if (directObjectReplacement === undefined) {
          throw new PointerLoweringError(
            "direct-object store has no exact replacement plan",
          );
        }
        return lowerDirectObjectReplacementStore(
          factory,
          requiredValue(values, 0),
          requiredValue(values, 1),
          directObjectReplacement,
        );
      default:
        throw new PointerLoweringError(
          `direct-object cannot lower ${operation.operation}`,
        );
    }
  }
  switch (operation.operation) {
    case "allocate":
      requireArity(operation.operation, values, 1);
      return mutableCell(factory, requiredValue(values, 0));
    case "load":
      requireArity(operation.operation, values, 1);
      return cellValue(factory, requiredValue(values, 0));
    case "store": {
      requireArity(operation.operation, values, 2);
      const assignment = requiredNode(
        NewBinaryExpression(
          factory,
          undefined,
          cellValue(factory, requiredValue(values, 0)),
          undefined,
          NewToken(factory, KindEqualsToken),
          requiredValue(values, 1),
        ),
        "mutable pointer-cell assignment",
      );
      return requiredNode(
        NewVoidExpression(factory, assignment),
        "mutable pointer-cell store",
      );
    }
    default:
      throw new PointerLoweringError(
        `mutable-cell cannot lower ${operation.operation}`,
      );
  }
}

function simplifyDisprovedNilGuards(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
  values: readonly Node[],
): readonly Node[] {
  const pointerOperands = operation.operation === "equal-pointer"
    ? [operation.leftExpression, operation.rightExpression]
    : operation.operation === "load" ||
        operation.operation === "store" ||
        operation.operation === "hash-pointer"
    ? [operation.pointerExpression]
    : [];
  if (pointerOperands.length === 0) {
    return values;
  }
  const simplified = [...values];
  for (let index = 0; index < pointerOperands.length; index += 1) {
    const original = pointerOperands[index];
    const updated = simplified[index];
    if (original !== undefined && updated !== undefined) {
      simplified[index] = disprovedNilGuardValue(source, original, updated);
    }
  }
  return simplified;
}

function disprovedNilGuardValue(
  source: TargetSourceProgram,
  original: Node,
  updated: Node,
): Node {
  if (source.ast.operatorKindName(original) !== "KindQuestionQuestionToken") {
    return updated;
  }
  const originalBinary = source.ast.as.AsBinaryExpression(original);
  const updatedBinary = source.ast.as.AsBinaryExpression(updated);
  const left = originalBinary?.Left;
  const fallback = originalBinary?.Right;
  const fallbackType = fallback === undefined
    ? undefined
    : source.semantics.forNode(fallback).types.expressionType(fallback);
  if (
    fallback === undefined ||
    left === undefined ||
    fallbackType === undefined ||
    !source.semantics.forNode(fallback).types.isNever(fallbackType) ||
    source.ast.operatorKindName(updated) !== "KindQuestionQuestionToken" ||
    updatedBinary?.Left === undefined
  ) {
    return updated;
  }
  const leftType = source.semantics.forNode(left).types.expressionType(left);
  if (
    leftType === undefined ||
    pointerTypeCanBeUndefined(source, left, leftType)
  ) {
    return updated;
  }
  return updatedBinary.Left;
}

function lowerReferenceIdentityOperation(
  factory: NodeFactory,
  operation: PointerOperationFact,
  values: readonly Node[],
  runtimeAlias: GeneratedBindingName,
): Node | undefined {
  if (operation.operation === "equal-pointer") {
    requireArity(operation.operation, values, 2);
    return strictIdentity(
      factory,
      requiredValue(values, 0),
      requiredValue(values, 1),
    );
  }
  if (operation.operation === "hash-pointer") {
    requireArity(operation.operation, values, 1);
    return runtimeCall(
      factory,
      runtimeAlias,
      "hashObjectIdentity",
      [],
      [requiredValue(values, 0)],
    );
  }
  return undefined;
}

function strictIdentity(factory: NodeFactory, left: Node, right: Node): Node {
  return requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      left,
      undefined,
      NewToken(factory, KindEqualsEqualsEqualsToken),
      right,
    ),
    "direct object pointer identity",
  );
}

function mutableCell(factory: NodeFactory, initial: Node): Node {
  const value = requiredNode(
    NewPropertyAssignment(
      factory,
      undefined,
      NewIdentifier(factory, "value"),
      undefined,
      undefined,
      initial,
    ),
    "mutable pointer-cell value",
  );
  return requiredNode(
    NewObjectLiteralExpression(
      factory,
      NodeFactory_NewNodeList(factory, [value]),
      false,
    ),
    "mutable pointer cell",
  );
}

function cellValue(factory: NodeFactory, pointer: Node): Node {
  return requiredNode(
    NewPropertyAccessExpression(
      factory,
      pointer,
      undefined,
      NewIdentifier(factory, "value"),
      0,
    ),
    "mutable pointer-cell value access",
  );
}

function requireArity(
  operation: PointerOperationFact["operation"],
  values: readonly Node[],
  expected: number,
): void {
  if (values.length !== expected) {
    throw new PointerLoweringError(
      `${operation} requires ${expected} exact arguments, got ${values.length}`,
    );
  }
}

function requiredValue(values: readonly Node[], index: number): Node {
  const value = values[index];
  if (value === undefined) {
    throw new PointerLoweringError(`optimized pointer operation lost argument ${index}`);
  }
  return value;
}

function requireNodes(
  values: readonly (Node | undefined)[],
  operation: PointerOperationFact["operation"],
): readonly Node[] {
  return values.map((value, index) => {
    if (value === undefined) {
      throw new PointerLoweringError(
        `${operation} optimized flow lost argument ${index}`,
      );
    }
    return value;
  });
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
