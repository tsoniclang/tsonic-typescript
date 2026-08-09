import type { Node, Symbol } from "@tsonic/tsts";
import type {
  SourceDeclarationReference,
  TargetSourceProgram,
} from "@tsonic/target-api";

export interface PointerReferenceCensus {
  referenceFor(node: Node | undefined): SourceDeclarationReference | undefined;
  tracks(declaration: Node | undefined): boolean;
  hasWrite(declaration: Node | undefined): boolean;
}

export function censusPointerReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  trackedDeclarations: ReadonlySet<Node>,
): PointerReferenceCensus {
  const trackedBySymbol = indexTrackedDeclarations(source, trackedDeclarations);
  const references = new Map<Node, SourceDeclarationReference>();
  const writtenDeclarations = new Set<Node>();
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const reference = trackedReferenceFor(source, trackedBySymbol, node);
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
  if (direct !== undefined) {
    symbols.add(direct);
  }
  if (resolved !== undefined) {
    symbols.add(resolved);
  }
  return [...symbols];
}
