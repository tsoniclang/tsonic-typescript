import {
  pointerFactKey,
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  PointerFlowGraph,
  type PointerFlowComponent,
  type PointerFlowVertex,
} from "./flow-graph.js";
import { connectPointerCalls } from "./flow-calls.js";
import {
  collectPointerFunctionResults,
  connectPointerResultCalls,
  connectPointerReturns,
  type PointerFunctionResult,
} from "./flow-results.js";
import { auditPointerCensus } from "./flow-audit.js";
import {
  censusPointerReferences,
  type PointerReferenceCensus,
} from "./flow-references.js";
import {
  addTransparentProducer,
  addTransparentReference,
  isOptimizableFunctionDeclaration,
  producesPointer,
  resolvePointerExpression,
  resolveRequiredPointerExpression,
  transparentExpression,
  transparentReference,
} from "./flow-syntax.js";

export interface PointerCensus {
  readonly source: TargetSourceProgram;
  readonly nodes: readonly Node[];
  readonly graph: PointerFlowGraph;
  readonly operations: ReadonlyMap<Node, PointerOperationFact>;
  readonly pointerBindings: ReadonlySet<Node>;
  readonly functionParameters: ReadonlyMap<Node, readonly Node[]>;
  readonly functionResults: ReadonlyMap<Node, PointerFunctionResult>;
  readonly resultExpressions: ReadonlySet<Node>;
  readonly optimizableFunctions: ReadonlyMap<Node, boolean>;
  readonly references: PointerReferenceCensus;
  readonly allowedPointerReferences: Set<Node>;
  readonly allowedProducerUses: Set<Node>;
  readonly allowedFunctionTargets: Set<Node>;
}

export function censusPointerFlows(
  source: TargetSourceProgram,
  nodes: readonly Node[] = collectPointerFlowNodes(source),
): readonly PointerFlowComponent[] {
  const graph = new PointerFlowGraph();
  const operations = collectPointerOperations(source, nodes, graph);
  connectLocationIdentities(graph, operations);
  const pointerBindings = collectPointerBindings(source, nodes, graph);
  const functionResults = collectPointerFunctionResults(source, nodes, graph);
  const resultExpressions = new Set<Node>();
  const allowedPointerReferences = new Set<Node>();
  const allowedProducerUses = new Set<Node>();
  const allowedFunctionTargets = new Set<Node>();
  connectPointerResultCalls(
    source,
    nodes,
    graph,
    operations,
    functionResults,
    resultExpressions,
    allowedFunctionTargets,
  );
  connectVariableInitializers(
    source,
    nodes,
    graph,
    operations,
    pointerBindings,
    resultExpressions,
    allowedProducerUses,
  );
  const functionParameters = groupFunctionParameters(source, pointerBindings);
  const references = censusPointerReferences(
    source,
    nodes,
    trackedDeclarations(
      pointerBindings,
      operations,
      functionParameters,
      functionResults,
    ),
  );
  const optimizableFunctions = new Map(
    [...functionParameters.keys()].map((owner) => [
      owner,
      isOptimizableFunctionDeclaration(source, owner),
    ]),
  );
  const census: PointerCensus = {
    source,
    nodes,
    graph,
    operations,
    pointerBindings,
    functionParameters,
    functionResults,
    resultExpressions,
    optimizableFunctions,
    references,
    allowedPointerReferences,
    allowedProducerUses,
    allowedFunctionTargets,
  };
  connectPointerCalls(census);
  attachPointerOperations(census);
  connectPointerReturns(census);
  auditPointerCensus(census);
  return graph.components();
}

function connectLocationIdentities(
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
): void {
  const identities = new Map<object, PointerFlowVertex>();
  for (const operation of operations.values()) {
    if (operation.operation !== "address-of") {
      continue;
    }
    const vertex = graph.get(operation.call);
    if (vertex === undefined) {
      continue;
    }
    const identity = operation.storageSymbol ??
      operation.storageDeclaration ??
      operation.locationIdentity;
    const existing = identities.get(identity);
    if (existing === undefined) {
      identities.set(identity, vertex);
    } else {
      graph.union(existing, vertex);
    }
  }
}

export function collectPointerFlowNodes(
  source: TargetSourceProgram,
): readonly Node[] {
  const result: Node[] = [];
  const seen = new Set<Node>();
  for (const sourceFile of source.navigation.sourceFiles) {
    const pending: Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined || seen.has(node)) {
        continue;
      }
      seen.add(node);
      result.push(node);
      const children = source.ast.children(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }
  return Object.freeze(result);
}

