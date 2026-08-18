import type { Node, Type } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceBindingWrite,
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";

import type { InterfaceContractRelevance } from "./relevance.js";
import {
  interfaceContractTypeDeclaration,
  type InterfaceContractMembership,
} from "./declarations.js";
import { callCrossesOpaqueInterfaceBoundary } from "./transport-context.js";
import {
  exactReturnedCall,
  successfulValueExpression,
} from "../../model/syntax.js";
import { resolvedCallResultIsDefinitelyNonThenable } from "../../model/synchronous.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { InterfaceContractBoundaryLedger } from "./boundary.js";
import type { InterfaceContractImplementationLedger } from "./implementations.js";
import {
  type CompositeValueAlternative,
  compositeValueAlternatives,
} from "./composite-origin.js";
import {
  declarationMayReceiveCheckedValues,
  originDeclarationInitializer,
  originDeclarationIsClosed,
} from "./origin-declaration.js";

export interface InterfaceContractIngress {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly entries: InterfaceContractMembership;
  readonly boundaries: InterfaceContractBoundaryLedger;
  readonly implementations: InterfaceContractImplementationLedger;
  readonly relevance: InterfaceContractRelevance;
  readonly transports?: InvocationTransportContract;
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
  const targetContracts = ingress.relevance.valueContracts(
    semantics,
    selectedTarget,
  );
  if (targetContracts.length === 0) {
    return;
  }
  const sourceContracts = ingress.relevance.valueContracts(
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
    const certifiedSource = targetContracts.every((contract) =>
      ingress.implementations.typeProvidesContract(
        semantics,
        selectedSource,
        contract,
      )
    );
    if (
      !certifiedSource &&
      (
        declaration === undefined ||
        sourceFile === undefined ||
        !ingress.source.ast.is.IsInterfaceDeclaration(declaration) ||
        !ingress.source.ast.isDeclarationFile(sourceFile)
      )
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

export function interfaceValueOriginIsClosedForType(
  semantics: SourceFileSemantics,
  expression: Node,
  type: Type,
  ingress: InterfaceContractIngress,
): boolean {
  return ingress.relevance.valueContracts(semantics, type).every((contract) =>
    interfaceValueOriginIsClosed(expression, contract, ingress)
  );
}

function interfaceValueOriginIsClosed(
  value: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node> = new Set(),
): boolean {
  const expression = successfulInterfaceValueExpression(ingress.source, value);
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
    return originDeclarationIsClosed(ingress.source, declaration) &&
      type !== undefined &&
      typeProvidesContract(semantics, type, contract, ingress) &&
      access?.Expression !== undefined &&
      interfaceContainerOriginIsClosed(
        access.Expression,
        contract,
        ingress,
        seen,
      );
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const access = semantics.getResolvedElementAccessInfo(expression);
    const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
      ?.Expression;
    const type = access?.sourceReadType ??
      semantics.getTypeAtLocation(expression);
    return access !== undefined &&
      access.accessMode === "read" &&
      owner !== undefined &&
      access.receiver.expression === owner &&
      type !== undefined &&
      typeProvidesContract(semantics, type, contract, ingress) &&
      interfaceContainerOriginIsClosed(owner, contract, ingress, seen);
  }
  const alternatives = compositeValueAlternatives(ingress.source, expression);
  if (alternatives !== undefined) {
    return alternatives !== null && alternatives.every((alternative) =>
      compositeOriginBranchIsClosed(
        alternative,
        "value",
        contract,
        ingress,
        new Set(seen),
      )
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
    return originDeclarationIsClosed(ingress.source, declaration) &&
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
    return call !== undefined && declaration !== undefined &&
      (
        !callCrossesOpaqueInterfaceBoundary(ingress.source, declaration) ||
        (
          resolvedCallResultIsDefinitelyNonThenable(
            ingress.source,
            expression,
          ) &&
          typeHasCertifiedImplementation(
            semantics,
            call.sourceResultType,
            contract,
            ingress,
          )
        )
      );
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
    !originDeclarationIsClosed(
      ingress.source,
      refinement.reference.declaration,
    )
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
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node>,
): boolean {
  const expression = successfulInterfaceValueExpression(ingress.source, value);
  if (expression === undefined || seen.has(expression)) {
    return false;
  }
  seen.add(expression);
  if (ingress.source.ast.kind(expression) === KindThisKeyword) {
    return thisContainerOriginIsClosed(expression, ingress);
  }
  const alternatives = compositeValueAlternatives(ingress.source, expression);
  if (alternatives !== undefined) {
    return alternatives !== null && alternatives.every((alternative) =>
      compositeOriginBranchIsClosed(
        alternative,
        "container",
        contract,
        ingress,
        new Set(seen),
      )
    );
  }
  if (ingress.source.ast.is.IsPropertyAccessExpression(expression)) {
    const access = ingress.source.ast.as.AsPropertyAccessExpression(expression);
    const declaration = ingress.source.semantics.forNode(expression)
      .getResolvedPropertyAccessInfo(expression)?.selectedDeclaration;
    return originDeclarationIsClosed(ingress.source, declaration) &&
      access?.Expression !== undefined &&
      interfaceContainerOriginIsClosed(
        access.Expression,
        contract,
        ingress,
        seen,
      );
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
      ?.Expression;
    return owner !== undefined &&
      interfaceContainerOriginIsClosed(owner, contract, ingress, seen);
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
          interfaceContainerOriginIsClosed(
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
  if (ingress.source.ast.is.IsNewExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.getResolvedCallInfo(expression);
    const declaration = call === undefined
      ? ingress.source.navigation.declarationFor(expression)
      : semantics.getSignatureDeclaration(call.selectedSignature) ??
        ingress.source.navigation.declarationFor(expression);
    return originDeclarationIsClosed(ingress.source, declaration);
  }
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    return false;
  }
  const reference = ingress.source.navigation.sourceReferenceFor(expression);
  if (!originDeclarationIsClosed(ingress.source, reference?.declaration)) {
    return false;
  }
  const initializer = originDeclarationInitializer(
    ingress.source,
    reference.declaration,
  );
  return initializer !== undefined
    ? interfaceContainerOriginIsClosed(
      initializer,
      contract,
      ingress,
      seen,
    )
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

function successfulInterfaceValueExpression(
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

function thisContainerOriginIsClosed(
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

function declarationValueOriginIsClosed(
  declaration: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node>,
): boolean {
  const initializer = originDeclarationInitializer(
    ingress.source,
    declaration,
  );
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

function valueOriginBranchIsClosed(
  value: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node>,
): boolean {
  const semantics = ingress.source.semantics.forNode(value);
  const type = semantics.getTypeAtLocation(value);
  return type !== undefined &&
    (
      !ingress.relevance.valueContracts(semantics, type).includes(contract) ||
      interfaceValueOriginIsClosed(value, contract, ingress, seen)
    );
}

function compositeOriginBranchIsClosed(
  alternative: CompositeValueAlternative,
  inheritedRole: "value" | "container",
  contract: Node,
  ingress: InterfaceContractIngress,
  seen: Set<Node>,
): boolean {
  const role = alternative.role === "same"
    ? inheritedRole
    : alternative.role;
  return role === "container"
    ? interfaceContainerOriginIsClosed(
      alternative.expression,
      contract,
      ingress,
      seen,
    )
    : valueOriginBranchIsClosed(
      alternative.expression,
      contract,
      ingress,
      seen,
    );
}

function typeProvidesContract(
  semantics: SourceFileSemantics,
  type: Type,
  contract: Node,
  ingress: InterfaceContractIngress,
): boolean {
  return ingress.relevance.contracts(semantics, type).includes(contract) ||
    typeHasCertifiedImplementation(semantics, type, contract, ingress);
}

function typeHasCertifiedImplementation(
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
