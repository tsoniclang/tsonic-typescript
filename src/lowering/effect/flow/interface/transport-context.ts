import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { isExactInterfaceProjectDeclaration } from "./declarations.js";
import { projectCallableImplementation } from "../../model/project-invocation.js";

export function callCrossesOpaqueInterfaceBoundary(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): boolean {
  if (declaration === undefined) {
    return true;
  }
  if (
    !isExactInterfaceProjectDeclaration(source, declaration) ||
    source.ast.hasModifierKind(declaration, "ambient")
  ) {
    return true;
  }
  if (
    source.ast.is.IsFunctionTypeNode(declaration) ||
    source.ast.is.IsConstructorTypeNode(declaration) ||
    source.ast.is.IsCallSignatureDeclaration(declaration) ||
    source.ast.is.IsConstructSignatureDeclaration(declaration) ||
    source.ast.is.IsMethodSignatureDeclaration(declaration)
  ) {
    return false;
  }
  return projectCallableImplementation(source, declaration) === undefined;
}

export function isFreshInterfaceTransportAggregate(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  let current = expression;
  while (true) {
    if (
      source.ast.is.IsArrayLiteralExpression(current) ||
      source.ast.is.IsObjectLiteralExpression(current)
    ) {
      return true;
    }
    const next = transparentExpression(source, current);
    if (next === undefined) {
      return false;
    }
    current = next;
  }
}

function transparentExpression(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  if (source.ast.is.IsParenthesizedExpression(expression)) {
    return source.ast.as.AsParenthesizedExpression(expression)?.Expression;
  }
  if (source.ast.is.IsAsExpression(expression)) {
    return source.ast.as.AsAsExpression(expression)?.Expression;
  }
  if (source.ast.is.IsTypeAssertion(expression)) {
    return source.ast.as.AsTypeAssertion(expression)?.Expression;
  }
  if (source.ast.is.IsSatisfiesExpression(expression)) {
    return source.ast.as.AsSatisfiesExpression(expression)?.Expression;
  }
  return source.ast.is.IsNonNullExpression(expression)
    ? source.ast.as.AsNonNullExpression(expression)?.Expression
    : undefined;
}
