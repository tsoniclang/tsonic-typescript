import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  collectCallableCollectionInputs,
  type CallableCollectionContract,
} from "./collection-inputs.js";
import { collectCallableStorageInputs } from "./storage-inputs.js";
import type { CallableStorageContract } from "./storage-contracts.js";
import {
  directContainingCall,
  isModuleForwardingReference,
} from "./syntax.js";

export interface CallableValueInputs {
  readonly values: ReadonlyMap<Node, readonly Node[]>;
  readonly closed: ReadonlySet<Node>;
  readonly contracts: readonly CallableCollectionContract[];
  readonly storageContracts: readonly CallableStorageContract[];
}

interface ReferenceCounts {
  total: number;
  admitted: number;
}

export function collectCallableValueInputs(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): CallableValueInputs {
  const collections = collectCallableCollectionInputs(source, nodes);
  const mutableValues = new Map<Node, Node[]>();
  const constructorParameters = new Set<Node>();
  const constructorClasses = new Map<Node, Node>();
  const invalidConstructors = new Set<Node>();
  for (const node of nodes) {
    if (source.ast.is.IsConstructorDeclaration(node)) {
      const classDeclaration = source.ast.parent(node);
      if (
        classDeclaration !== undefined &&
        source.ast.is.IsClassDeclaration(classDeclaration)
      ) {
        constructorClasses.set(node, classDeclaration);
      }
      continue;
    }
    if (!source.ast.is.IsNewExpression(node)) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const signature = semantics.getResolvedSignature(node);
    const declaration = semantics.getSignatureDeclaration(signature);
    if (
      declaration === undefined ||
      !source.ast.is.IsConstructorDeclaration(declaration)
    ) {
      continue;
    }
    const parameters = source.ast.parameters(declaration);
    const arguments_ = source.ast.arguments(node);
    if (
      arguments_.some((argument) => source.ast.is.IsSpreadElement(argument)) ||
      parameters.some((parameter) =>
        source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
      )
    ) {
      invalidConstructors.add(declaration);
      continue;
    }
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const argument = arguments_[index];
      if (
        parameter !== undefined &&
        argument !== undefined &&
        isReadonlyParameterProperty(source, parameter)
      ) {
        append(mutableValues, parameter, argument);
        constructorParameters.add(parameter);
      }
    }
  }

  const classReferences = new Map<Node, ReferenceCounts>();
  for (const classDeclaration of constructorClasses.values()) {
    classReferences.set(classDeclaration, { total: 0, admitted: 0 });
  }
  const classSymbols = indexDeclarationSymbols(
    source,
    classReferences.keys(),
  );
  for (const node of nodes) {
    auditClassReference(source, node, classReferences, classSymbols);
  }
  const storage = collectCallableStorageInputs(
    source,
    nodes,
    collections.closed,
  );
  const propertyReferences = new Map<Node, ReferenceCounts>();
  for (const parameter of constructorParameters) {
    propertyReferences.set(parameter, { total: 0, admitted: 0 });
  }
  const propertySymbols = indexDeclarationSymbols(
    source,
    propertyReferences.keys(),
  );
  for (const node of nodes) {
    auditPropertyReference(
      source,
      node,
      propertyReferences,
      propertySymbols,
      storage.closed,
    );
  }

  const closed = new Set<Node>([
    ...collections.closed,
    ...storage.closed,
  ]);
  for (const [constructor, classDeclaration] of constructorClasses) {
    const classCounts = classReferences.get(classDeclaration);
    if (
      invalidConstructors.has(constructor) ||
      classCounts === undefined ||
      classCounts.total !== classCounts.admitted ||
      classCounts.admitted === 0
    ) {
      continue;
    }
    for (const parameter of source.ast.parameters(constructor)) {
      const propertyCounts = parameter === undefined
        ? undefined
        : propertyReferences.get(parameter);
      if (
        parameter !== undefined &&
        isReadonlyParameterProperty(source, parameter) &&
        mutableValues.has(parameter) &&
        propertyCounts !== undefined &&
        propertyCounts.total === propertyCounts.admitted &&
        propertyCounts.admitted !== 0
      ) {
        closed.add(parameter);
      }
    }
  }
  for (const [declaration, values] of collections.values) {
    mutableValues.set(declaration, [...values]);
  }
  for (const [declaration, values] of storage.values) {
    mutableValues.set(declaration, [...values]);
  }
  return Object.freeze({
    values: new Map([...mutableValues].map(([key, values]) => [
      key,
      Object.freeze(values),
    ])),
    closed,
    contracts: collections.contracts,
    storageContracts: storage.contracts,
  });
}

function auditClassReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
): void {
  if (tracked.size === 0 || !source.ast.is.IsIdentifier(node)) {
    return;
  }
  const declaration = declarationForSymbols(source, trackedSymbols, node);
  const counts = declaration === undefined ? undefined : tracked.get(declaration);
  if (
    counts === undefined ||
    node === source.ast.name(declaration) ||
    isTypeOnlyReference(source, node) ||
    isModuleForwardingReference(source, node)
  ) {
    return;
  }
  counts.total += 1;
  if (directContainingNew(source, node) !== undefined) {
    counts.admitted += 1;
  }
}

function auditPropertyReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
  closedStorage: ReadonlySet<Node>,
): void {
  if (tracked.size === 0) {
    return;
  }
  if (source.ast.is.IsPropertyAccessExpression(node)) {
    const selected = source.semantics.forNode(node)
      .getResolvedPropertyAccessInfo(node);
    countPropertyUse(
      selected?.selectedDeclaration === undefined
        ? undefined
        : tracked.get(selected.selectedDeclaration),
      selected !== undefined &&
        propertyUseIsAdmitted(source, node, closedStorage) &&
        selected.accessMode === "read" &&
        !selected.optionalChain,
    );
    return;
  }
  if (source.ast.is.IsElementAccessExpression(node)) {
    const selected = source.semantics.forNode(node)
      .getResolvedElementAccessInfo(node);
    countPropertyUse(
      selected?.selectedDeclaration === undefined
        ? undefined
        : tracked.get(selected.selectedDeclaration),
      selected !== undefined &&
        propertyUseIsAdmitted(source, node, closedStorage) &&
        selected.accessMode === "read" &&
        !selected.optionalChain,
    );
    return;
  }
  if (
    !source.ast.is.IsIdentifier(node) ||
    isPropertyAccessName(source, node)
  ) {
    return;
  }
  const declaration = declarationForSymbols(
    source,
    trackedSymbols,
    node,
  );
  const counts = declaration === undefined ? undefined : tracked.get(declaration);
  if (
    counts !== undefined &&
    node !== source.ast.name(declaration) &&
    !isTypeOnlyReference(source, node) &&
    !isModuleForwardingReference(source, node)
  ) {
    counts.total += 1;
  }
}

function propertyUseIsAdmitted(
  source: TargetSourceProgram,
  node: Node,
  closedStorage: ReadonlySet<Node>,
): boolean {
  return directContainingCall(source, node) !== undefined ||
    isCallablePresenceObservation(source, node) ||
    isInitializerOfClosedStorage(source, node, closedStorage);
}

function isCallablePresenceObservation(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (
      !source.ast.is.IsBinaryExpression(parent) ||
      !new Set([
        "KindEqualsEqualsToken",
        "KindExclamationEqualsToken",
        "KindEqualsEqualsEqualsToken",
        "KindExclamationEqualsEqualsToken",
      ]).has(source.ast.operatorKindName(parent) ?? "")
    ) {
      return false;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    const other = binary?.Left === current
      ? binary.Right
      : binary?.Right === current
      ? binary.Left
      : undefined;
    const otherType = other === undefined
      ? undefined
      : source.semantics.forNode(other).getTypeAtLocation(other);
    return other !== undefined &&
      otherType !== undefined &&
      source.semantics.forNode(other).isNullish(otherType);
  }
}

function isInitializerOfClosedStorage(
  source: TargetSourceProgram,
  expression: Node,
  closedStorage: ReadonlySet<Node>,
): boolean {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    return source.ast.is.IsVariableDeclaration(parent) &&
      source.ast.as.AsVariableDeclaration(parent)?.Initializer === current &&
      closedStorage.has(parent);
  }
}

function indexDeclarationSymbols(
  source: TargetSourceProgram,
  declarations: Iterable<Node>,
): ReadonlyMap<Symbol, Node> {
  const result = new Map<Symbol, Node>();
  for (const declaration of declarations) {
    for (const symbol of exactSymbolsAt(source, source.ast.name(declaration))) {
      result.set(symbol, declaration);
    }
  }
  return result;
}

function declarationForSymbols(
  source: TargetSourceProgram,
  declarations: ReadonlyMap<Symbol, Node>,
  node: Node,
): Node | undefined {
  for (const symbol of exactSymbolsAt(source, node)) {
    const declaration = declarations.get(symbol);
    if (declaration !== undefined) {
      return declaration;
    }
  }
  return undefined;
}

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node | undefined,
): readonly Symbol[] {
  if (node === undefined) {
    return [];
  }
  const semantics = source.semantics.forNode(node);
  const result = new Set<Symbol>();
  for (const symbol of [
    semantics.getSymbolAtLocation(node),
    semantics.getResolvedSymbol(node),
  ]) {
    if (symbol !== undefined) {
      result.add(symbol);
    }
  }
  return [...result];
}

function countPropertyUse(
  counts: ReferenceCounts | undefined,
  admitted: boolean,
): void {
  if (counts === undefined) {
    return;
  }
  counts.total += 1;
  if (admitted) {
    counts.admitted += 1;
  }
}

function isReadonlyParameterProperty(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsParameterDeclaration(node) &&
    source.ast.hasModifierKind(node, "readonly") &&
    source.ast.parent(node) !== undefined &&
    source.ast.is.IsConstructorDeclaration(source.ast.parent(node));
}

function directContainingNew(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsNewExpression(parent)) {
      return source.ast.as.AsNewExpression(parent)?.Expression === current
        ? parent
        : undefined;
    }
    if (
      source.ast.is.IsPropertyAccessExpression(parent) ||
      source.ast.is.IsParenthesizedExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return undefined;
  }
}

function isTypeOnlyReference(source: TargetSourceProgram, node: Node): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    if (
      source.ast.is.IsExpressionStatement(current) ||
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsCallExpression(current) ||
      source.ast.is.IsNewExpression(current) ||
      source.ast.is.IsClassDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isPropertyAccessName(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsPropertyAccessExpression(parent) &&
    source.ast.as.AsPropertyAccessExpression(parent)?.name === node;
}

function isTransparentParent(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  if (source.ast.is.IsParenthesizedExpression(parent)) {
    return source.ast.as.AsParenthesizedExpression(parent)?.Expression === child;
  }
  if (source.ast.is.IsAsExpression(parent)) {
    return source.ast.as.AsAsExpression(parent)?.Expression === child;
  }
  if (source.ast.is.IsTypeAssertion(parent)) {
    return source.ast.as.AsTypeAssertion(parent)?.Expression === child;
  }
  if (source.ast.is.IsSatisfiesExpression(parent)) {
    return source.ast.as.AsSatisfiesExpression(parent)?.Expression === child;
  }
  return source.ast.is.IsNonNullExpression(parent) &&
    source.ast.as.AsNonNullExpression(parent)?.Expression === child;
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}
