import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  AsMethodDeclaration,
  AsReturnStatement,
  IsBlock,
  IsMethodDeclaration,
  IsReturnStatement,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function exactOperationMethod(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
): Node | undefined {
  const statement = source.ast.parent(operation.call);
  if (statement === undefined || !IsReturnStatement(statement)) {
    return undefined;
  }
  const body = source.ast.parent(statement);
  if (body === undefined || !IsBlock(body)) {
    return undefined;
  }
  const method = source.ast.parent(body);
  if (method === undefined || !IsMethodDeclaration(method)) {
    return undefined;
  }
  const parsed = AsMethodDeclaration(method);
  const statements = source.ast.statements(body);
  const returned = AsReturnStatement(statement);
  const parameterCount = operation.operation === "hash-pointer" ? 1 : 2;
  return parsed !== undefined &&
      statements.length === 1 &&
      returned?.Expression === operation.call &&
      parsed.TypeParameters === undefined &&
      source.ast.parameters(method).length === parameterCount &&
      source.ast.hasModifierKind(method, "private") &&
      source.ast.hasModifierKind(method, "static")
    ? method
    : undefined;
}
