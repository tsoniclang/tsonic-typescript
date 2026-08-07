import { pointerFactKey, pointerOperationFactKey } from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { TypedLocationLoweringError } from "./diagnostic.js";

export interface LocalLocationBinding {
  readonly declaration: Node;
  readonly symbol: Symbol;
  readonly addressOperands: ReadonlySet<Node>;
}

export interface TypedLocationPlan {
  readonly operations: ReadonlyMap<Node, PointerOperationFact>;
  readonly pointerTypes: ReadonlySet<Node>;
  readonly localBindings: ReadonlyMap<Node, LocalLocationBinding>;
  readonly promotedReferences: ReadonlySet<Node>;
  readonly removableImports: ReadonlySet<Node>;
  readonly runtimeAlias: string;
  readonly usesRuntimeValue: boolean;
}

interface MutableLocalLocationBinding {
  readonly declaration: Node;
  readonly symbol: Symbol;
  readonly addressOperands: Set<Node>;
}

export function createTypedLocationPlan(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): TypedLocationPlan {
  const nodes = collectNodes(source, sourceFile);
  const operations = new Map<Node, PointerOperationFact>();
  const pointerTypes = new Set<Node>();
  const selectedMarkerDeclarations = new Set<Node>();
  const selectedNamespaceBindings = new Set<Node>();
  const selectedNamespaceReceivers = new Set<Node>();
  const localBindingsBySymbol = new Map<Symbol, MutableLocalLocationBinding>();
  let usesRuntimeValue = false;

  for (const node of nodes) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation !== undefined) {
      if (operation.call !== node || operations.has(node)) {
        throw new TypedLocationLoweringError(
          "pointer operation fact is not uniquely attached to its exact call",
        );
      }
      operations.set(node, operation);
      usesRuntimeValue = true;
      recordMarkerSelection(
        source,
        requireCallTarget(source, node),
        selectedMarkerDeclarations,
        selectedNamespaceBindings,
        selectedNamespaceReceivers,
      );
      if (operation.operation === "address-of") {
        collectAddressBinding(source, operation, localBindingsBySymbol);
      }
    }
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      source.sourceFacts.getFact(node, pointerFactKey) !== undefined
    ) {
      pointerTypes.add(node);
      const typeReference = source.ast.as.AsTypeReferenceNode(node);
      if (typeReference?.TypeName === undefined) {
        throw new TypedLocationLoweringError(
          "pointer type fact has no exact type-name syntax",
        );
      }
      recordMarkerSelection(
        source,
        typeReference.TypeName,
        selectedMarkerDeclarations,
        selectedNamespaceBindings,
        selectedNamespaceReceivers,
      );
    }
  }

  const localBindings = new Map<Node, LocalLocationBinding>();
  const promotedReferences = new Set<Node>();
  for (const binding of localBindingsBySymbol.values()) {
    localBindings.set(binding.declaration, Object.freeze({
      declaration: binding.declaration,
      symbol: binding.symbol,
      addressOperands: binding.addressOperands,
    }));
    collectPromotedReferences(source, nodes, binding, promotedReferences);
  }
  const removableImports = collectRemovableImports(
    source,
    nodes,
    selectedMarkerDeclarations,
    selectedNamespaceBindings,
    selectedNamespaceReceivers,
  );
  return Object.freeze({
    operations,
    pointerTypes,
    localBindings,
    promotedReferences,
    removableImports,
    runtimeAlias: selectRuntimeAlias(source, nodes),
    usesRuntimeValue,
  });
}

