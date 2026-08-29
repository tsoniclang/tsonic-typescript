import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerCensus } from "./flow-census.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";
import type { PointerProjectionCallablePlan } from "./projection-callable-plan.js";
import {
  PointerFlowGraph,
  type PointerFlowVertex,
} from "./flow-graph.js";
import {
  addTransparentProducer,
  addTransparentReference,
  producesPointer,
  resolvePointerExpression,
  resolveRequiredPointerExpression,
} from "./flow-syntax.js";

export function collectPointerOperations(
  facts: PointerTypedFactLedger,
  graph: PointerFlowGraph,
  planning: PointerPlanningLedger,
  projectionCallables: PointerProjectionCallablePlan,
): ReadonlyMap<Node, PointerOperationFact> {
  const operations = new Map<Node, PointerOperationFact>();
  for (const { node, fact: operation } of facts.operationEntries) {
    planning.record("flow-census");
    operations.set(node, operation);
    const vertex = graph.add(node);
    vertex.operations.add(node);
    vertex.pointees.set(
      operation.pointeeType,
      operation.explicitPointeeTypeNode ?? operation.call,
    );
    if (producesPointer(operation)) {
      vertex.producers.add(operation);
    }
    if (operation.operation === "bind-pointer") {
      graph.block(vertex, "provider-binding", operation.call);
    } else if (
      operation.operation === "project-pointer" &&
      projectionCallables.exactProjectionFor(operation.call) === undefined
    ) {
      graph.block(vertex, "projection-observed", operation.call);
    }
  }
  return operations;
}

export function connectLocationIdentities(
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  planning: PointerPlanningLedger,
): void {
  const identities = new Map<object, PointerFlowVertex>();
  for (const operation of operations.values()) {
    planning.record("flow-census");
    if (
      operation.operation !== "address-of" &&
      operation.operation !== "bind-pointer"
    ) {
      continue;
    }
    const vertex = graph.get(operation.call);
    if (vertex === undefined) {
      continue;
    }
    const identity = operation.operation === "bind-pointer"
      ? operation.locationIdentity
      : operation.storageSymbol ??
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

export function attachPointerOperations(census: PointerCensus): void {
  const { source, graph, operations } = census;
  for (const operation of operations.values()) {
    census.ledger.record("flow-census");
    const operationVertex = graph.get(operation.call);
    if (operationVertex === undefined) {
      throw new Error(`pointer ${operation.operation} lost its census vertex`);
    }
    switch (operation.operation) {
      case "allocate":
      case "address-of":
      case "bind-pointer": {
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
        if (vertex === undefined) {
          graph.block(operationVertex, "unsupported-flow", operation.call);
        } else {
          graph.union(operationVertex, vertex);
        }
        allowPointerOperand(census, operation.pointerExpression);
        if (operation.operation === "hash-pointer") {
          graph.block(operationVertex, "identity-observed", operation.call);
          if (isExactNullishValue(source, operation.pointerExpression)) {
            graph.block(operationVertex, "nil-capable", operation.pointerExpression);
          }
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
        if (left === undefined && right === undefined) {
          graph.block(operationVertex, "unsupported-flow", operation.call);
        } else {
          if (left !== undefined) {
            graph.union(operationVertex, left);
          }
          if (right !== undefined) {
            graph.union(operationVertex, right);
          }
        }
        graph.block(operationVertex, "identity-observed", operation.call);
        if (
          isExactNullishValue(source, operation.leftExpression) ||
          isExactNullishValue(source, operation.rightExpression)
        ) {
          graph.block(operationVertex, "nil-capable", operation.call);
        }
        allowPointerOperand(census, operation.leftExpression);
        allowPointerOperand(census, operation.rightExpression);
        break;
      }
      case "project-pointer": {
        const sourceVertex = resolveRequiredPointerExpression(
          source,
          census.references,
          graph,
          operations,
          operation.pointerExpression,
        );
        if (sourceVertex === undefined) {
          graph.block(operationVertex, "unsupported-flow", operation.call);
        } else if (
          census.projectionCallables.exactProjectionFor(operation.call) !== undefined
        ) {
          census.projectionDependencies.push(Object.freeze({
            operation,
            source: sourceVertex,
            target: operationVertex,
          }));
        } else {
          graph.union(operationVertex, sourceVertex);
        }
        allowPointerOperand(census, operation.pointerExpression);
        break;
      }
    }
  }
  connectBindingInitializers(census);
}

function allowPointerOperand(census: PointerCensus, expression: Node): void {
  addTransparentReference(
    census.source,
    expression,
    census.allowedPointerReferences,
  );
  addTransparentProducer(
    census.source,
    expression,
    census.operations,
    census.allowedProducerUses,
    census.resultExpressions,
  );
}

function connectBindingInitializers(census: PointerCensus): void {
  for (const binding of census.pointerBindings) {
    census.ledger.record("flow-census");
    if (!census.source.ast.is.IsVariableDeclaration(binding)) {
      continue;
    }
    const initializer = census.source.ast.as.AsVariableDeclaration(binding)?.Initializer;
    const sourceVertex = resolvePointerExpression(
      census.source,
      census.references,
      census.graph,
      census.operations,
      initializer,
    );
    if (sourceVertex !== undefined && initializer !== undefined) {
      allowPointerOperand(census, initializer);
    }
  }
}

function isExactNullishValue(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.types.expressionType(expression);
  return type !== undefined && semantics.types.isNullish(type);
}
