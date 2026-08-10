import type { Node, Symbol } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  SourceDeclarationReference,
  TargetSourceProgram,
} from "@tsonic/target-api";

export interface PointerReferenceCensus {
  referenceFor(node: Node | undefined): SourceDeclarationReference | undefined;
  tracks(declaration: Node | undefined): boolean;
  hasWrite(declaration: Node | undefined): boolean;
}

export interface PointerTrackedReferenceIndex {
  referenceFor(node: Node | undefined): SourceDeclarationReference | undefined;
}

export interface ExactDeclarationIndex {
  declarationFor(node: Node | undefined): Node | undefined;
}

export function indexExactDeclarations(
  source: TargetSourceProgram,
  declarations: ReadonlySet<Node>,
): ExactDeclarationIndex {
  const declarationsBySymbol = new Map<Symbol, Node>();
  for (const declaration of declarations) {
    const name = source.ast.name(declaration);
    for (const symbol of exactSymbolsAt(source, name)) {
      declarationsBySymbol.set(symbol, declaration);
    }
  }
  return Object.freeze({
    declarationFor(node: Node | undefined) {
      if (node === undefined) {
        return undefined;
      }
      for (const symbol of exactSymbolsAt(source, node)) {
        const declaration = declarationsBySymbol.get(symbol);
        if (declaration !== undefined) {
          return declaration;
        }
        const selected = source.semantics.forNode(node)
          .getSymbolDeclarations(symbol)
          .find((candidate) =>
            candidate !== undefined && declarations.has(candidate)
          );
        if (selected !== undefined) {
          return selected;
        }
      }
      return undefined;
    },
  });
}

export function indexPointerTrackedReferences(
  source: TargetSourceProgram,
  trackedDeclarations: ReadonlySet<Node>,
): PointerTrackedReferenceIndex {
  const trackedBySymbol = indexTrackedDeclarations(
    source,
    trackedDeclarations,
  );
  return Object.freeze({
    referenceFor(node: Node | undefined) {
      return node === undefined
        ? undefined
        : trackedReferenceFor(source, trackedBySymbol, node);
    },
  });
}

export function censusPointerReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  trackedDeclarations: ReadonlySet<Node>,
): PointerReferenceCensus {
  const index = indexPointerTrackedReferences(source, trackedDeclarations);
  const references = new Map<Node, SourceDeclarationReference>();
  const writtenDeclarations = new Set<Node>();
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const reference = index.referenceFor(node);
    if (reference === undefined) {
      continue;
    }
    references.set(node, reference);
    if (
      source.navigation.bindingWritesWithin(reference.symbol, node).length !== 0
    ) {
      writtenDeclarations.add(reference.declaration);
    }
  }
  return Object.freeze({
    referenceFor(node: Node | undefined) {
      return node === undefined ? undefined : references.get(node);
    },
    tracks(declaration: Node | undefined) {
      return declaration !== undefined && trackedDeclarations.has(declaration);
    },
    hasWrite(declaration: Node | undefined) {
      return declaration !== undefined && writtenDeclarations.has(declaration);
    },
  });
}

function indexTrackedDeclarations(
  source: TargetSourceProgram,
  declarations: ReadonlySet<Node>,
): ReadonlyMap<Symbol, SourceDeclarationReference> {
  const result = new Map<Symbol, SourceDeclarationReference>();
  for (const declaration of declarations) {
    const name = source.ast.name(declaration);
    const reference = source.navigation.sourceReferenceFor(name);
    if (reference === undefined || reference.declaration !== declaration) {
      continue;
    }
    result.set(reference.symbol, reference);
    for (const symbol of exactSymbolsAt(source, name)) {
      result.set(symbol, reference);
    }
  }
  return result;
}

function trackedReferenceFor(
  source: TargetSourceProgram,
  trackedBySymbol: ReadonlyMap<Symbol, SourceDeclarationReference>,
  node: Node,
): SourceDeclarationReference | undefined {
  for (const symbol of exactSymbolsAt(source, node)) {
    const tracked = trackedBySymbol.get(symbol);
    if (tracked !== undefined) {
      return tracked;
    }
  }
  return undefined;
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
  for (const symbol of [direct, resolved]) {
    if (symbol === undefined) {
      continue;
    }
    symbols.add(symbol);
    const aliased = isAliasSymbol(source, semantics, symbol)
      ? semantics.getAliasedSymbol(symbol)
      : undefined;
    if (aliased !== undefined) {
      symbols.add(aliased);
    }
  }
  return [...symbols];
}

function isAliasSymbol(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  symbol: Symbol,
): boolean {
  return semantics.getSymbolDeclarations(symbol).some((declaration) => {
    let current = declaration;
    for (let depth = 0; current !== undefined && depth < 3; depth += 1) {
      if (
        source.ast.is.IsImportClause(current) ||
        source.ast.is.IsImportSpecifier(current) ||
        source.ast.is.IsNamespaceImport(current) ||
        source.ast.is.IsExportSpecifier(current)
      ) {
        return true;
      }
      current = source.ast.parent(current);
    }
    return false;
  });
}
