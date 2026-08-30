import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { PointerLoweringError } from "./diagnostic.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";

export function pointerNilGuardCanBeElided(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  if (source.ast.operatorKindName(expression) !== "KindQuestionQuestionToken") {
    return false;
  }
  const binary = source.ast.as.AsBinaryExpression(expression);
  const left = binary?.Left;
  const fallback = binary?.Right;
  const fallbackType = fallback === undefined
    ? undefined
    : source.semantics.forNode(fallback).types.expressionType(fallback);
  const leftType = left === undefined
    ? undefined
    : source.semantics.forNode(left).types.expressionType(left);
  return left !== undefined &&
    fallback !== undefined &&
    fallbackType !== undefined &&
    source.semantics.forNode(fallback).types.isNever(fallbackType) &&
    leftType !== undefined &&
    !pointerTypeCanBeUndefined(source, left, leftType);
}

export function simplifyDisprovedPointerNilGuards(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
  values: readonly Node[],
): readonly Node[] {
  const operands = pointerOperands(operation);
  if (operands.length === 0) {
    return values;
  }
  const simplified = [...values];
  for (let index = 0; index < operands.length; index += 1) {
    const original = operands[index];
    const updated = simplified[index];
    if (
      original !== undefined &&
      updated !== undefined &&
      pointerNilGuardCanBeElided(source, original)
    ) {
      simplified[index] = elideSelectedPointerNilGuard(source, original, updated);
    }
  }
  return simplified;
}

export function elideSelectedPointerNilGuard(
  source: TargetSourceProgram,
  original: Node,
  updated: Node,
): Node {
  if (!pointerNilGuardCanBeElided(source, original)) {
    throw new PointerLoweringError(
      "selected pointer nil guard is not disproved by checked nullability",
    );
  }
  const binary = source.ast.as.AsBinaryExpression(updated);
  if (
    source.ast.operatorKindName(updated) !== "KindQuestionQuestionToken" ||
    binary?.Left === undefined ||
    binary.Right === undefined
  ) {
    throw new PointerLoweringError(
      "selected pointer nil guard lost its exact transformed binary shape",
    );
  }
  return binary.Left;
}

function pointerOperands(operation: PointerOperationFact): readonly Node[] {
  if (operation.operation === "equal-pointer") {
    return [operation.leftExpression, operation.rightExpression];
  }
  if (
    operation.operation === "load" ||
    operation.operation === "store" ||
    operation.operation === "hash-pointer"
  ) {
    return [operation.pointerExpression];
  }
  return [];
}
