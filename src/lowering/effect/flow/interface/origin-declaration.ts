import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export function declarationMayReceiveCheckedValues(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return source.ast.is.IsFunctionDeclaration(declaration) ||
    source.ast.is.IsMethodDeclaration(declaration);
}

export function originDeclarationIsClosed(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): declaration is Node {
  if (
    declaration === undefined ||
    !source.navigation.isProjectDeclaration(declaration)
  ) {
    return false;
  }
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    if (source.ast.hasModifierKind(current, "ambient")) {
      return false;
    }
    if (source.ast.is.IsSourceFile(current)) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
}

export function originDeclarationInitializer(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  if (source.ast.is.IsVariableDeclaration(declaration)) {
    return source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
  }
  if (source.ast.is.IsPropertyDeclaration(declaration)) {
    return source.ast.as.AsPropertyDeclaration(declaration)?.Initializer;
  }
  return source.ast.is.IsParameterDeclaration(declaration)
    ? source.ast.as.AsParameterDeclaration(declaration)?.Initializer
    : undefined;
}
