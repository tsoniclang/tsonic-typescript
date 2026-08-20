import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceDeclarationReference,
  TargetSourceProgram,
} from "@tsonic/target-api";

const exactSemanticMembership = new WeakMap<
  TargetSourceProgram,
  WeakMap<Node, boolean>
>();

export interface ResolvedProjectInvocation {
  readonly call: ResolvedSourceCallInfo;
  readonly contract: Node;
  readonly implementation: Node;
}

export function referenceHasExactSemantics(
  source: TargetSourceProgram,
  reference: SourceDeclarationReference | undefined,
): reference is SourceDeclarationReference {
  return reference !== undefined && source.semantics.includes(reference.sourceFile);
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
  if (
    contract === undefined ||
    !hasExactSemanticMembership(source, contract)
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

function hasExactSemanticMembership(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let byNode = exactSemanticMembership.get(source);
  if (byNode === undefined) {
    byNode = new WeakMap<Node, boolean>();
    exactSemanticMembership.set(source, byNode);
  }
  const existing = byNode.get(node);
  if (existing !== undefined) {
    return existing;
  }
  const sourceFile = source.ast.getSourceFile(node);
  const included = sourceFile !== undefined && source.semantics.includes(sourceFile);
  byNode.set(node, included);
  return included;
}
