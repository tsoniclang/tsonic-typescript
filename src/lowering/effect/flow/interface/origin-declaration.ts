import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../model/source-membership.js";
import { sourceValueReference } from "../../model/exact-source-invocation.js";

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
  certified?: ExactSourceBodyInspection,
): declaration is Node {
  if (
    declaration === undefined ||
    !sourceBodyInspectionIsExact(source, declaration, certified)
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

export function propertyValueIsReceiverIndependent(
  source: TargetSourceProgram,
  receiver: Node,
  declaration: Node,
): boolean {
  if (source.ast.hasModifierKind(declaration, "static")) {
    return true;
  }
  const reference = sourceValueReference(source, receiver);
  if (
    reference !== undefined &&
    source.ast.is.IsNamespaceImport(reference.declaration)
  ) {
    return true;
  }
  const receiverModule = source.navigation.declarationFor(receiver);
  const declarationFile = source.ast.getSourceFile(declaration);
  return receiverModule !== undefined &&
    source.ast.is.IsSourceFile(receiverModule) &&
    declarationFile === receiverModule;
}
