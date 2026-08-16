import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { isExactInterfaceProjectDeclaration } from "./interface-contract-declarations.js";

export function declaredInterfaceMemberImplementation(
  source: TargetSourceProgram,
  classDeclaration: Node,
  contractDeclaration: Node,
): Node | undefined {
  const contractOwner = source.ast.parent(contractDeclaration);
  if (
    !source.ast.is.IsClassDeclaration(classDeclaration) ||
    contractOwner === undefined ||
    source.navigation.declaredHeritagePath(
        classDeclaration,
        contractOwner,
      ).kind !== "related"
  ) {
    return undefined;
  }
  const className = source.ast.name(classDeclaration);
  const contractName = source.ast.name(contractDeclaration);
  if (
    className === undefined ||
    contractName === undefined ||
    !(
      source.ast.is.IsIdentifier(contractName) ||
      source.ast.is.IsStringLiteral(contractName) ||
      source.ast.is.IsNumericLiteral(contractName)
    )
  ) {
    return undefined;
  }
  const semantics = source.semantics.forNode(className);
  const classSymbol = semantics.getSymbolAtLocation(className);
  if (classSymbol === undefined) {
    return undefined;
  }
  const classType = semantics.getDeclaredTypeOfSymbol(classSymbol);
  if (classType === undefined) {
    return undefined;
  }
  const implementationSymbol = semantics.getPropertyOfType(
    classType,
    source.ast.text(contractName),
  );
  if (implementationSymbol === undefined) {
    return undefined;
  }
  const declarations = semantics.getSymbolDeclarations(implementationSymbol)
    .filter((candidate): candidate is Node =>
      candidate !== undefined &&
      source.ast.is.IsMethodDeclaration(candidate) &&
      source.ast.body(candidate) !== undefined &&
      isExactInterfaceProjectDeclaration(source, candidate)
    );
  return declarations.length === 1 ? declarations[0] : undefined;
}
