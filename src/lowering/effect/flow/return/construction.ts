import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { isFunctionLike } from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";

export function projectConstructionIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
  type: Type,
): boolean {
  const semantics = source.semantics.forNode(expression);
  if (semantics.couldContainTypeVariables(type)) {
    return false;
  }
  const constructor = resolveProjectInvocation(source, expression)?.implementation;
  if (
    constructor === undefined ||
    !source.ast.is.IsConstructorDeclaration(constructor) ||
    source.ast.body(constructor) === undefined
  ) {
    return false;
  }
  const classDeclaration = source.ast.parent(constructor);
  return classDeclaration !== undefined &&
    source.ast.is.IsClassDeclaration(classDeclaration) &&
    source.ast.extendsHeritageElements(classDeclaration).length === 0 &&
    !constructorReturnsObject(source, constructor);
}

export function objectLiteralIsDefinitelyNonThenable(
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

function constructorReturnsObject(
  source: TargetSourceProgram,
  constructor: Node,
): boolean {
  const body = source.ast.body(constructor);
  if (body === undefined) {
    return true;
  }
  const pending = [body];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (node !== body && isFunctionLike(source, node)) {
      continue;
    }
    if (
      source.ast.is.IsReturnStatement(node) &&
      source.ast.as.AsReturnStatement(node)?.Expression !== undefined
    ) {
      return true;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return false;
}
