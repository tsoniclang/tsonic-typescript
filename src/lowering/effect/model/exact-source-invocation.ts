import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceDeclarationReference,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import {
  type ExactSourceBodyInspection,
  nodeHasExactSourceSemantics,
  sourceBodyInspectionIsExact,
} from "./source-membership.js";

export interface ResolvedExactSourceInvocation {
  readonly call: ResolvedSourceCallInfo;
  readonly contract: Node;
  readonly implementation: Node;
}

export interface ResolvedExactSourceInvocationContract {
  readonly call: ResolvedSourceCallInfo;
  readonly contract: Node;
}

export function referenceHasExactSemantics(
  source: TargetSourceProgram,
  reference: SourceDeclarationReference | undefined,
): reference is SourceDeclarationReference {
  return reference !== undefined &&
    nodeHasExactSourceSemantics(source, reference.declaration);
}

export function sourceValueReference(
  source: TargetSourceProgram,
  expression: Node | undefined,
): SourceDeclarationReference | undefined {
  if (expression === undefined) {
    return undefined;
  }
  const referenceNode = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.ast.name(expression)
    : expression;
  return source.navigation.sourceReferenceFor(referenceNode);
}

export function resolveExactSourceInvocation(
  source: TargetSourceProgram,
  node: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): ResolvedExactSourceInvocation | undefined {
  const selected = resolveExactSourceInvocationContract(source, node);
  if (selected === undefined) {
    return undefined;
  }
  const implementation = exactSourceCallableImplementation(
    source,
    selected.contract,
    bodyInspectionIsCertified,
  );
  return implementation === undefined
    ? undefined
    : Object.freeze({ ...selected, implementation });
}

export function resolveExactSourceInvocationContract(
  source: TargetSourceProgram,
  node: Node,
): ResolvedExactSourceInvocationContract | undefined {
  if (
    !source.ast.is.IsCallExpression(node) &&
    !source.ast.is.IsNewExpression(node)
  ) {
    return undefined;
  }
  const semantics = source.semantics.forNode(node);
  const call = semantics.operations.call(node);
  const contract = call === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(call.selectedSignature);
  if (
    call === undefined ||
    call.outcome !== "applicable" ||
    call.sourceSelectedSignatureKind !== "resolved" ||
    contract === undefined ||
    !nodeHasExactSourceSemantics(source, contract)
  ) {
    return undefined;
  }
  return Object.freeze({ call, contract });
}

export function exactSourceCallableImplementation(
  source: TargetSourceProgram,
  contract: Node | undefined,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): Node | undefined {
  if (
    contract === undefined ||
    !nodeHasExactSourceSemantics(source, contract)
  ) {
    return undefined;
  }
  const selected = source.navigation.callableImplementation(contract);
  if (
    selected.kind === "resolved" &&
    sourceBodyInspectionIsExact(
      source,
      selected.implementation.declaration,
      bodyInspectionIsCertified,
    )
  ) {
    return selected.implementation.declaration;
  }
  return sourceBodyInspectionIsExact(
      source,
      contract,
      bodyInspectionIsCertified,
    ) &&
      source.ast.body(contract) !== undefined
    ? contract
    : undefined;
}
