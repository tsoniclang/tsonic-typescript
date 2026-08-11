import {
  pointerFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  Type,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import type { PointerCensus } from "./flow-census.js";
import type { PointerCallableAliases } from "./flow-callable-aliases.js";
import type {
  PointerFlowGraph,
  PointerFlowVertex,
} from "./flow-graph.js";
import {
  addTransparentProducer,
  addTransparentReference,
  isOptimizableFunctionDeclaration,
  resolvePointerExpression,
  transparentExpression,
  transparentExpressionRoot,
} from "./flow-syntax.js";

export interface PointerFunctionResult {
  readonly owner: Node;
  readonly pointerType: Node;
  readonly vertex: PointerFlowVertex;
  readonly asynchronous: boolean;
}

export function collectPointerFunctionResults(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  graph: PointerFlowGraph,
): ReadonlyMap<Node, PointerFunctionResult> {
  const results = new Map<Node, PointerFunctionResult>();
  for (const owner of nodes) {
    if (!isOptimizableFunctionDeclaration(source, owner)) {
      continue;
    }
    const returnType = source.ast.typeNode(owner);
    const pointerType = returnType === undefined
      ? undefined
      : directPointerResultType(source, owner, returnType);
    if (pointerType === undefined) {
      continue;
    }
    const fact = source.sourceFacts.getFact(pointerType, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    const vertex = graph.add(pointerType);
    vertex.pointerTypes.add(pointerType);
    const pointeeType = source.semantics.forNode(pointerType)
      .getTypeFromTypeNode(fact.pointee);
    if (pointeeType === undefined) {
      graph.block(vertex, "unsupported-pointee", fact.pointee);
    } else {
      vertex.pointees.set(pointeeType, fact.pointee);
    }
    results.set(owner, Object.freeze({
      owner,
      pointerType,
      vertex,
      asynchronous: source.ast.hasModifierKind(owner, "async"),
    }));
  }
  return results;
}

export function connectPointerResultCalls(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  results: ReadonlyMap<Node, PointerFunctionResult>,
  resultExpressions: Set<Node>,
  allowedFunctionTargets: Set<Node>,
  callableAliases: PointerCallableAliases,
): void {
  for (const node of nodes) {
    if (!source.ast.is.IsCallExpression(node) || operations.has(node)) {
      continue;
    }
    const call = source.ast.as.AsCallExpression(node);
    const target = transparentExpression(source, call?.Expression);
    const directDeclaration = callableAliases.ownerForTarget(target);
    const directResult = directDeclaration === undefined
      ? undefined
      : results.get(directDeclaration);
    if (directResult === undefined) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const info = semantics.getResolvedCallInfo(node);
    const declaration = info === undefined
      ? undefined
      : semantics.getSignatureDeclaration(info.selectedSignature);
    const result = declaration === undefined ? undefined : results.get(declaration);
    if (result === undefined || result !== directResult) {
      continue;
    }
    if (
      info?.sourceSelectedSignatureKind !== "resolved" ||
      info.optionalChain ||
      call?.Expression === undefined
    ) {
      graph.block(result.vertex, "open-call", node);
      continue;
    }
    const valueExpression = result.asynchronous
      ? awaitedCallResult(source, node)
      : node;
    if (valueExpression === undefined) {
      graph.block(result.vertex, "unsupported-flow", node);
      continue;
    }
    const valueVertex = graph.add(valueExpression);
    graph.union(result.vertex, valueVertex);
    resultExpressions.add(valueExpression);
    allowedFunctionTargets.add(call.Expression);
    const targetName = source.ast.name(call.Expression);
    if (targetName !== undefined) {
      allowedFunctionTargets.add(targetName);
    }
  }
}

export function connectPointerReturns(census: PointerCensus): void {
  const {
    source,
    graph,
    operations,
    functionResults,
    resultExpressions,
  } = census;
  for (const node of census.nodes) {
    if (!source.ast.is.IsReturnStatement(node)) {
      continue;
    }
    const owner = enclosingFunction(source, node);
    const result = owner === undefined ? undefined : functionResults.get(owner);
    if (result === undefined) {
      continue;
    }
    const expression = source.ast.as.AsReturnStatement(node)?.Expression;
    if (expression === undefined) {
      graph.block(result.vertex, "unsupported-flow", node);
      continue;
    }
    const expressionType = source.semantics.forNode(expression)
      .getTypeAtLocation(expression);
    if (
      expressionType !== undefined &&
      source.semantics.forNode(expression).isNullish(expressionType)
    ) {
      continue;
    }
    const returned = resolvePointerExpression(
      source,
      census.references,
      graph,
      operations,
      expression,
    );
    if (returned === undefined) {
      graph.block(result.vertex, "unsupported-flow", expression);
      continue;
    }
    graph.union(result.vertex, returned);
    addTransparentReference(source, expression, census.allowedPointerReferences);
    addTransparentProducer(
      source,
      expression,
      operations,
      census.allowedProducerUses,
      resultExpressions,
    );
  }
}

function directPointerResultType(
  source: TargetSourceProgram,
  owner: Node,
  returnType: Node,
): Node | undefined {
  const pointerTypes: Node[] = [];
  const pending = [returnType];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      source.sourceFacts.getFact(node, pointerFactKey) !== undefined
    ) {
      pointerTypes.push(node);
      continue;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  const pointerType = pointerTypes[0];
  if (pointerTypes.length !== 1 || pointerType === undefined) {
    return undefined;
  }
  const semantics = source.semantics.forNode(returnType);
  const declaredType = semantics.getTypeFromTypeNode(returnType);
  const selectedPointerType = semantics.getTypeFromTypeNode(pointerType);
  if (declaredType === undefined || selectedPointerType === undefined) {
    return undefined;
  }
  const selectedResult = source.ast.hasModifierKind(owner, "async")
    ? soleTypeArgument(semantics, declaredType)
    : declaredType;
  return selectedResult !== undefined &&
      isPointerOrNullishUnion(semantics, selectedResult, selectedPointerType)
    ? pointerType
    : undefined;
}

function soleTypeArgument(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  if (!semantics.isTypeReference(type)) {
    return undefined;
  }
  const arguments_ = semantics.getTypeArguments(type);
  return arguments_.length === 1 ? arguments_[0] : undefined;
}

function isPointerOrNullishUnion(
  semantics: SourceFileSemantics,
  candidate: Type,
  pointer: Type,
): boolean {
  if (semantics.getTypeRelationship(candidate, pointer) === "identical") {
    return true;
  }
  if (!semantics.isUnion(candidate)) {
    return false;
  }
  const nonNullish = semantics.getUnionOrIntersectionTypes(candidate)
    .filter((member) => !semantics.isNullish(member));
  const selected = nonNullish[0];
  return nonNullish.length === 1 &&
    selected !== undefined &&
    semantics.getTypeRelationship(selected, pointer) === "identical";
}

function awaitedCallResult(
  source: TargetSourceProgram,
  call: Node,
): Node | undefined {
  const transparentRoot = transparentExpressionRoot(source, call);
  const parent = source.ast.parent(transparentRoot);
  if (!source.ast.is.IsAwaitExpression(parent)) {
    return undefined;
  }
  const awaited = source.ast.as.AsAwaitExpression(parent)?.Expression;
  return transparentExpression(source, awaited) === call ? parent : undefined;
}

function enclosingFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (
      source.ast.is.IsFunctionDeclaration(current) ||
      source.ast.is.IsFunctionExpression(current) ||
      source.ast.is.IsArrowFunction(current) ||
      source.ast.is.IsMethodDeclaration(current) ||
      source.ast.is.IsConstructorDeclaration(current) ||
      source.ast.is.IsGetAccessorDeclaration(current) ||
      source.ast.is.IsSetAccessorDeclaration(current)
    ) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
