import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { transparentExpression } from "./syntax.js";
import { typeExposesCallableThen } from "./synchronous.js";

export function expressionIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return false;
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    return true;
  }
  const semantics = source.semantics.forNode(root);
  const type = semantics.getTypeAtLocation(root);
  if (
    type === undefined ||
    typeExposesCallableThen(semantics, type)
  ) {
    return false;
  }
  if (source.ast.is.IsArrayLiteralExpression(root)) {
    return true;
  }
  if (source.ast.is.IsObjectLiteralExpression(root)) {
    return objectLiteralIsDefinitelyNonThenable(source, root);
  }
  return semantics.isNever(type) ||
      semantics.isVoidLike(type) ||
      semantics.isNullish(type) ||
      semantics.isStringLike(type) ||
      semantics.isNumberLike(type) ||
      semantics.isBooleanLike(type) ||
      semantics.isBigIntLike(type);
}

function objectLiteralIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const properties = source.ast.as.AsObjectLiteralExpression(expression)
    ?.Properties?.Nodes;
  return properties !== undefined && properties.every((property) => {
    if (property === undefined || source.ast.is.IsSpreadAssignment(property)) {
      return false;
    }
    const name = source.ast.name(property);
    if (name === undefined || source.ast.is.IsComputedPropertyName(name)) {
      return false;
    }
    const text = source.ast.text(name);
    return text !== "then" && text !== "__proto__";
  });
}
