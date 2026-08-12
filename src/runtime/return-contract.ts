import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { typeScriptRuntimeModule } from "./package-contract.js";

const nonThenableRuntimeResults = new Set([
  "boundLocation",
  "location",
  "nestedPropertyLocation",
  "projectLocation",
  "propertyLocation",
  "rawPointer",
]);

export interface TypeScriptRuntimeReturnContract {
  callResultIsDefinitelyNonThenable(call: Node): boolean;
}

export function createTypeScriptRuntimeReturnContract(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): TypeScriptRuntimeReturnContract {
  const namespaces = new Set<Symbol>();
  const importedOperations = new Map<Symbol, string>();
  for (const node of nodes) {
    if (!source.ast.is.IsImportDeclaration(node)) {
      continue;
    }
    const declaration = source.ast.as.AsImportDeclaration(node);
    if (
      declaration?.ModuleSpecifier === undefined ||
      source.ast.text(declaration.ModuleSpecifier) !== typeScriptRuntimeModule ||
      declaration.ImportClause === undefined ||
      !source.ast.is.IsImportClause(declaration.ImportClause)
    ) {
      continue;
    }
    const bindings = source.ast.as.AsImportClause(declaration.ImportClause)
      ?.NamedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (source.ast.is.IsNamespaceImport(bindings)) {
      for (const symbol of exactSymbolsAt(source, source.ast.name(bindings))) {
        namespaces.add(symbol);
      }
      continue;
    }
    if (!source.ast.is.IsNamedImports(bindings)) {
      continue;
    }
    for (const specifier of source.ast.elements(bindings)) {
      if (specifier === undefined || !source.ast.is.IsImportSpecifier(specifier)) {
        continue;
      }
      const imported = source.ast.as.AsImportSpecifier(specifier)?.PropertyName ??
        source.ast.name(specifier);
      const operation = imported === undefined ? undefined : source.ast.text(imported);
      if (operation === undefined || !nonThenableRuntimeResults.has(operation)) {
        continue;
      }
      for (const symbol of exactSymbolsAt(source, source.ast.name(specifier))) {
        importedOperations.set(symbol, operation);
      }
    }
  }
  return Object.freeze({
    callResultIsDefinitelyNonThenable(call: Node): boolean {
      if (!source.ast.is.IsCallExpression(call)) {
        return false;
      }
      const expression = source.ast.as.AsCallExpression(call)?.Expression;
      if (expression === undefined) {
        return false;
      }
      if (source.ast.is.IsIdentifier(expression)) {
        return exactSymbolsAt(source, expression).some((symbol) =>
          importedOperations.has(symbol)
        );
      }
      if (!source.ast.is.IsPropertyAccessExpression(expression)) {
        return false;
      }
      const access = source.ast.as.AsPropertyAccessExpression(expression);
      const receiver = access?.Expression;
      const name = access?.name;
      if (
        receiver === undefined ||
        name === undefined ||
        !source.ast.is.IsIdentifier(receiver) ||
        !nonThenableRuntimeResults.has(source.ast.text(name))
      ) {
        return false;
      }
      return exactSymbolsAt(source, receiver).some((symbol) =>
        namespaces.has(symbol)
      );
    },
  });
}

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node | undefined,
): readonly Symbol[] {
  if (node === undefined) {
    return [];
  }
  const semantics = source.semantics.forNode(node);
  const symbols = new Set<Symbol>();
  const direct = semantics.getSymbolAtLocation(node);
  const resolved = semantics.getResolvedSymbol(node);
  if (direct !== undefined) {
    symbols.add(direct);
  }
  if (resolved !== undefined) {
    symbols.add(resolved);
  }
  return [...symbols];
}
