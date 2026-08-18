import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

export interface InterfaceContractMembership {
  has(declaration: Node): boolean;
}

export function interfaceContractTypeDeclaration(
  semantics: SourceFileSemantics,
  type: Type,
): Node | undefined {
  const target = semantics.isTypeReference(type)
    ? semantics.getTypeReferenceTarget(type) ?? type
    : type;
  const symbols = [
    semantics.getTypeSymbol(target),
    semantics.getTypeAliasSymbol(target),
    semantics.getTypeSymbol(type),
    semantics.getTypeAliasSymbol(type),
  ].filter((symbol, index, selected) =>
    symbol !== undefined && selected.indexOf(symbol) === index
  );
  const declarations = symbols.flatMap((symbol) =>
    semantics.getSymbolDeclarations(symbol)
  ).filter((declaration, index, selected) =>
    declaration !== undefined && selected.indexOf(declaration) === index
  );
  return declarations.length === 1 ? declarations[0] : undefined;
}

export function interfaceContractsForProperty(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  symbol: Parameters<SourceFileSemantics["getSymbolDeclarations"]>[0],
  owner: Node | undefined,
  name: string,
  entries: InterfaceContractMembership,
  declarationContracts: ReadonlyMap<Node, readonly Node[]>,
): readonly Node[] {
  const result = new Set(
    semantics.getSymbolDeclarations(symbol)
      .filter((declaration): declaration is Node =>
        declaration !== undefined && entries.has(declaration)
      ),
  );
  if (owner !== undefined && isInterfaceContractClassLike(source, owner)) {
    for (const contract of declarationContracts.get(owner) ?? []) {
      const contractName = source.ast.name(contract);
      if (
        contractName !== undefined &&
        source.ast.text(contractName) === name
      ) {
        result.add(contract);
      }
    }
  }
  return [...result];
}

export function isExactInterfaceProjectDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile !== undefined &&
    source.semantics.includes(sourceFile) &&
    source.navigation.isProjectDeclaration(declaration);
}

export function isInterfaceContractDeclaration(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): boolean {
  return declaration !== undefined &&
    source.ast.is.IsInterfaceDeclaration(declaration);
}

function isInterfaceContractClassLike(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): boolean {
  return declaration !== undefined &&
    (
      source.ast.is.IsClassDeclaration(declaration) ||
      source.ast.is.IsClassExpression(declaration)
    );
}
