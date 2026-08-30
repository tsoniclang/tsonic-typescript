import type {
  Node,
  PointerOperationFact,
  Type,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import {
  KindArrowFunction,
  KindCallExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindMethodDeclaration,
  KindReturnStatement,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { PointerCensus } from "./flow-census.js";
import type { PointerCallableAliases } from "./flow-callable-aliases.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
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
import { recordPointerTypeFacts } from "./flow-type-census.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface PointerFunctionResult {
  readonly owner: Node;
  readonly pointerType: Node;
  readonly vertex: PointerFlowVertex;
  readonly asynchronous: boolean;
}

export function collectPointerFunctionResults(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  facts: PointerTypedFactLedger,
  graph: PointerFlowGraph,
  classifiedPointerTypes: Set<Node>,
  planning: PointerPlanningLedger,
): ReadonlyMap<Node, PointerFunctionResult> {
  const results = new Map<Node, PointerFunctionResult>();
  const candidates = program.nodesOfKinds([
    KindFunctionDeclaration,
    KindMethodDeclaration,
    KindFunctionExpression,
    KindArrowFunction,
  ]);
  for (const owner of planning.candidates(
    "flow-census",
    "function-result",
    candidates,
  )) {
    if (!isOptimizableFunctionDeclaration(source, owner, planning)) {
      continue;
    }
    const returnType = source.ast.typeNode(owner);
    const pointerType = returnType === undefined
      ? undefined
      : directPointerResultType(source, owner, returnType, facts, planning);
    if (pointerType === undefined) {
      continue;
    }
    const fact = facts.pointerFactFor(pointerType);
    if (fact === undefined) {
      continue;
    }
    const vertex = graph.add(pointerType);
    recordPointerTypeFacts(
      source,
      facts,
      pointerType,
      vertex,
      classifiedPointerTypes,
      planning,
    );
    const pointeeType = source.semantics.forNode(pointerType)
      .types.authoredType(fact.pointee);
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
  planning.assertCandidateCount("function-result", candidates.length);
  return results;
}

export function connectPointerResultCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  results: ReadonlyMap<Node, PointerFunctionResult>,
  resultExpressions: Set<Node>,
  allowedFunctionTargets: Set<Node>,
  callableAliases: PointerCallableAliases,
  planning: PointerPlanningLedger,
): void {
  const candidates = program.nodesOfKind(KindCallExpression);
  for (const node of planning.candidates(
    "flow-census",
    "result-call",
    candidates,
  )) {
    if (operations.has(node)) {
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
    const info = semantics.operations.call(node);
    const declaration = info === undefined
      ? undefined
      : semantics.declarations.signatureDeclaration(info.selectedSignature);
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
  planning.assertCandidateCount("result-call", candidates.length);
}

export function connectPointerReturns(census: PointerCensus): void {
  const {
    source,
    graph,
    operations,
    functionResults,
    resultExpressions,
  } = census;
  const candidates = census.program.nodesOfKind(KindReturnStatement);
  for (const node of census.ledger.candidates(
    "flow-census",
    "pointer-return",
    candidates,
  )) {
    const owner = enclosingFunction(source, node, census.ledger);
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
      .types.expressionType(expression);
    if (
      expressionType !== undefined &&
      source.semantics.forNode(expression).types.isNullish(expressionType)
    ) {
      graph.block(result.vertex, "nil-capable", expression);
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
  census.ledger.assertCandidateCount("pointer-return", candidates.length);
}

function directPointerResultType(
  source: TargetSourceProgram,
  owner: Node,
  returnType: Node,
  facts: PointerTypedFactLedger,
  planning: PointerPlanningLedger,
): Node | undefined {
  const pointerTypes: Node[] = [];
  const pending = [returnType];
  while (pending.length > 0) {
    planning.record("flow-census");
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      facts.pointerFactFor(node) !== undefined
    ) {
      pointerTypes.push(node);
      continue;
    }
    for (const child of source.ast.children(node)) {
      planning.record("flow-census");
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
  const declaredType = semantics.types.authoredType(returnType);
  const selectedPointerType = semantics.types.authoredType(pointerType);
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
  if (!semantics.types.isTypeReference(type)) {
    return undefined;
  }
  const arguments_ = semantics.types.typeArguments(type);
  return arguments_.length === 1 ? arguments_[0] : undefined;
}

function isPointerOrNullishUnion(
  semantics: SourceFileSemantics,
  candidate: Type,
  pointer: Type,
): boolean {
  if (semantics.types.relationship(candidate, pointer) === "identical") {
    return true;
  }
  if (!semantics.types.isUnion(candidate)) {
    return false;
  }
  const nonNullish = semantics.types.unionOrIntersectionTypes(candidate)
    .filter((member) => !semantics.types.isNullish(member));
  const selected = nonNullish[0];
  return nonNullish.length === 1 &&
    selected !== undefined &&
    semantics.types.relationship(selected, pointer) === "identical";
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
  planning: PointerPlanningLedger,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    planning.record("flow-census");
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
