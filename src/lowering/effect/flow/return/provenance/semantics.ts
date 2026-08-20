import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../../../../program-index.js";
import {
  callableDispatchIsClosed,
} from "../../../model/syntax.js";
import { typeExposesCallableThen } from "../../../model/synchronous.js";
import { typeHasDefinitelyNonThenableContract } from "../../../../thenability.js";
import {
  objectLiteralIsDefinitelyNonThenable,
  projectConstructionIsDefinitelyNonThenable,
} from "../construction.js";

export function staticallyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  if (source.ast.is.IsAwaitExpression(expression)) {
    return true;
  }
  const semantics = source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  if (type === undefined || typeExposesCallableThen(semantics, type)) {
    return false;
  }
  if (
    source.ast.is.IsArrayLiteralExpression(expression) ||
    source.ast.is.IsArrowFunction(expression) ||
    source.ast.is.IsFunctionExpression(expression)
  ) {
    return true;
  }
  if (source.ast.is.IsObjectLiteralExpression(expression)) {
    return objectLiteralIsDefinitelyNonThenable(source, expression);
  }
  if (source.ast.is.IsNewExpression(expression)) {
    return typeHasDefinitelyNonThenableContract(source, semantics, type) ||
      projectConstructionIsDefinitelyNonThenable(source, expression, type);
  }
  return typeHasDefinitelyNonThenableContract(source, semantics, type);
}

export function callableResultIsInspectable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  declaration: Node,
): boolean {
  if (
    !source.navigation.isProjectDeclaration(declaration) ||
    source.ast.body(declaration) === undefined ||
    !callableDispatchIsClosed(source, program, declaration) ||
    (source.ast.hasModifierKind(declaration, "async") &&
      !candidates.has(declaration))
  ) {
    return false;
  }
  if (source.ast.is.IsFunctionDeclaration(declaration)) {
    return source.ast.as.AsFunctionDeclaration(declaration)?.AsteriskToken ===
      undefined;
  }
  if (source.ast.is.IsFunctionExpression(declaration)) {
    return source.ast.as.AsFunctionExpression(declaration)?.AsteriskToken ===
      undefined;
  }
  if (source.ast.is.IsMethodDeclaration(declaration)) {
    return source.ast.as.AsMethodDeclaration(declaration)?.AsteriskToken ===
      undefined;
  }
  return source.ast.is.IsArrowFunction(declaration);
}
