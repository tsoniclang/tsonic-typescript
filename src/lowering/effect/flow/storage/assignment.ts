import type { Node } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

export function exactBindingWriteInput(
  source: TargetSourceProgram,
  write: SourceBindingWrite,
): Node | undefined {
  if (
    write.kind !== "assignment" ||
    !source.ast.is.IsBinaryExpression(write.operation)
  ) {
    return undefined;
  }
  return exactAssignmentInput(source, write.operation, write.reference);
}

export function exactConstructorFieldWriteInput(
  source: TargetSourceProgram,
  write: SourceBindingWrite,
  declaration: Node,
): Node | undefined {
  const input = exactBindingWriteInput(source, write);
  if (input === undefined || !source.ast.is.IsPropertyDeclaration(declaration)) {
    return undefined;
  }
  const owner = source.ast.parent(declaration);
  let current = source.ast.parent(write.reference);
  while (current !== undefined) {
    if (
      source.ast.is.IsFunctionDeclaration(current) ||
      source.ast.is.IsFunctionExpression(current) ||
      source.ast.is.IsArrowFunction(current) ||
      source.ast.is.IsMethodDeclaration(current) ||
      source.ast.is.IsGetAccessorDeclaration(current) ||
      source.ast.is.IsSetAccessorDeclaration(current)
    ) {
      return undefined;
    }
    if (source.ast.is.IsConstructorDeclaration(current)) {
      return source.ast.parent(current) === owner ? input : undefined;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

export function exactAssignmentInput(
  source: TargetSourceProgram,
  operation: Node,
  target: Node,
): Node | undefined {
  if (
    !source.ast.is.IsBinaryExpression(operation) ||
    !isExactValueAssignmentOperator(source.ast.operatorKindName(operation))
  ) {
    return undefined;
  }
  const assignment = source.ast.as.AsBinaryExpression(operation);
  return assignment?.Left === target ? assignment.Right : undefined;
}

export function isExactValueAssignmentOperator(
  operator: string | undefined,
): boolean {
  return operator !== undefined && valueAssignmentOperators.has(operator);
}

const valueAssignmentOperators = new Set([
  "KindEqualsToken",
  "KindAmpersandAmpersandEqualsToken",
  "KindBarBarEqualsToken",
  "KindQuestionQuestionEqualsToken",
]);
