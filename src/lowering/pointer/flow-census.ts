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
} from "./flow-operation-census.js";
import {
  buildPointerTypedFactLedger,
  type PointerTypedFactLedger,
} from "./flow-fact-ledger.js";
import {
  assertPointerCensusTotality,
  collectPointerBindings,
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
  readonly program: TargetProgramIndex;
  readonly ledger: PointerPlanningLedger;
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
  readonly facts: PointerTypedFactLedger;
}

export function censusPointerFlows(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  ledger: PointerPlanningLedger,
): PointerFlowCensusResult {
  const graph = new PointerFlowGraph();
  const facts = buildPointerTypedFactLedger(source, program, ledger);
  const operations = collectPointerOperations(facts, graph, ledger);
  connectLocationIdentities(graph, operations, ledger);
  const classifiedPointerTypes = new Set<Node>();
  const pointerBindings = collectPointerBindings(
    source,
    program,
    facts,
    graph,
    classifiedPointerTypes,
    ledger,
  );
  const functionResults = collectPointerFunctionResults(
    source,
    program,
    facts,
    graph,
    classifiedPointerTypes,
    ledger,
  );
  retainUnownedPointerTypes(
    source,
    facts,
    graph,
    classifiedPointerTypes,
    ledger,
  );
  const resultExpressions = new Set<Node>();
  const allowedPointerReferences = new Set<Node>();
  const allowedProducerUses = new Set<Node>();
  const allowedFunctionTargets = new Set<Node>();
  const functionParameters = groupFunctionParameters(
    source,
    pointerBindings,
    ledger,
  );
  const optimizableFunctions = new Map<Node, boolean>();
  for (const owner of functionParameters.keys()) {
    ledger.record("flow-census");
    optimizableFunctions.set(
      owner,
      isOptimizableFunctionDeclaration(source, owner, ledger),
    );
  }
  const callableOwners = new Set<Node>();
  for (const owner of functionResults.keys()) {
    ledger.record("flow-census");
    callableOwners.add(owner);
  }
  for (const [owner, optimizable] of optimizableFunctions) {
    ledger.record("flow-census");
    if (optimizable) {
      callableOwners.add(owner);
    }
  }
  const callableAliases = analyzePointerCallableAliases(
    source,
    program,
    callableOwners,
    ledger,
  );
  for (const reference of callableAliases.allowedReferences) {
    ledger.record("flow-census");
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
    ledger,
  );
  connectVariableInitializers(
    source,
    program,
    graph,
    operations,
    pointerBindings,
    resultExpressions,
    allowedProducerUses,
    ledger,
  );
  const references = censusPointerReferences(
    source,
    program,
    trackedDeclarations(
      pointerBindings,
      operations,
      functionParameters,
      functionResults,
      ledger,
    ),
    ledger,
  );
  const census: PointerCensus = {
    source,
    program,
    ledger,
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
  ledger.record("flow-census", graph.operationCount);
  assertPointerCensusTotality(
    components,
    facts.operationEntries.map(({ node }) => node),
    facts.pointerTypeEntries.map(({ node }) => node),
    ledger,
  );
  return Object.freeze({
    components,
    facts,
  });
}

function applyCallableAliasBoundaries(census: PointerCensus): void {
  for (const boundary of census.callableAliases.boundaries) {
    census.ledger.record("flow-census");
    for (const occurrence of boundary.occurrences) {
      census.ledger.record("flow-census");
      for (const parameter of census.functionParameters.get(boundary.owner) ?? []) {
        census.ledger.record("flow-census");
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
  planning: PointerPlanningLedger,
): void {
  const dependents = new Map<Node, Node[]>();
  const candidates = program.nodesOfKind(KindVariableDeclaration);
  for (const node of planning.candidates(
    "flow-census",
    "variable-initializer",
    candidates,
  )) {
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
  planning.assertCandidateCount("variable-initializer", candidates.length);
  const pending = [
    ...pointerBindings,
    ...resultExpressions,
    ...[...operations.values()]
      .filter(producesPointer)
      .map((operation) => operation.call),
  ];
  const expanded = new Set<Node>();
  while (pending.length > 0) {
    planning.record("flow-census");
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
      planning.record("flow-census");
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
  ledger: PointerPlanningLedger,
): ReadonlySet<Node> {
  const candidates = new Set<Node>();
  for (const binding of pointerBindings) {
    ledger.record("flow-census");
    candidates.add(binding);
  }
  for (const owner of functionParameters.keys()) {
    ledger.record("flow-census");
    candidates.add(owner);
  }
  for (const owner of functionResults.keys()) {
    ledger.record("flow-census");
    candidates.add(owner);
  }
  for (const operation of operations.values()) {
    ledger.record("flow-census");
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
  ledger: PointerPlanningLedger,
): ReadonlyMap<Node, readonly Node[]> {
  const mutable = new Map<Node, Node[]>();
  for (const binding of pointerBindings) {
    ledger.record("flow-census");
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
  const grouped = new Map<Node, readonly Node[]>();
  for (const [owner, parameters] of mutable) {
    ledger.record("flow-census");
    grouped.set(owner, Object.freeze(parameters));
  }
  return grouped;
}
