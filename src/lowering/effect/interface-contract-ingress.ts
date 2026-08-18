import type { Node, Type } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceBindingWrite,
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";

import type { InterfaceContractRelevance } from "./interface-contract-relevance.js";
import {
  interfaceContractTypeDeclaration,
  type InterfaceContractMembership,
} from "./interface-contract-declarations.js";
import { callCrossesOpaqueInterfaceBoundary } from "./interface-contract-transport-context.js";
import { successfulValueExpression } from "./syntax.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import type { TargetProgramIndex } from "../program-index.js";
import type { InterfaceContractBoundaryLedger } from "./interface-contract-boundary.js";
import type { InterfaceContractImplementationLedger } from "./interface-contract-implementations.js";

export interface InterfaceContractIngress {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly entries: InterfaceContractMembership;
  readonly boundaries: InterfaceContractBoundaryLedger;
  readonly implementations: InterfaceContractImplementationLedger;
  readonly relevance: InterfaceContractRelevance;
  readonly transports?: StorageOwnerTransportContract;
}

export function retainUnprovenInterfaceIngress(
  semantics: SourceFileSemantics,
  expression: Node,
  sourceType: Type,
  targetType: Type,
  ingress: InterfaceContractIngress,
): void {
  const selectedSource = semantics.removeMissingOrUndefined(sourceType);
  if (selectedSource === undefined || semantics.isNever(selectedSource)) {
    return;
  }
  const selectedTarget = semantics.removeMissingOrUndefined(targetType);
  if (selectedTarget === undefined || semantics.isNever(selectedTarget)) {
    return;
  }
  const targetContracts = ingress.relevance.contracts(
    semantics,
    selectedTarget,
  );
  if (targetContracts.length === 0) {
    return;
  }
  const sourceContracts = ingress.relevance.contracts(
    semantics,
    selectedSource,
  );
  if (sourceContracts.length === 0) {
    const declaration = interfaceContractTypeDeclaration(
      semantics,
      selectedSource,
    );
    const sourceFile = declaration === undefined
      ? undefined
      : ingress.source.ast.getSourceFile(declaration);
    if (
      declaration === undefined ||
      sourceFile === undefined ||
      !ingress.source.ast.is.IsInterfaceDeclaration(declaration) ||
      !ingress.source.ast.isDeclarationFile(sourceFile)
    ) {
      for (const contract of targetContracts) {
        if (!interfaceValueOriginIsClosed(expression, contract, ingress)) {
          ingress.boundaries.mark(
            contract,
            "unproven-value-origin",
            expression,
          );
        }
      }
    }
    return;
  }
  for (const contract of sourceContracts) {
    if (!interfaceValueOriginIsClosed(expression, contract, ingress)) {
      ingress.boundaries.mark(
        contract,
        "unproven-value-origin",
        expression,
      );
    }
  }
}

export function retainOpenInterfaceReceiver(
  semantics: SourceFileSemantics,
  callNode: Node,
  call: ResolvedSourceCallInfo | undefined,
  ingress: InterfaceContractIngress,
): void {
  if (call === undefined) {
    return;
  }
  const declaration = semantics.getSignatureDeclaration(call.selectedSignature);
  if (declaration === undefined || !ingress.entries.has(declaration)) {
    return;
  }
  const receiver = call.sourceReceiver?.expression ??
    call.sourceCalleeAccess?.receiver.expression;
  if (
    receiver === undefined ||
    !interfaceValueOriginIsClosed(receiver, declaration, ingress)
  ) {
    ingress.boundaries.mark(
      declaration,
      "open-interface-receiver",
      receiver ?? callNode,
    );
  }
}

