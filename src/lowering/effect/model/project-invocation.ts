import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  TargetSourceProgram,
} from "@tsonic/target-api";

export interface ResolvedProjectInvocation {
  readonly call: ResolvedSourceCallInfo;
  readonly contract: Node;
  readonly implementation: Node;
}

export function resolveProjectInvocation(
  source: TargetSourceProgram,
  node: Node,
): ResolvedProjectInvocation | undefined {
  if (
    !source.ast.is.IsCallExpression(node) &&
    !source.ast.is.IsNewExpression(node)
  ) {
    return undefined;
  }
  const semantics = source.semantics.forNode(node);
  const call = semantics.getResolvedCallInfo(node);
  const contract = call === undefined
    ? undefined
    : semantics.getSignatureDeclaration(call.selectedSignature);
  if (
    call === undefined ||
    call.outcome !== "applicable" ||
    call.sourceSelectedSignatureKind !== "resolved" ||
    contract === undefined
  ) {
    return undefined;
  }
  const implementation = projectCallableImplementation(source, contract);
  return implementation === undefined
    ? undefined
    : Object.freeze({ call, contract, implementation });
}

export function projectCallableImplementation(
  source: TargetSourceProgram,
  contract: Node | undefined,
): Node | undefined {
  if (contract === undefined) {
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
