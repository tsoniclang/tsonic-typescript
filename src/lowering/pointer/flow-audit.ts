import type { Node, PointerOperationFact } from "@tsonic/tsts";
import { KindIdentifier } from "@tsonic/tsts/target-ast";

import type { PointerCensus } from "./flow-census.js";
import { PointerLoweringError } from "./diagnostic.js";
import {
  addTransparentProducer,
  addTransparentReference,
  enclosingFunction,
  isModuleAliasReference,
  producesPointer,
  resolvePointerExpression,
  transparentExpressionRoot,
  transparentReference,
} from "./flow-syntax.js";

export function auditPointerCensus(census: PointerCensus): void {
  connectBindingReassignments(census);
  auditReferences(census);
  auditAddressedStorage(census);
  auditProducerUses(census);
}

function auditReferences(census: PointerCensus): void {
  const { source, graph, functionParameters, references } = census;
  const candidates = census.program.nodesOfKind(KindIdentifier);
  for (const node of census.ledger.candidates(
    "flow-census",
    "pointer-audit-reference",
    candidates,
  )) {
    const reference = references.referenceFor(node);
    const declaration = reference?.declaration;
    const vertex = graph.get(declaration);
    if (
      vertex !== undefined &&
      declaration !== undefined &&
      node !== source.ast.name(declaration)
    ) {
      if (
        !census.allowedPointerReferences.has(node) &&
        !isModuleAliasReference(source, node)
      ) {
        graph.block(vertex, "unsupported-flow", node);
      } else if (
        enclosingFunction(source, node) !==
          enclosingFunction(source, declaration)
      ) {
        graph.block(vertex, "captured-parameter", node);
      }
    }
    const parameters = declaration === undefined
      ? undefined
      : functionParameters.get(declaration);
    const result = declaration === undefined
      ? undefined
      : census.functionResults.get(declaration);
    if (
      (parameters === undefined && result === undefined) ||
      node === source.ast.name(declaration)
    ) {
      continue;
    }
    if (
      !census.allowedFunctionTargets.has(node) &&
      !isModuleAliasReference(source, node)
    ) {
      for (const parameter of parameters ?? []) {
        census.ledger.record("flow-census");
        graph.block(graph.get(parameter), "indirect-call", node);
      }
      graph.block(result?.vertex, "indirect-call", node);
    }
  }
  census.ledger.assertCandidateCount(
    "pointer-audit-reference",
    candidates.length,
  );
  for (const [owner, parameters] of functionParameters) {
    census.ledger.record("flow-census");
    if (census.optimizableFunctions.get(owner) !== true) {
      for (const parameter of parameters) {
        census.ledger.record("flow-census");
        graph.block(graph.get(parameter), "open-call", owner);
      }
    }
  }
}

function connectBindingReassignments(census: PointerCensus): void {
  const {
    source,
    graph,
    references,
    operations,
    allowedPointerReferences,
    allowedProducerUses,
    resultExpressions,
  } = census;
  for (const binding of census.pointerBindings) {
    census.ledger.record("flow-census");
    const name = source.ast.name(binding);
    const reference = references.referenceFor(name);
    if (reference === undefined) {
      graph.block(graph.get(binding), "unsupported-flow", binding);
      continue;
    }
    for (const write of references.writesFor(reference.declaration)) {
      census.ledger.record("flow-census");
      const assignment = source.ast.is.IsBinaryExpression(write)
        ? source.ast.as.AsBinaryExpression(write)
        : undefined;
      const left = transparentReference(source, assignment?.Left);
      const right = assignment?.Right;
      const leftReference = references.referenceFor(left);
      const plainAssignment = source.ast.operatorKindName(write) ===
        "KindEqualsToken";
      const rightVertex = plainAssignment
        ? resolvePointerExpression(
            source,
            references,
            graph,
            operations,
            right,
          )
        : undefined;
      if (
        !plainAssignment ||
        left === undefined ||
        leftReference?.declaration !== binding ||
        right === undefined ||
        !assignmentResultIsDiscarded(source, write) ||
        (rightVertex === undefined && !isExactNullishOrNeverValue(source, right))
      ) {
        graph.block(graph.get(binding), "pointer-rebinding", write);
        continue;
      }
      const bindingVertex = graph.get(binding);
      if (bindingVertex === undefined) {
        throw new PointerLoweringError(
          "tracked pointer binding lost its flow vertex",
        );
      }
      if (rightVertex !== undefined) {
        graph.union(bindingVertex, rightVertex);
        addTransparentReference(source, right, allowedPointerReferences);
        addTransparentProducer(
          source,
          right,
          operations,
          allowedProducerUses,
          resultExpressions,
        );
      } else if (isExactNullishOrNeverValue(source, right)) {
        const type = source.semantics.forNode(right).getTypeAtLocation(right);
        if (
          type !== undefined &&
          source.semantics.forNode(right).isNullish(type)
        ) {
          graph.block(bindingVertex, "nil-capable", right);
        }
      }
      allowedPointerReferences.add(left);
    }
  }
}

function assignmentResultIsDiscarded(
  source: PointerCensus["source"],
  assignment: Node,
): boolean {
  const root = transparentExpressionRoot(source, assignment);
  const parent = source.ast.parent(root);
  return parent !== undefined && source.ast.is.IsExpressionStatement(parent);
}

function isExactNullishOrNeverValue(
  source: PointerCensus["source"],
  expression: Node,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  return type !== undefined &&
    (semantics.isNullish(type) || semantics.isNever(type));
}

function auditAddressedStorage(census: PointerCensus): void {
  const { source, graph } = census;
  for (const operation of census.operations.values()) {
    census.ledger.record("flow-census");
    if (operation.operation !== "address-of") {
      continue;
    }
    const vertex = graph.get(operation.call);
    if (!addressedStorageIsStable(census, operation)) {
      graph.block(
        vertex,
        "addressed-storage-may-change",
        operation.storageExpression,
      );
    }
  }
}

function addressedStorageIsStable(
  census: PointerCensus,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
): boolean {
  const { source } = census;
  const storage = transparentReference(source, operation.storageExpression);
  const reference = census.references.referenceFor(storage);
  return storage !== undefined &&
    source.ast.is.IsIdentifier(storage) &&
    reference !== undefined &&
    operation.storageDeclaration === reference.declaration &&
    !census.references.hasWrite(reference.declaration);
}

function auditProducerUses(census: PointerCensus): void {
  const { source, graph } = census;
  for (const operation of census.operations.values()) {
    census.ledger.record("flow-census");
    if (!producesPointer(operation)) {
      continue;
    }
    const root = transparentExpressionRoot(source, operation.call);
    resolvePointerExpression(
      source,
      census.references,
      graph,
      census.operations,
      root,
    );
    const parent = source.ast.parent(root);
    const discarded = parent !== undefined && source.ast.is.IsExpressionStatement(parent);
    if (!discarded && !census.allowedProducerUses.has(operation.call)) {
      graph.block(graph.get(operation.call), "unsupported-flow", root);
    }
  }
  for (const expression of census.resultExpressions) {
    census.ledger.record("flow-census");
    const root = transparentExpressionRoot(source, expression);
    const parent = source.ast.parent(root);
    const discarded = parent !== undefined &&
      source.ast.is.IsExpressionStatement(parent);
    if (!discarded && !census.allowedProducerUses.has(expression)) {
      graph.block(graph.get(expression), "unsupported-flow", root);
    }
  }
}
