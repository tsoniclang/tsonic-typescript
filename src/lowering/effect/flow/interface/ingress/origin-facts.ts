import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import type { InterfaceContractIngress } from "../ingress.js";
import { interfaceContractTypeDeclaration } from "../declarations.js";
import { originDeclarationIsClosed } from "../origin-declaration.js";
import {
  exactReturnedCall,
  successfulValueExpression,
} from "../../../model/syntax.js";

export function classValueOriginIsClosed(
  semantics: SourceFileSemantics,
  classType: Type,
  contract: Node,
  ingress: InterfaceContractIngress,
): boolean {
  return typeProvidesContract(semantics, classType, contract, ingress);
}

export function thisValueOriginIsClosed(
  expression: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
): boolean {
  const semantics = ingress.source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  return type !== undefined &&
    typeProvidesContract(semantics, type, contract, ingress) &&
    thisContainerOriginIsClosed(expression, ingress);
}

export function thisContainerOriginIsClosed(
  expression: Node,
  ingress: InterfaceContractIngress,
): boolean {
  const semantics = ingress.source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  const declaration = type === undefined
    ? undefined
    : interfaceContractTypeDeclaration(semantics, type);
  return originDeclarationIsClosed(ingress.source, declaration) &&
    (
      ingress.source.ast.is.IsClassDeclaration(declaration) ||
      ingress.source.ast.is.IsClassExpression(declaration)
    );
}

export function successfulInterfaceValueExpression(
  source: TargetSourceProgram,
  value: Node,
): Node | undefined {
  let expression = successfulValueExpression(source, value);
  if (expression !== undefined && source.ast.is.IsSpreadElement(expression)) {
    expression = successfulValueExpression(
      source,
      source.ast.as.AsSpreadElement(expression)?.Expression,
    );
  }
  return expression === undefined
    ? undefined
    : exactReturnedCall(source, expression) ?? expression;
}

export function exactBindingWriteInput(
  source: TargetSourceProgram,
  write: SourceBindingWrite,
): Node | undefined {
  if (
    write.kind !== "assignment" ||
    !source.ast.is.IsBinaryExpression(write.operation) ||
    source.ast.operatorKindName(write.operation) !== "KindEqualsToken"
  ) {
    return undefined;
  }
  const assignment = source.ast.as.AsBinaryExpression(write.operation);
  return assignment?.Left === write.reference ? assignment.Right : undefined;
}

export function expressionCannotSupplyImplementation(
  expression: Node,
  ingress: InterfaceContractIngress,
): boolean {
  const semantics = ingress.source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  if (type === undefined) {
    return false;
  }
  const selected = semantics.removeMissingOrUndefined(type);
  return selected === undefined || semantics.isNever(selected);
}

export function typeProvidesContract(
  semantics: SourceFileSemantics,
  type: Type,
  contract: Node,
  ingress: InterfaceContractIngress,
): boolean {
  return ingress.relevance.contracts(semantics, type).includes(contract) ||
    typeHasCertifiedImplementation(semantics, type, contract, ingress);
}

export function typeHasCertifiedImplementation(
  semantics: SourceFileSemantics,
  type: Type,
  contract: Node,
  ingress: InterfaceContractIngress,
): boolean {
  return ingress.implementations.typeProvidesContract(
    semantics,
    type,
    contract,
  ) || ingress.implementations.recordTypeImplementations(
    semantics,
    type,
    [contract],
  );
}