function interfaceValueOriginIsClosed(
  value: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node> = new Set(),
): boolean {
  const expression = successfulValueExpression(ingress.source, value);
  if (expression === undefined || seen.has(expression)) {
    return false;
  }
  seen.add(expression);
  if (expressionCannotSupplyImplementation(expression, ingress)) {
    return true;
  }
  if (ingress.source.ast.kind(expression) === KindThisKeyword) {
    return thisValueOriginIsClosed(expression, contract, ingress);
  }
  if (ingress.source.ast.is.IsPropertyAccessExpression(expression)) {
    const access = ingress.source.ast.as.AsPropertyAccessExpression(expression);
    const semantics = ingress.source.semantics.forNode(expression);
    const declaration = semantics.getResolvedPropertyAccessInfo(expression)
      ?.selectedDeclaration;
    const type = semantics.getTypeAtLocation(expression);
    return declarationIsClosed(declaration, ingress) &&
      type !== undefined &&
      typeProvidesContract(semantics, type, contract, ingress) &&
      access?.Expression !== undefined &&
      interfaceContainerOriginIsClosed(access.Expression, ingress, seen);
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
      ?.Expression;
    return owner !== undefined &&
      interfaceValueOriginIsClosed(owner, contract, ingress, seen);
  }
  if (ingress.source.ast.is.IsArrayLiteralExpression(expression)) {
    for (const element of ingress.source.ast.elements(expression)) {
      if (element === undefined) {
        continue;
      }
      const semantics = ingress.source.semantics.forNode(element);
      const type = semantics.getTypeAtLocation(element);
      if (
        type !== undefined &&
        typeProvidesContract(semantics, type, contract, ingress) &&
        !interfaceValueOriginIsClosed(element, contract, ingress, seen)
      ) {
        return false;
      }
    }
    return true;
  }
  if (ingress.source.ast.is.IsConditionalExpression(expression)) {
    const conditional = ingress.source.ast.as.AsConditionalExpression(expression);
    return conditional?.WhenTrue !== undefined &&
      conditional.WhenFalse !== undefined &&
      interfaceValueOriginIsClosed(
        conditional.WhenTrue,
        contract,
        ingress,
        new Set(seen),
      ) &&
      interfaceValueOriginIsClosed(
        conditional.WhenFalse,
        contract,
        ingress,
        new Set(seen),
      );
  }
  if (ingress.source.ast.is.IsNewExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.getResolvedCallInfo(expression);
    const declaration = call === undefined
      ? undefined
      : semantics.getSignatureDeclaration(call.selectedSignature) ??
        ingress.source.navigation.declarationFor(expression);
    const type = semantics.getTypeAtLocation(expression);
    return declarationIsClosed(declaration, ingress) &&
      type !== undefined &&
      typeProvidesContract(semantics, type, contract, ingress);
  }
  if (ingress.source.ast.is.IsCallExpression(expression)) {
    const transport = ingress.transports?.transportFor(expression);
    if (transport !== undefined) {
      return transport.resultInputs.length !== 0 &&
        transport.resultInputs.every((input) =>
          interfaceValueOriginIsClosed(
            input,
            contract,
            ingress,
            new Set(seen),
          )
        );
    }
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.getResolvedCallInfo(expression);
    const declaration = call === undefined
      ? undefined
      : semantics.getSignatureDeclaration(call.selectedSignature);
    return declaration !== undefined &&
      !callCrossesOpaqueInterfaceBoundary(ingress.source, declaration);
  }
  if (
    ingress.source.ast.is.IsArrowFunction(expression) ||
    ingress.source.ast.is.IsFunctionExpression(expression)
  ) {
    const sourceFile = ingress.source.ast.getSourceFile(expression);
    return sourceFile !== undefined &&
      ingress.source.semantics.includes(sourceFile);
  }
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    return false;
  }
  const refinement = ingress.source.semantics.selectValueTypeRefinement(
    expression,
  );
  if (
    refinement.kind !== "resolved" ||
    !typeProvidesContract(
      ingress.source.semantics.forNode(expression),
      refinement.declaredType,
      contract,
      ingress,
    ) ||
    !declarationIsClosed(refinement.reference.declaration, ingress)
  ) {
    return false;
  }
  return declarationValueOriginIsClosed(
    refinement.reference.declaration,
    contract,
    ingress,
    seen,
  );
}

