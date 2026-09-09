import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { PointerLoweringError } from "./diagnostic.js";

export function requireVariableScope(source: TargetSourceProgram, declaration: Node): Node {
  for (
    let current = source.ast.parent(declaration);
    current !== undefined;
    current = source.ast.parent(current)
  ) {
    if (source.ast.is.IsSourceFile(current) || source.ast.is.IsModuleBlock(current)) return current;
    if (!source.ast.is.IsBlock(current)) continue;
    const parent = source.ast.parent(current);
    if (
      parent !== undefined &&
      (isFunctionLike(source, parent) || source.ast.is.IsClassStaticBlockDeclaration(parent)) &&
      source.ast.body(parent) === current
    ) {
      return current;
    }
  }
  throw new PointerLoweringError("addressed var binding has no exact variable scope");
}

function isFunctionLike(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsConstructorDeclaration(node) ||
    source.ast.is.IsGetAccessorDeclaration(node) ||
    source.ast.is.IsSetAccessorDeclaration(node);
}

export function requireStatementListOwner(source: TargetSourceProgram, statement: Node): void {
  const owner = source.ast.parent(statement);
  if (
    owner !== undefined &&
    (source.ast.is.IsSourceFile(owner) ||
      source.ast.is.IsBlock(owner) ||
      source.ast.is.IsModuleBlock(owner) ||
      source.ast.is.IsCaseClause(owner) ||
      source.ast.is.IsDefaultClause(owner))
  ) {
    return;
  }
  throw new PointerLoweringError("addressed let binding requires a statement-list owner");
}