function collectNodes(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly Node[] {
  const nodes: Node[] = [];
  const pending: Node[] = [sourceFile];
  const seen = new Set<Node>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    seen.add(node);
    nodes.push(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return Object.freeze(nodes);
}

function requireCallTarget(source: TargetSourceProgram, node: Node): Node {
  const call = source.ast.as.AsCallExpression(node);
  if (call === undefined || call.Expression === undefined) {
    throw new TypedLocationLoweringError(
      "pointer operation fact is not attached to a call expression",
    );
  }
  return call.Expression;
}

function collectAddressBinding(
  source: TargetSourceProgram,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  bindings: Map<Symbol, MutableLocalLocationBinding>,
): void {
  if (!source.ast.is.IsIdentifier(operation.storageExpression)) {
    return;
  }
  if (
    operation.storageSymbol === undefined ||
    operation.storageDeclaration === undefined ||
    !source.ast.is.IsVariableDeclaration(operation.storageDeclaration)
  ) {
    throw new TypedLocationLoweringError(
      "address-of identifier lacks an exact variable declaration and symbol",
    );
  }
  const declarationName = source.ast.name(operation.storageDeclaration);
  if (!source.ast.is.IsIdentifier(declarationName)) {
    throw new TypedLocationLoweringError(
      "address-of local currently requires one identifier declaration",
    );
  }
  const existing = bindings.get(operation.storageSymbol);
  if (
    existing !== undefined &&
    existing.declaration !== operation.storageDeclaration
  ) {
    throw new TypedLocationLoweringError(
      "one addressable symbol resolves to more than one declaration",
    );
  }
  if (existing === undefined) {
    bindings.set(operation.storageSymbol, {
      declaration: operation.storageDeclaration,
      symbol: operation.storageSymbol,
      addressOperands: new Set([operation.storageExpression]),
    });
  } else {
    existing.addressOperands.add(operation.storageExpression);
  }
}

function collectPromotedReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  binding: MutableLocalLocationBinding,
  promoted: Set<Node>,
): void {
  const declarationName = source.ast.name(binding.declaration);
  for (const node of nodes) {
    if (
      !source.ast.is.IsIdentifier(node) ||
      node === declarationName ||
      binding.addressOperands.has(node)
    ) {
      continue;
    }
    if (source.navigation.sourceReferenceFor(node)?.symbol === binding.symbol) {
      promoted.add(node);
    }
  }
}

function recordMarkerSelection(
  source: TargetSourceProgram,
  markerReference: Node,
  selectedDeclarations: Set<Node>,
  selectedNamespaceBindings: Set<Node>,
  namespaceReceivers: Set<Node>,
): void {
  const reference = source.navigation.sourceReferenceFor(markerReference);
  if (reference === undefined) {
    throw new TypedLocationLoweringError(
      "selected pointer marker has no exact declaration reference",
    );
  }
  selectedDeclarations.add(reference.declaration);
  for (const child of descendants(source, markerReference)) {
    const childReference = source.navigation.sourceReferenceFor(child);
    if (
      childReference !== undefined &&
      source.ast.is.IsNamespaceImport(childReference.declaration)
    ) {
      namespaceReceivers.add(child);
      selectedNamespaceBindings.add(childReference.declaration);
    }
  }
}

function descendants(
  source: TargetSourceProgram,
  root: Node,
): readonly Node[] {
  const result: Node[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    result.push(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return result;
}

function collectRemovableImports(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  selectedDeclarations: ReadonlySet<Node>,
  selectedNamespaceBindings: ReadonlySet<Node>,
  selectedNamespaceReceivers: ReadonlySet<Node>,
): ReadonlySet<Node> {
  const removable = new Set<Node>();
  for (const node of nodes) {
    if (source.ast.is.IsImportSpecifier(node)) {
      const name = source.ast.name(node);
      const declaration = source.navigation.sourceReferenceFor(name)?.declaration;
      if (declaration !== undefined && selectedDeclarations.has(declaration)) {
        removable.add(node);
      }
      continue;
    }
    if (!source.ast.is.IsNamespaceImport(node)) {
      continue;
    }
    if (!selectedNamespaceBindings.has(node)) {
      continue;
    }
    const declarationName = source.ast.name(node);
    const residual = nodes.some((candidate) => {
      if (
        candidate === declarationName ||
        selectedNamespaceReceivers.has(candidate) ||
        !source.ast.is.IsIdentifier(candidate)
      ) {
        return false;
      }
      const reference = source.navigation.sourceReferenceFor(candidate);
      return reference?.declaration === node;
    });
    if (!residual) {
      removable.add(node);
    }
  }
  return removable;
}

function selectRuntimeAlias(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): string {
  const identifiers = new Set(
    nodes
      .filter((node) => source.ast.is.IsIdentifier(node))
      .map((node) => source.ast.text(node)),
  );
  const base = "tsonicTypeScriptRuntime";
  if (!identifiers.has(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!identifiers.has(candidate)) {
      return candidate;
    }
  }
}