function collectPointerOperations(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  graph: PointerFlowGraph,
): ReadonlyMap<Node, PointerOperationFact> {
  const operations = new Map<Node, PointerOperationFact>();
  for (const node of nodes) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation === undefined) {
      continue;
    }
    operations.set(node, operation);
    if (!producesPointer(operation)) {
      continue;
    }
    const vertex = graph.add(node);
    vertex.operations.add(node);
    vertex.producers.add(operation);
    vertex.pointees.set(
      operation.pointeeType,
      operation.explicitPointeeTypeNode ?? operation.call,
    );
    if (
      operation.operation === "bind-pointer" ||
      operation.operation === "project-pointer"
    ) {
      vertex.blockers.add("unsupported-producer");
    }
  }
  return operations;
}

function collectPointerBindings(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  graph: PointerFlowGraph,
): Set<Node> {
  const bindings = new Set<Node>();
  for (const node of nodes) {
    if (!source.ast.is.IsTypeReferenceNode(node)) {
      continue;
    }
    const fact = source.sourceFacts.getFact(node, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    const owner = directPointerTypeOwner(source, node);
    if (owner === undefined) {
      continue;
    }
    const vertex = graph.add(owner);
    bindings.add(owner);
    vertex.pointerTypes.add(node);
    const pointeeType = source.semantics.forNode(node)
      .getTypeFromTypeNode(fact.pointee);
    if (pointeeType === undefined) {
      vertex.blockers.add("unsupported-pointee");
    } else {
      vertex.pointees.set(pointeeType, fact.pointee);
    }
  }
  return bindings;
}

function directPointerTypeOwner(
  source: TargetSourceProgram,
  typeReference: Node,
): Node | undefined {
  let current = source.ast.parent(typeReference);
  while (current !== undefined && !source.ast.is.IsSourceFile(current)) {
    if (
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsParameterDeclaration(current)
    ) {
      return pointerTypeOwnsDeclaration(source, current, typeReference)
        ? current
        : undefined;
    }
    if (source.ast.typeNode(current) !== undefined) {
      return undefined;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function pointerTypeOwnsDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
  pointerTypeNode: Node,
): boolean {
  const declaredTypeNode = source.ast.typeNode(declaration);
  if (declaredTypeNode === pointerTypeNode) {
    return true;
  }
  if (declaredTypeNode === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(declaredTypeNode);
  const declaredType = semantics.getTypeFromTypeNode(declaredTypeNode);
  const pointerType = semantics.getTypeFromTypeNode(pointerTypeNode);
  if (
    declaredType === undefined ||
    pointerType === undefined ||
    !semantics.isUnion(declaredType)
  ) {
    return false;
  }
  const nonNullish = semantics.getUnionOrIntersectionTypes(declaredType)
    .filter((candidate) => !semantics.isNullish(candidate));
  const nonNullishType = nonNullish[0];
  return nonNullish.length === 1 &&
    nonNullishType !== undefined &&
    semantics.getTypeRelationship(nonNullishType, pointerType) === "identical";
}

function connectVariableInitializers(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  pointerBindings: Set<Node>,
  resultExpressions: ReadonlySet<Node>,
  allowedProducerUses: Set<Node>,
): void {
  const dependents = new Map<Node, Node[]>();
  for (const node of nodes) {
    if (!source.ast.is.IsVariableDeclaration(node)) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(node)?.Initializer;
    const sourceNode = pointerInitializerSource(
      source,
      graph,
      initializer,
    );
    if (sourceNode === undefined) {
      if (pointerBindings.has(node)) {
        graph.block(
          graph.get(node),
          initializer === undefined ? "nil-capable" : "unsupported-flow",
        );
      }
      continue;
    }
    const existing = dependents.get(sourceNode);
    if (existing === undefined) {
      dependents.set(sourceNode, [node]);
    } else {
      existing.push(node);
    }
  }
  const pending = [
    ...pointerBindings,
    ...resultExpressions,
    ...[...operations.values()]
      .filter(producesPointer)
      .map((operation) => operation.call),
  ];
  const expanded = new Set<Node>();
  while (pending.length > 0) {
    const sourceNode = pending.pop();
    if (sourceNode === undefined || expanded.has(sourceNode)) {
      continue;
    }
    expanded.add(sourceNode);
    const sourceVertex = graph.get(sourceNode);
    if (sourceVertex === undefined) {
      continue;
    }
    for (const targetNode of dependents.get(sourceNode) ?? []) {
      const targetWasKnown = graph.get(targetNode) !== undefined;
      const target = graph.add(targetNode);
      graph.union(target, sourceVertex);
      if (operations.has(sourceNode) || resultExpressions.has(sourceNode)) {
        allowedProducerUses.add(sourceNode);
      }
      pointerBindings.add(targetNode);
      if (!targetWasKnown) {
        pending.push(targetNode);
      }
    }
  }
}

function pointerInitializerSource(
  source: TargetSourceProgram,
  graph: PointerFlowGraph,
  initializer: Node | undefined,
): Node | undefined {
  const reference = transparentReference(source, initializer);
  if (reference !== undefined) {
    return source.navigation.sourceReferenceFor(reference)?.declaration;
  }
  const expression = transparentExpression(source, initializer);
  return expression !== undefined && graph.get(expression) !== undefined
    ? expression
    : undefined;
}

function trackedDeclarations(
  pointerBindings: ReadonlySet<Node>,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  functionParameters: ReadonlyMap<Node, readonly Node[]>,
  functionResults: ReadonlyMap<Node, PointerFunctionResult>,
): ReadonlySet<Node> {
  const candidates = new Set(pointerBindings);
  for (const owner of functionParameters.keys()) {
    candidates.add(owner);
  }
  for (const owner of functionResults.keys()) {
    candidates.add(owner);
  }
  for (const operation of operations.values()) {
    if (
      operation.operation === "address-of" &&
      operation.storageDeclaration !== undefined
    ) {
      candidates.add(operation.storageDeclaration);
    }
  }
  return candidates;
}

function groupFunctionParameters(
  source: TargetSourceProgram,
  pointerBindings: ReadonlySet<Node>,
): ReadonlyMap<Node, readonly Node[]> {
  const mutable = new Map<Node, Node[]>();
  for (const binding of pointerBindings) {
    if (!source.ast.is.IsParameterDeclaration(binding)) {
      continue;
    }
    const owner = source.ast.parent(binding);
    if (owner === undefined) {
      continue;
    }
    const parameters = mutable.get(owner);
    if (parameters === undefined) {
      mutable.set(owner, [binding]);
    } else {
      parameters.push(binding);
    }
  }
  return new Map([...mutable].map(([owner, parameters]) => [
    owner,
    Object.freeze(parameters),
  ]));
}

function attachPointerOperations(census: PointerCensus): void {
  const { source, graph, operations } = census;
  for (const operation of operations.values()) {
    switch (operation.operation) {
      case "allocate":
      case "address-of":
      case "bind-pointer": {
        graph.get(operation.call)?.operations.add(operation.call);
        break;
      }
      case "load":
      case "store":
      case "hash-pointer": {
        const vertex = resolveRequiredPointerExpression(
          source,
          census.references,
          graph,
          operations,
          operation.pointerExpression,
        );
        vertex?.operations.add(operation.call);
        addTransparentReference(
          source,
          operation.pointerExpression,
          census.allowedPointerReferences,
        );
        addTransparentProducer(
          source,
          operation.pointerExpression,
          operations,
          census.allowedProducerUses,
          census.resultExpressions,
        );
        if (operation.operation === "hash-pointer") {
          graph.block(vertex, "identity-observed");
        }
        break;
      }
      case "equal-pointer": {
        const left = resolveRequiredPointerExpression(
          source,
          census.references,
          graph,
          operations,
          operation.leftExpression,
        );
        const right = resolveRequiredPointerExpression(
          source,
          census.references,
          graph,
          operations,
          operation.rightExpression,
        );
        if (left !== undefined && right !== undefined) {
          graph.union(left, right);
        }
        left?.operations.add(operation.call);
        right?.operations.add(operation.call);
        graph.block(left, "identity-observed");
        graph.block(right, "identity-observed");
        addTransparentReference(source, operation.leftExpression, census.allowedPointerReferences);
        addTransparentReference(source, operation.rightExpression, census.allowedPointerReferences);
        addTransparentProducer(
          source,
          operation.leftExpression,
          operations,
          census.allowedProducerUses,
          census.resultExpressions,
        );
        addTransparentProducer(
          source,
          operation.rightExpression,
          operations,
          census.allowedProducerUses,
          census.resultExpressions,
        );
        break;
      }
      case "project-pointer": {
        const result = graph.get(operation.call);
        const sourceVertex = resolveRequiredPointerExpression(
          source,
          census.references,
          graph,
          operations,
          operation.pointerExpression,
        );
        if (result !== undefined && sourceVertex !== undefined) {
          graph.union(result, sourceVertex);
        }
        graph.block(result, "unsupported-producer");
        graph.block(sourceVertex, "unsupported-producer");
        addTransparentReference(source, operation.pointerExpression, census.allowedPointerReferences);
        addTransparentProducer(
          source,
          operation.pointerExpression,
          operations,
          census.allowedProducerUses,
          census.resultExpressions,
        );
        break;
      }
    }
  }
  for (const binding of census.pointerBindings) {
    if (!source.ast.is.IsVariableDeclaration(binding)) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(binding)?.Initializer;
    const sourceVertex = resolvePointerExpression(
      source,
      census.references,
      graph,
      operations,
      initializer,
    );
    if (sourceVertex !== undefined) {
      addTransparentReference(source, initializer, census.allowedPointerReferences);
      addTransparentProducer(
        source,
        initializer,
        operations,
        census.allowedProducerUses,
        census.resultExpressions,
      );
    }
  }
}
