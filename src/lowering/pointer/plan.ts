import {
  pointerFactKey,
  pointerOperationFactKey,
  rawPointerFactKey,
  rawPointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  RawPointerOperationFact,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { PointerLoweringError } from "./diagnostic.js";

export interface LocalLocationBinding {
  readonly kind: "variable";
  readonly declaration: Node;
  readonly symbol: Symbol;
  readonly addressOperands: ReadonlySet<Node>;
  readonly sourceName: string;
}

export interface ParameterLocationBinding {
  readonly kind: "parameter";
  readonly declaration: Node;
  readonly symbol: Symbol;
  readonly addressOperands: ReadonlySet<Node>;
  readonly body: Node;
  readonly sourceName: string;
  readonly locationName: string;
}

export type LocationBinding = LocalLocationBinding | ParameterLocationBinding;

export interface PointerLoweringPlan {
  readonly operations: ReadonlyMap<Node, PointerOperationFact>;
  readonly pointerTypes: ReadonlySet<Node>;
  readonly rawPointerOperations: ReadonlyMap<Node, RawPointerOperationFact>;
  readonly rawPointerTypes: ReadonlySet<Node>;
  readonly localBindings: ReadonlyMap<Node, LocalLocationBinding>;
  readonly parameterBindingsByBody: ReadonlyMap<
    Node,
    readonly ParameterLocationBinding[]
  >;
  readonly promotedReferences: ReadonlyMap<Node, LocationBinding>;
  readonly addressBindings: ReadonlyMap<Node, LocationBinding>;
  readonly removableImports: ReadonlySet<Node>;
  readonly runtimeAlias: string;
  readonly usesRuntimeValue: boolean;
}

interface MutableLocationBinding {
  readonly kind: "variable" | "parameter";
  readonly declaration: Node;
  readonly symbol: Symbol;
  readonly addressOperands: Set<Node>;
  readonly body?: Node;
  readonly sourceName?: string;
}

export function createPointerLoweringPlan(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): PointerLoweringPlan {
  const nodes = collectNodes(source, sourceFile);
  const operations = new Map<Node, PointerOperationFact>();
  const pointerTypes = new Set<Node>();
  const rawPointerOperations = new Map<Node, RawPointerOperationFact>();
  const rawPointerTypes = new Set<Node>();
  const selectedMarkerDeclarations = new Set<Node>();
  const selectedNamespaceBindings = new Set<Node>();
  const selectedNamespaceReceivers = new Set<Node>();
  const bindingsBySymbol = new Map<Symbol, MutableLocationBinding>();
  let usesRuntimeValue = false;

  for (const node of nodes) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation !== undefined) {
      if (operation.call !== node || operations.has(node)) {
        throw new PointerLoweringError(
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
    }
    const rawPointerOperation = source.sourceFacts.getFact(
      node,
      rawPointerOperationFactKey,
    );
    if (rawPointerOperation !== undefined) {
      if (
        rawPointerOperation.call !== node ||
        rawPointerOperations.has(node) ||
        operation !== undefined
      ) {
        throw new PointerLoweringError(
          "raw-pointer operation fact is not uniquely attached to its exact call",
        );
      }
      rawPointerOperations.set(node, rawPointerOperation);
      usesRuntimeValue = true;
      recordMarkerSelection(
        source,
        requireCallTarget(source, node),
        selectedMarkerDeclarations,
        selectedNamespaceBindings,
        selectedNamespaceReceivers,
      );
    }
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      source.sourceFacts.getFact(node, pointerFactKey) !== undefined
    ) {
      pointerTypes.add(node);
      const typeReference = source.ast.as.AsTypeReferenceNode(node);
      if (typeReference?.TypeName === undefined) {
        throw new PointerLoweringError(
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
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      source.sourceFacts.getFact(node, rawPointerFactKey) !== undefined
    ) {
      if (pointerTypes.has(node)) {
        throw new PointerLoweringError(
          "one type reference cannot be both a typed and raw pointer",
        );
      }
      rawPointerTypes.add(node);
      const typeReference = source.ast.as.AsTypeReferenceNode(node);
      if (typeReference?.TypeName === undefined) {
        throw new PointerLoweringError(
          "raw-pointer type fact has no exact type-name syntax",
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
  for (const operation of operations.values()) {
    if (operation.operation === "address-of") {
      collectAddressBinding(source, sourceFile, operation, bindingsBySymbol);
    }
  }

  const localBindings = new Map<Node, LocalLocationBinding>();
  const parameterBindingsByBody = new Map<Node, ParameterLocationBinding[]>();
  const promotedReferences = new Map<Node, LocationBinding>();
  const addressBindings = new Map<Node, LocationBinding>();
  const sealedBindingsBySymbol = new Map<Symbol, LocationBinding>();
  const usedNames = collectIdentifierNames(source, nodes);
  const mutableBindings = [...bindingsBySymbol.values()].sort(
    (left, right) => source.ast.pos(left.declaration) - source.ast.pos(right.declaration),
  );
  for (const binding of mutableBindings) {
    const sealed = sealLocationBinding(source, binding, usedNames);
    sealedBindingsBySymbol.set(sealed.symbol, sealed);
    if (sealed.kind === "variable") {
      localBindings.set(sealed.declaration, sealed);
    } else {
      const bodyBindings = parameterBindingsByBody.get(sealed.body) ?? [];
      bodyBindings.push(sealed);
      parameterBindingsByBody.set(sealed.body, bodyBindings);
    }
    for (const operand of sealed.addressOperands) {
      addressBindings.set(operand, sealed);
    }
  }
  collectPromotedReferences(
    source,
    nodes,
    sealedBindingsBySymbol,
    promotedReferences,
  );
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
    rawPointerOperations,
    rawPointerTypes,
    localBindings,
    parameterBindingsByBody,
    promotedReferences,
    addressBindings,
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
    throw new PointerLoweringError(
      "pointer operation fact is not attached to a call expression",
    );
  }
  return call.Expression;
}

function collectAddressBinding(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  bindings: Map<Symbol, MutableLocationBinding>,
): void {
  const root = valueStorageRoot(source, operation.storageExpression);
  if (root === undefined) {
    return;
  }
  const reference = source.navigation.sourceReferenceFor(root);
  if (
    reference !== undefined &&
    source.ast.getSourceFile(reference.declaration) !== sourceFile
  ) {
    return;
  }
  if (
    reference === undefined ||
    !source.ast.is.IsVariableDeclaration(reference.declaration) &&
    !source.ast.is.IsParameterDeclaration(reference.declaration)
  ) {
    throw new PointerLoweringError(
      "address-of value-field root lacks an exact variable or parameter declaration",
    );
  }
  if (
    root === operation.storageExpression &&
    (operation.storageSymbol !== reference.symbol ||
      operation.storageDeclaration !== reference.declaration)
  ) {
    throw new PointerLoweringError(
      "address-of identifier fact disagrees with its exact source reference",
    );
  }
  const declarationName = source.ast.name(reference.declaration);
  if (!source.ast.is.IsIdentifier(declarationName)) {
    throw new PointerLoweringError(
      "address-of local currently requires one identifier declaration",
    );
  }
  const isParameter = source.ast.is.IsParameterDeclaration(
    reference.declaration,
  );
  const body = isParameter
    ? source.ast.body(source.ast.parent(reference.declaration))
    : undefined;
  if (isParameter && body === undefined) {
    throw new PointerLoweringError(
      "addressed parameter requires an exact function body",
    );
  }
  const existing = bindings.get(reference.symbol);
  if (
    existing !== undefined &&
    existing.declaration !== reference.declaration
  ) {
    throw new PointerLoweringError(
      "one addressable symbol resolves to more than one declaration",
    );
  }
  if (existing === undefined) {
    bindings.set(reference.symbol, {
      kind: isParameter ? "parameter" : "variable",
      declaration: reference.declaration,
      symbol: reference.symbol,
      addressOperands: new Set([root]),
      ...(body === undefined ? {} : { body }),
      sourceName: source.ast.text(declarationName),
    });
  } else {
    existing.addressOperands.add(root);
  }
}

function valueStorageRoot(
  source: TargetSourceProgram,
  storage: Node,
): Node | undefined {
  if (source.ast.is.IsIdentifier(storage)) {
    return storage;
  }
  if (source.ast.is.IsPropertyAccessExpression(storage)) {
    const property = source.ast.as.AsPropertyAccessExpression(storage);
    return property?.Expression === undefined
      ? undefined
      : valueStorageRoot(source, property.Expression);
  }
  if (!source.ast.is.IsElementAccessExpression(storage)) {
    return undefined;
  }
  const element = source.ast.as.AsElementAccessExpression(storage);
  return element?.Expression === undefined
    ? undefined
    : valueStorageRoot(source, element.Expression);
}

function sealLocationBinding(
  source: TargetSourceProgram,
  binding: MutableLocationBinding,
  usedNames: Set<string>,
): LocationBinding {
  if (binding.kind === "variable") {
    if (binding.sourceName === undefined) {
      throw new PointerLoweringError(
        "addressed local binding has no exact source name",
      );
    }
    return Object.freeze({
      kind: "variable",
      declaration: binding.declaration,
      symbol: binding.symbol,
      addressOperands: binding.addressOperands,
      sourceName: binding.sourceName,
    });
  }
  if (binding.body === undefined || binding.sourceName === undefined) {
    throw new PointerLoweringError(
      "addressed parameter binding is incomplete",
    );
  }
  for (const operand of binding.addressOperands) {
    if (!isNodeWithin(source, operand, binding.body)) {
      throw new PointerLoweringError(
        "address-of parameter outside its function body is unsupported",
      );
    }
  }
  return Object.freeze({
    kind: "parameter",
    declaration: binding.declaration,
    symbol: binding.symbol,
    addressOperands: binding.addressOperands,
    body: binding.body,
    sourceName: binding.sourceName,
    locationName: selectLocationName(binding.sourceName, usedNames),
  });
}

function collectIdentifierNames(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): Set<string> {
  return new Set(nodes
    .filter((node) => source.ast.is.IsIdentifier(node))
    .map((node) => source.ast.text(node)));
}

function selectLocationName(sourceName: string, usedNames: Set<string>): string {
  const base = `${sourceName}$location`;
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
}

function collectPromotedReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  bindingsBySymbol: ReadonlyMap<Symbol, LocationBinding>,
  promoted: Map<Node, LocationBinding>,
): void {
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const symbol = source.navigation.sourceReferenceFor(node)?.symbol;
    const binding = symbol === undefined ? undefined : bindingsBySymbol.get(symbol);
    if (
      binding === undefined ||
      node === source.ast.name(binding.declaration) ||
      binding.addressOperands.has(node) ||
      binding.kind === "parameter" && !isNodeWithin(source, node, binding.body)
    ) {
      continue;
    }
    promoted.set(node, binding);
  }
}

function isNodeWithin(
  source: TargetSourceProgram,
  node: Node,
  ancestor: Node,
): boolean {
  for (let current: Node | undefined = node; current !== undefined;) {
    if (current === ancestor) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
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
    throw new PointerLoweringError(
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
