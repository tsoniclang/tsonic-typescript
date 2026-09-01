import type { Node } from "@tsonic/tsts";
import {
  AsExportDeclaration,
  AsImportClause,
  AsImportDeclaration,
  AsNamedExports,
  AsNamedImports,
  IsExportDeclaration,
  IsImportClause,
  IsImportDeclaration,
  IsNamedExports,
  IsNamedImports,
} from "@tsonic/tsts/target-ast";

export function pruneEmptyModuleBindingContainer(
  original: Node,
  updated: Node,
): Node | undefined {
  const namedImports = IsNamedImports(updated) ? AsNamedImports(updated) : undefined;
  if (namedImports !== undefined && namedImports.Elements?.Nodes.length === 0) {
    return undefined;
  }
  const importClause = IsImportClause(updated) ? AsImportClause(updated) : undefined;
  if (
    importClause !== undefined &&
    importClause.name === undefined &&
    importClause.NamedBindings === undefined
  ) {
    return undefined;
  }
  const importDeclaration = IsImportDeclaration(updated)
    ? AsImportDeclaration(updated)
    : undefined;
  if (
    importDeclaration !== undefined &&
    IsImportDeclaration(original) &&
    AsImportDeclaration(original)?.ImportClause !== undefined &&
    importDeclaration.ImportClause === undefined
  ) {
    return undefined;
  }
  const namedExports = IsNamedExports(updated) ? AsNamedExports(updated) : undefined;
  if (namedExports !== undefined && namedExports.Elements?.Nodes.length === 0) {
    return undefined;
  }
  const exportDeclaration = IsExportDeclaration(updated)
    ? AsExportDeclaration(updated)
    : undefined;
  if (
    exportDeclaration !== undefined &&
    IsExportDeclaration(original) &&
    AsExportDeclaration(original)?.ExportClause !== undefined &&
    exportDeclaration.ExportClause === undefined
  ) {
    return undefined;
  }
  return updated;
}
