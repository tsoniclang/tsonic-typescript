import type {
  Node,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindVariableDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

import {
  PointerFlowGraph,
  type PointerFlowComponent,
} from "./flow-graph.js";
import {
  analyzePointerCallableAliases,
  type PointerCallableAliases,
} from "./flow-callable-aliases.js";
import { connectPointerCalls } from "./flow-calls.js";
import {
  collectPointerFunctionResults,
  connectPointerResultCalls,
  connectPointerReturns,
  type PointerFunctionResult,
} from "./flow-results.js";
import { auditPointerCensus } from "./flow-audit.js";
import {
  attachPointerOperations,
  collectPointerOperations,
  connectLocationIdentities,
  derivePointerOperationFactDenominator,
} from "./flow-operation-census.js";
import {
  assertPointerCensusTotality,
  collectPointerBindings,
  derivePointerTypeFactDenominator,
  retainUnownedPointerTypes,
} from "./flow-type-census.js";
import {
  censusPointerReferences,
  type PointerReferenceCensus,
} from "./flow-references.js";
import {
  isOptimizableFunctionDeclaration,
  producesPointer,
  transparentExpression,
  transparentReference,
} from "./flow-syntax.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

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
  readonly callableAliases: PointerCallableAliases;
  readonly references: PointerReferenceCensus;
  readonly allowedPointerReferences: Set<Node>;
  readonly allowedProducerUses: Set<Node>;
  readonly allowedFunctionTargets: Set<Node>;
}

export interface PointerFlowCensusResult {
  readonly components: readonly PointerFlowComponent[];
}

export function censusPointerFlows(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  ledger: PointerPlanningLedger,
): PointerFlowCensusResult {
  const nodes = program.nodes;
  const graph = new PointerFlowGraph();
  const expectedOperations = derivePointerOperationFactDenominator(
    source,
    program,
  );
  const operations = collectPointerOperations(source, program, graph);
  connectLocationIdentities(graph, operations);
  const expectedPointerTypes = derivePointerTypeFactDenominator(source, program);
  const classifiedPointerTypes = new Set<Node>();
  const pointerBindings = collectPointerBindings(
    source,
    program,
    graph,
    classifiedPointerTypes,
  );
  const functionResults = collectPointerFunctionResults(
    source,
    program,
    graph,
    classifiedPointerTypes,
  );
  retainUnownedPointerTypes(
    source,
    program,
    graph,
    classifiedPointerTypes,
  );
  const resultExpressions = new Set<Node>();
  const allowedPointerReferences = new Set<Node>();
  const allowedProducerUses = new Set<Node>();
  const allowedFunctionTargets = new Set<Node>();
  const functionParameters = groupFunctionParameters(source, pointerBindings);
  const optimizableFunctions = new Map(
    [...functionParameters.keys()].map((owner) => [
      owner,
      isOptimizableFunctionDeclaration(source, owner),
    ]),
  );
  const callableOwners = new Set<Node>(functionResults.keys());
  for (const [owner, optimizable] of optimizableFunctions) {
    if (optimizable) {
      callableOwners.add(owner);
    }
  }
  const callableAliases = analyzePointerCallableAliases(
    source,
    program,
    callableOwners,
  );
  for (const reference of callableAliases.allowedReferences) {
    allowedFunctionTargets.add(reference);
  }
  connectPointerResultCalls(
    source,
    program,
    graph,
    operations,
    functionResults,
    resultExpressions,
    allowedFunctionTargets,
    callableAliases,
  );
  connectVariableInitializers(
    source,
    program,
    graph,
    operations,
    pointerBindings,
    resultExpressions,
    allowedProducerUses,
  );
  const references = censusPointerReferences(
    source,
    program,
    trackedDeclarations(
      pointerBindings,
      operations,
      functionParameters,
      functionResults,
    ),
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
    callableAliases,
    references,
    allowedPointerReferences,
    allowedProducerUses,
    allowedFunctionTargets,
  };
  connectPointerCalls(census);
  attachPointerOperations(census);
  connectPointerReturns(census);
  applyCallableAliasBoundaries(census);
  auditPointerCensus(census);
  const components = graph.components();
  ledger.record(
    "flow-census",
    program.nodes.length +
      graph.operationCount +
      callableAliases.traversalOperations,
  );
  assertPointerCensusTotality(
    components,
    expectedOperations,
    expectedPointerTypes,
  );
  return Object.freeze({
    components,
  });
}

function applyCallableAliasBoundaries(census: PointerCensus): void {
  for (const boundary of census.callableAliases.boundaries) {
    for (const occurrence of boundary.occurrences) {
      for (const parameter of census.functionParameters.get(boundary.owner) ?? []) {
        census.graph.block(
          census.graph.get(parameter),
          "indirect-call",
          occurrence,
        );
      }
      census.graph.block(
        census.functionResults.get(boundary.owner)?.vertex,
        "indirect-call",
        occurrence,
      );
    }
  }
}

function connectVariableInitializers(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  pointerBindings: Set<Node>,
  resultExpressions: ReadonlySet<Node>,
  allowedProducerUses: Set<Node>,
): void {
  const dependents = new Map<Node, Node[]>();
  for (const node of program.nodesOfKind(KindVariableDeclaration)) {
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
          initializer ?? node,
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
