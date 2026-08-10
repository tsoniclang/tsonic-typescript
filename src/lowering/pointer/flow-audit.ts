import type { PointerOperationFact } from "@tsonic/tsts";

import type { PointerCensus } from "./flow-census.js";
import {
  enclosingFunction,
  isModuleAliasReference,
  producesPointer,
  resolvePointerExpression,
  transparentExpressionRoot,
  transparentReference,
} from "./flow-syntax.js";

export function auditPointerCensus(census: PointerCensus): void {
  auditReferences(census);
  auditBindingReassignments(census);
  auditAddressedStorage(census);
  auditProducerUses(census);
}

function auditReferences(census: PointerCensus): void {
  const { source, graph, functionParameters, references } = census;
  for (const node of census.nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
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
        graph.block(vertex, "unsupported-flow");
      } else if (
        enclosingFunction(source, node) !==
          enclosingFunction(source, declaration)
      ) {
        graph.block(vertex, "captured-parameter");
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
        graph.block(graph.get(parameter), "indirect-call");
      }
      graph.block(result?.vertex, "indirect-call");
    }
  }
  for (const [owner, parameters] of functionParameters) {
    if (census.optimizableFunctions.get(owner) !== true) {
      for (const parameter of parameters) {
        graph.block(graph.get(parameter), "open-call");
      }
    }
  }
}

function auditBindingReassignments(census: PointerCensus): void {
  const { source, graph, references } = census;
  for (const binding of census.pointerBindings) {
    const name = source.ast.name(binding);
    const reference = references.referenceFor(name);
    if (reference === undefined) {
      graph.block(graph.get(binding), "unsupported-flow");
      continue;
    }
    if (references.hasWrite(reference.declaration)) {
      graph.block(graph.get(binding), "pointer-rebinding");
    }
  }
}

function auditAddressedStorage(census: PointerCensus): void {
  const { source, graph } = census;
  for (const operation of census.operations.values()) {
    if (operation.operation !== "address-of") {
      continue;
    }
    const vertex = graph.get(operation.call);
    if (!addressedStorageIsStable(census, operation)) {
      graph.block(vertex, "addressed-storage-may-change");
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
      graph.block(graph.get(operation.call), "unsupported-flow");
    }
  }
  for (const expression of census.resultExpressions) {
    const root = transparentExpressionRoot(source, expression);
    const parent = source.ast.parent(root);
    const discarded = parent !== undefined &&
      source.ast.is.IsExpressionStatement(parent);
    if (!discarded && !census.allowedProducerUses.has(expression)) {
      graph.block(graph.get(expression), "unsupported-flow");
    }
  }
}
