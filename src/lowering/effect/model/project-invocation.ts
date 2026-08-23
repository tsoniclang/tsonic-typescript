import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceDeclarationReference,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import { nodeHasExactSourceSemantics } from "./source-membership.js";

export interface ResolvedProjectInvocation {
  readonly call: ResolvedSourceCallInfo;
  readonly contract: Node;
  readonly implementation: Node;
}

export interface ResolvedProjectInvocationContract {
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

export function resolveProjectInvocation(
  source: TargetSourceProgram,
  node: Node,
): ResolvedProjectInvocation | undefined {
  const selected = resolveProjectInvocationContract(source, node);
  if (selected === undefined) {
    return undefined;
  }
  const implementation = projectCallableImplementation(source, selected.contract);
  return implementation === undefined
    ? undefined
    : Object.freeze({ ...selected, implementation });
}

export function resolveProjectInvocationContract(
  source: TargetSourceProgram,
  node: Node,
): ResolvedProjectInvocationContract | undefined {
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

export function projectCallableImplementation(
  source: TargetSourceProgram,
  contract: Node | undefined,
): Node | undefined {
  if (
    contract === undefined ||
    !nodeHasExactSourceSemantics(source, contract)
  ) {
    return undefined;
  }
  const selected = source.navigation.callableImplementation(contract);
  if (selected.kind === "resolved") {
    return selected.implementation.declaration;
  }
  return source.navigation.isProjectDeclaration(contract) &&
      source.ast.body(contract) !== undefined
    ? contract
    : undefined;
}
