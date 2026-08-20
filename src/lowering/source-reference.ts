import type { Node } from "@tsonic/tsts";
import {
  sourceNodesEqual,
  type TargetSourceProgram,
} from "@tsonic/target-api";

export function isModuleForwardingReference(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (
      source.ast.is.IsImportClause(current) ||
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsNamespaceImport(current) ||
      source.ast.is.IsExportSpecifier(current) ||
      source.ast.is.IsImportDeclaration(current) ||
      source.ast.is.IsExportDeclaration(current)
    ) {
      return true;
    }
    if (!source.ast.is.IsNamedImports(current)) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

export function isProjectDeclarationName(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  const name = parent === undefined ? undefined : source.ast.name(parent);
  return parent !== undefined &&
    source.navigation.isProjectDeclaration(parent) &&
    (name === node || sourceNodesEqual(source.ast, name, node));
}

export function isProjectDeclarationOnlyName(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  if (!isProjectDeclarationName(source, node)) {
    return false;
  }
  const parent = source.ast.parent(node);
  return parent === undefined || (
    !source.ast.is.IsShorthandPropertyAssignment(parent) &&
    !isModuleForwardingReference(source, node)
  );
}
