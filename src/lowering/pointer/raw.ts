import type { Node, RawPointerOperationFact } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsTypeReferenceNode,
  IsCallExpression,
  IsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import { runtimeCall, runtimeType } from "./runtime-ast.js";

export function lowerRawPointerType(
  factory: NodeFactory,
  updated: Node,
  runtimeAlias: string,
): Node {
  const typeReference = IsTypeReferenceNode(updated)
    ? AsTypeReferenceNode(updated)
    : undefined;
  if (
    typeReference === undefined ||
    (typeReference.TypeArguments?.Nodes.length ?? 0) !== 0
  ) {
    throw new PointerLoweringError(
      "RawPointer fact must own a non-generic type reference",
    );
  }
  return runtimeType(factory, runtimeAlias, "RawPointer", []);
}

export function lowerRawPointerOperation(
  factory: NodeFactory,
  operation: RawPointerOperationFact,
  updated: Node,
  runtimeAlias: string,
): Node {
  const call = IsCallExpression(updated) ? AsCallExpression(updated) : undefined;
  if (call === undefined) {
    throw new PointerLoweringError(
      `${operation.operation} fact no longer owns a call expression`,
    );
  }
  if ((call.TypeArguments?.Nodes.length ?? 0) !== 0) {
    throw new PointerLoweringError(
      `${operation.operation} must not retain type arguments`,
    );
  }
  const arguments_ = requiredArguments(
    call.Arguments?.Nodes ?? [],
    operation.operation,
  );
  switch (operation.operation) {
    case "bind-raw-pointer":
      requireArity(operation.operation, arguments_, 1);
      return runtimeCall(factory, runtimeAlias, "rawPointer", [], arguments_);
    case "equal-raw-pointer":
      requireArity(operation.operation, arguments_, 2);
      return runtimeCall(factory, runtimeAlias, "sameRawPointer", [], arguments_);
    case "hash-raw-pointer":
      requireArity(operation.operation, arguments_, 1);
      return runtimeCall(factory, runtimeAlias, "hashRawPointer", [], arguments_);
  }
}

function requiredArguments(
  values: readonly (Node | undefined)[],
  operation: RawPointerOperationFact["operation"],
): readonly Node[] {
  const result: Node[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new PointerLoweringError(
        `${operation} arguments contain an absent node at index ${index}`,
      );
    }
    result.push(value);
  }
  return result;
}

function requireArity(
  operation: RawPointerOperationFact["operation"],
  values: readonly Node[],
  expected: number,
): void {
  if (values.length !== expected) {
    throw new PointerLoweringError(
      `${operation} requires ${expected} exact arguments, got ${values.length}`,
    );
  }
}
