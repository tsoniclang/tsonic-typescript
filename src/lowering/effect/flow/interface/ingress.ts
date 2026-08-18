import type { Node, Type } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
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
  resolvedCallResultIsDefinitelyNonThenable,
} from "../../model/synchronous.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { InterfaceContractBoundaryLedger } from "./boundary.js";
import type { InterfaceContractImplementationLedger } from "./implementations.js";
import type { OpaqueInterfaceInputLedger } from "./opaque-inputs.js";
import {
  type CompositeValueAlternative,
  compositeValueAlternatives,
} from "./composite-origin.js";
import {
  declarationMayReceiveCheckedValues,
  originDeclarationInitializer,
  originDeclarationIsClosed,
} from "./origin-declaration.js";
import {
  classValueOriginIsClosed,
  exactBindingWriteInput,
  expressionCannotSupplyImplementation,
  successfulInterfaceValueExpression,
  thisContainerOriginIsClosed,
  thisValueOriginIsClosed,
  typeHasCertifiedImplementation,
  typeProvidesContract,
} from "./ingress/origin-facts.js";

export interface InterfaceContractIngress {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly entries: InterfaceContractMembership;
  readonly boundaries: InterfaceContractBoundaryLedger;
  readonly implementations: InterfaceContractImplementationLedger;
  readonly relevance: InterfaceContractRelevance;
  readonly opaqueInputs: OpaqueInterfaceInputLedger;
  readonly transports?: InvocationTransportContract;
}

interface InterfaceOriginProbe {
  opaqueInput: boolean;
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
        const probe: InterfaceOriginProbe = { opaqueInput: false };
        if (!interfaceValueOriginIsClosed(expression, contract, ingress, probe)) {
          ingress.boundaries.mark(
            contract,
            probe.opaqueInput
              ? "opaque-call-transport"
              : "unproven-value-origin",
            expression,
          );
        }
      }
    }
    return;
  }
  for (const contract of sourceContracts) {
    const probe: InterfaceOriginProbe = { opaqueInput: false };
    if (!interfaceValueOriginIsClosed(expression, contract, ingress, probe)) {
      ingress.boundaries.mark(
        contract,
        probe.opaqueInput
          ? "opaque-call-transport"
          : "unproven-value-origin",
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
  const probe: InterfaceOriginProbe = { opaqueInput: false };
  if (
    receiver === undefined ||
    !interfaceValueOriginIsClosed(receiver, declaration, ingress, probe)
  ) {
    ingress.boundaries.mark(
      declaration,
      "open-interface-receiver",
      receiver ?? callNode,
    );
    if (probe.opaqueInput) {
      ingress.boundaries.mark(
        declaration,
        "opaque-call-transport",
        receiver ?? callNode,
      );
    }
  }
}

export function interfaceValueOriginIsClosedForType(
  semantics: SourceFileSemantics,
  expression: Node,
  type: Type,
  ingress: InterfaceContractIngress,
): boolean {
  return ingress.relevance.valueContracts(semantics, type).every((contract) =>
    interfaceValueOriginIsClosed(
      expression,
      contract,
      ingress,
      { opaqueInput: false },
    )
  );
}

function interfaceValueOriginIsClosed(
  value: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  probe: InterfaceOriginProbe,
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
        probe,
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
      interfaceContainerOriginIsClosed(owner, contract, ingress, probe, seen);
  }
  const alternatives = compositeValueAlternatives(ingress.source, expression);
  if (alternatives !== undefined) {
    return alternatives !== null && alternatives.every((alternative) =>
      compositeOriginBranchIsClosed(
        alternative,
        "value",
        contract,
        ingress,
        probe,
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
      return transport.resultOriginExpressions !== undefined &&
        transport.resultOriginExpressions.length !== 0 &&
        transport.resultOriginExpressions.every((input) =>
          interfaceValueOriginIsClosed(
            input,
            contract,
            ingress,
            probe,
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
  if (refinement.kind !== "resolved") {
    return false;
  }
  if (ingress.opaqueInputs.has(refinement.reference.declaration)) {
    probe.opaqueInput = true;
    return false;
  }
  if (
    !originDeclarationIsClosed(
      ingress.source,
      refinement.reference.declaration,
    )
  ) {
    return false;
  }
  const semantics = ingress.source.semantics.forNode(expression);
  if (
    ingress.source.ast.is.IsClassDeclaration(
      refinement.reference.declaration,
    ) ||
    ingress.source.ast.is.IsClassExpression(refinement.reference.declaration)
  ) {
    return classValueOriginIsClosed(
      semantics,
      refinement.declaredType,
      contract,
      ingress,
    );
  }
  if (
    !typeProvidesContract(
      semantics,
      refinement.declaredType,
      contract,
      ingress,
    )
  ) {
    return false;
  }
  return declarationValueOriginIsClosed(
    refinement.reference.declaration,
    contract,
    ingress,
    probe,
    seen,
  );
}

function interfaceContainerOriginIsClosed(
  value: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  probe: InterfaceOriginProbe,
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
        probe,
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
        probe,
        seen,
      );
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
      ?.Expression;
    return owner !== undefined &&
      interfaceContainerOriginIsClosed(owner, contract, ingress, probe, seen);
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
      return transport.resultOriginExpressions !== undefined &&
        transport.resultOriginExpressions.length !== 0 &&
        transport.resultOriginExpressions.every((input) =>
          interfaceContainerOriginIsClosed(
            input,
            contract,
            ingress,
            probe,
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
  if (
    reference !== undefined &&
    ingress.opaqueInputs.has(reference.declaration)
  ) {
    probe.opaqueInput = true;
    return false;
  }
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
      probe,
      seen,
    )
    : declarationMayReceiveCheckedValues(ingress.source, reference.declaration);
}

function declarationValueOriginIsClosed(
  declaration: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  probe: InterfaceOriginProbe,
  seen: Set<Node>,
): boolean {
  if (ingress.opaqueInputs.has(declaration)) {
    probe.opaqueInput = true;
    return false;
  }
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
      probe,
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
          probe,
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

function valueOriginBranchIsClosed(
  value: Node,
  contract: Node,
  ingress: InterfaceContractIngress,
  probe: InterfaceOriginProbe,
  seen: Set<Node>,
): boolean {
  const semantics = ingress.source.semantics.forNode(value);
  const type = semantics.getTypeAtLocation(value);
  return type !== undefined &&
    (
      !ingress.relevance.valueContracts(semantics, type).includes(contract) ||
      interfaceValueOriginIsClosed(value, contract, ingress, probe, seen)
    );
}

function compositeOriginBranchIsClosed(
  alternative: CompositeValueAlternative,
  inheritedRole: "value" | "container",
  contract: Node,
  ingress: InterfaceContractIngress,
  probe: InterfaceOriginProbe,
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
      probe,
      seen,
    )
    : valueOriginBranchIsClosed(
      alternative.expression,
      contract,
      ingress,
      probe,
      seen,
    );
}
