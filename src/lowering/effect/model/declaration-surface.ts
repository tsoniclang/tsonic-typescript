import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TypeScriptActiveCooperativeEffectProfile } from "../../profile.js";

export function declarationIsAmbient(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    if (source.ast.hasModifierKind(current, "ambient")) {
      return true;
    }
    current = source.ast.parent(current);
  }
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile === undefined || source.ast.isDeclarationFile(sourceFile);
}

export function declarationIsExported(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (
    source.ast.hasModifierKind(declaration, "export") ||
    source.ast.hasModifierKind(declaration, "default")
  ) {
    return true;
  }
  let selected = declaration;
  while (source.ast.is.IsBindingElement(selected)) {
    const pattern = source.ast.parent(selected);
    const owner = source.ast.parent(pattern);
    if (owner === undefined) {
      return true;
    }
    selected = owner;
  }
  if (!source.ast.is.IsVariableDeclaration(selected)) {
    return false;
  }
  const declarationList = source.ast.parent(selected);
  const statement = source.ast.parent(declarationList);
  return statement !== undefined &&
    source.ast.is.IsVariableStatement(statement) &&
    (source.ast.hasModifierKind(statement, "export") ||
      source.ast.hasModifierKind(statement, "default"));
}

export function expressionIsExportedBindingInitializer(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const declaration = source.ast.parent(expression);
  return declaration !== undefined &&
    source.ast.is.IsVariableDeclaration(declaration) &&
    source.ast.as.AsVariableDeclaration(declaration)?.Initializer === expression &&
    declarationIsExported(source, declaration);
}

export function callableHasOpenInvocationSurface(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (
    declarationIsAmbient(source, declaration) ||
    declarationIsExported(source, declaration)
  ) {
    return true;
  }
  if (
    source.ast.is.IsArrowFunction(declaration) ||
    source.ast.is.IsFunctionExpression(declaration) ||
    source.ast.is.IsClassExpression(declaration) ||
    source.ast.is.IsObjectLiteralExpression(declaration)
  ) {
    return expressionIsExportedBindingInitializer(source, declaration);
  }
  if (
    !source.ast.is.IsMethodDeclaration(declaration) &&
    !source.ast.is.IsConstructorDeclaration(declaration) &&
    !source.ast.is.IsGetAccessorDeclaration(declaration) &&
    !source.ast.is.IsSetAccessorDeclaration(declaration)
  ) {
    return false;
  }
  if (source.ast.hasModifierKind(declaration, "private")) {
    return false;
  }
  const container = source.ast.parent(declaration);
  return container !== undefined &&
    (source.ast.is.IsClassDeclaration(container) &&
        declarationIsExported(source, container) ||
      (source.ast.is.IsClassExpression(container) ||
          source.ast.is.IsObjectLiteralExpression(container)) &&
        expressionIsExportedBindingInitializer(source, container));
}

export function parameterHasExternalInvocationSurface(
  source: TargetSourceProgram,
  parameter: Node,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): boolean {
  const owner = source.ast.parent(parameter);
  return owner === undefined ||
    declarationIsAmbient(source, owner) ||
    (cooperativeEffects === "closed-direct" &&
      callableHasOpenInvocationSurface(source, owner));
}
