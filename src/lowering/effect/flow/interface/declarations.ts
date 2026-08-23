import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import { nodeHasExactSourceSemantics } from "../../model/source-membership.js";

export interface InterfaceContractMembership {
  has(declaration: Node): boolean;
}

export function interfaceContractTypeDeclaration(
  semantics: SourceFileSemantics,
  type: Type,
): Node | undefined {
  const target = semantics.types.isTypeReference(type)
    ? semantics.types.typeReferenceTarget(type) ?? type
    : type;
  const symbols = [
    semantics.declarations.typeSymbol(target),
    semantics.declarations.typeAliasSymbol(target),
    semantics.declarations.typeSymbol(type),
    semantics.declarations.typeAliasSymbol(type),
  ].filter((symbol, index, selected): symbol is NonNullable<typeof symbol> =>
    symbol !== undefined && selected.indexOf(symbol) === index
  );
  const declarations = symbols.flatMap((symbol) =>
    semantics.declarations.symbolDeclarations(symbol)
  ).filter((declaration, index, selected) =>
    declaration !== undefined && selected.indexOf(declaration) === index
  );
  return declarations.length === 1 ? declarations[0] : undefined;
}

export function interfaceContractsForProperty(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  symbol: Parameters<SourceFileSemantics["declarations"]["symbolDeclarations"]>[0],
  owner: Node | undefined,
  name: string,
  entries: InterfaceContractMembership,
  declarationContracts: ReadonlyMap<Node, readonly Node[]>,
): readonly Node[] {
  const result = new Set(
    semantics.declarations.symbolDeclarations(symbol)
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
  return nodeHasExactSourceSemantics(source, declaration) &&
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