function interfaceContainerOriginIsClosed(
  value: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node>,
): boolean {
  const expression = successfulValueExpression(ingress.source, value);
  if (expression === undefined || seen.has(expression)) {
    return false;
  }
  seen.add(expression);
  if (ingress.source.ast.kind(expression) === KindThisKeyword) {
    return thisContainerOriginIsClosed(expression, ingress);
  }
  if (ingress.source.ast.is.IsPropertyAccessExpression(expression)) {
    const access = ingress.source.ast.as.AsPropertyAccessExpression(expression);
    const declaration = ingress.source.semantics.forNode(expression)
      .getResolvedPropertyAccessInfo(expression)?.selectedDeclaration;
    return declarationIsClosed(declaration, ingress) &&
      access?.Expression !== undefined &&
      interfaceContainerOriginIsClosed(access.Expression, ingress, seen);
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
      ?.Expression;
    return owner !== undefined &&
      interfaceContainerOriginIsClosed(owner, ingress, seen);
  }
  if (
    ingress.source.ast.is.IsArrowFunction(expression) ||
    ingress.source.ast.is.IsFunctionExpression(expression)
  ) {
    const sourceFile = ingress.source.ast.getSourceFile(expression);
    return sourceFile !== undefined &&
      ingress.source.semantics.includes(sourceFile);
  }
  if (ingress.source.ast.is.IsCallExpression(expression)) {
    const transport = ingress.transports?.transportFor(expression);
    if (transport !== undefined) {
      return transport.resultInputs.length !== 0 &&
        transport.resultInputs.every((input) =>
          interfaceContainerOriginIsClosed(input, ingress, new Set(seen))
        );
    }
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.getResolvedCallInfo(expression);
    const declaration = call === undefined
      ? undefined
      : semantics.getSignatureDeclaration(call.selectedSignature);
    return declaration !== undefined &&
      !callCrossesOpaqueInterfaceBoundary(ingress.source, declaration);
  }
  if (ingress.source.ast.is.IsNewExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.getResolvedCallInfo(expression);
    const declaration = call === undefined
      ? ingress.source.navigation.declarationFor(expression)
      : semantics.getSignatureDeclaration(call.selectedSignature) ??
        ingress.source.navigation.declarationFor(expression);
    return declarationIsClosed(declaration, ingress);
  }
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    return false;
  }
  const reference = ingress.source.navigation.sourceReferenceFor(expression);
  if (!declarationIsClosed(reference?.declaration, ingress)) {
    return false;
  }
  const initializer = declarationInitializer(
    ingress.source,
    reference.declaration,
  );
  return initializer !== undefined
    ? interfaceContainerOriginIsClosed(initializer, ingress, seen)
    : declarationMayReceiveCheckedValues(ingress.source, reference.declaration);
}

function thisValueOriginIsClosed(
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

function thisContainerOriginIsClosed(
  expression: Node,
  ingress: InterfaceContractIngress,
): boolean {
  const semantics = ingress.source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  const declaration = type === undefined
    ? undefined
    : interfaceContractTypeDeclaration(semantics, type);
  return declarationIsClosed(declaration, ingress) &&
    (
      ingress.source.ast.is.IsClassDeclaration(declaration) ||
      ingress.source.ast.is.IsClassExpression(declaration)
    );
}

function declarationValueOriginIsClosed(
  declaration: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node>,
): boolean {
  const initializer = declarationInitializer(ingress.source, declaration);
  if (
    initializer !== undefined &&
    !interfaceValueOriginIsClosed(
      initializer,
      contract,
      ingress,
      new Set(seen),
    )
  ) {
    return false;
  }
  if (
    ingress.source.ast.is.IsVariableDeclaration(declaration) ||
    ingress.source.ast.is.IsPropertyDeclaration(declaration)
  ) {
    for (const write of ingress.program.bindingWritesFor(declaration)) {
      const input = exactBindingWriteInput(ingress.source, write);
      if (
        input === undefined ||
        !interfaceValueOriginIsClosed(
          input,
          contract,
          ingress,
          new Set(seen),
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return declarationMayReceiveCheckedValues(ingress.source, declaration);
}

function exactBindingWriteInput(
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

function expressionCannotSupplyImplementation(
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

function declarationMayReceiveCheckedValues(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return source.ast.is.IsVariableDeclaration(declaration) ||
    source.ast.is.IsPropertyDeclaration(declaration) ||
    source.ast.is.IsParameterDeclaration(declaration) ||
    source.ast.is.IsFunctionDeclaration(declaration) ||
    source.ast.is.IsMethodDeclaration(declaration);
}

function declarationIsClosed(
  declaration: Node | undefined,
  ingress: InterfaceContractIngress,
): declaration is Node {
  if (
    declaration === undefined ||
    !ingress.source.navigation.isProjectDeclaration(declaration)
  ) {
    return false;
  }
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    if (ingress.source.ast.hasModifierKind(current, "ambient")) {
      return false;
    }
    if (ingress.source.ast.is.IsSourceFile(current)) {
      return true;
    }
    current = ingress.source.ast.parent(current);
  }
  return false;
}

function declarationInitializer(
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

function typeProvidesContract(
  semantics: SourceFileSemantics,
  type: Type,
  contract: Node,
  ingress: InterfaceContractIngress,
): boolean {
  return ingress.relevance.contracts(semantics, type).includes(contract) ||
    ingress.implementations.typeProvidesContract(semantics, type, contract);
}
