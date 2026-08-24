import type { Node, Type } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import {
  interfaceContractTypeDeclaration,
  type InterfaceContractMembership,
} from "./declarations.js";
import type { InterfaceContractRelevance } from "./relevance.js";
import type { InterfaceContractBoundaryLedger } from "./boundary.js";
import type { InterfaceContractImplementationLedger } from "./implementations.js";
import type { OpaqueInterfaceInputLedger } from "./opaque-inputs.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { InterfaceOriginRequirements } from "./ingress/requirements.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import type { ExactValueSlotFlow } from "../value/slot/model.js";
import type {
  CheckedInterfaceParameterInputs,
} from "./ingress/checked-parameters.js";
import type {
  ExactCallableBodyInspection,
  ExactCallImplementations,
} from "../callable/result-inputs.js";

export interface InterfaceContractIngress {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly entries: InterfaceContractMembership;
  readonly boundaries: InterfaceContractBoundaryLedger;
  readonly implementations: InterfaceContractImplementationLedger;
  readonly relevance: InterfaceContractRelevance;
  readonly opaqueInputs: OpaqueInterfaceInputLedger;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly checkedParameterInputs: CheckedInterfaceParameterInputs;
  readonly aggregateProjections: ExactAggregateProjectionIndex;
  readonly slots?: ExactValueSlotFlow;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly closedStorageOwners: ReadonlySet<Node>;
  readonly originRequirements: InterfaceOriginRequirements;
  readonly transports?: InvocationTransportContract;
  readonly exactCallImplementations?: ExactCallImplementations;
  readonly bodyInspectionIsCertified?: ExactCallableBodyInspection;
}

export function retainUnprovenInterfaceIngress(
  semantics: SourceFileSemantics,
  expression: Node,
  sourceType: Type,
  targetType: Type,
  ingress: InterfaceContractIngress,
): void {
  const selectedSource = semantics.types.withoutMissingOrUndefined(sourceType);
  if (selectedSource === undefined || semantics.types.isNever(selectedSource)) {
    return;
  }
  const selectedTarget = semantics.types.withoutMissingOrUndefined(targetType);
  if (selectedTarget === undefined || semantics.types.isNever(selectedTarget)) {
    return;
  }
  const targetContracts = ingress.relevance.valueImplementationContracts(
    semantics,
    selectedTarget,
  );
  if (targetContracts.length === 0) {
    return;
  }
  const sourceContracts = ingress.relevance.valueImplementationContracts(
    semantics,
    selectedSource,
  );
  if (sourceContracts.length !== 0) {
    retainContracts(expression, sourceContracts, ingress);
    return;
  }
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
    certifiedSource ||
    (
      declaration !== undefined &&
      sourceFile !== undefined &&
      ingress.source.ast.is.IsInterfaceDeclaration(declaration) &&
      ingress.source.ast.isDeclarationFile(sourceFile)
    )
  ) {
    return;
  }
  retainContracts(expression, targetContracts, ingress);
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
  const declaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
  if (declaration === undefined || !ingress.entries.has(declaration)) {
    return;
  }
  const receiver = call.sourceReceiver?.expression ??
    call.sourceCalleeAccess?.receiver.expression;
  if (receiver !== undefined) {
    ingress.originRequirements.require(receiver, declaration, "receiver");
    return;
  }
  ingress.boundaries.mark(
    declaration,
    "open-interface-receiver",
    receiver ?? callNode,
  );
}

export function retainOpaqueInterfaceResultOrigin(
  semantics: SourceFileSemantics,
  expression: Node,
  type: Type,
  ingress: InterfaceContractIngress,
): void {
  for (const contract of ingress.relevance.valueContracts(semantics, type)) {
    ingress.originRequirements.require(
      expression,
      contract,
      "opaque-result",
    );
  }
}

function retainContracts(
  expression: Node,
  contracts: readonly Node[],
  ingress: InterfaceContractIngress,
): void {
  for (const contract of contracts) {
    ingress.originRequirements.require(expression, contract, "ingress");
  }
}
