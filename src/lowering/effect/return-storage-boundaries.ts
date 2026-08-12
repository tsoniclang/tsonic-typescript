import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { isTransparentParent } from "./callable-input-reference.js";

export interface ReturnStorageOwnerBinding {
  readonly declaration: Node;
  readonly owner: Node;
  readonly inputs: readonly Node[];
  valid: boolean;
}

type StorageDestination =
  | { readonly kind: "closed"; readonly owner: Node }
  | { readonly kind: "open" };

export function auditReturnStorageOwnerBoundaries(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  owners: ReadonlySet<Node>,
  bindings: ReadonlyMap<Node, ReturnStorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): void {
  if (owners.size === 0) {
    return;
  }
  const invalid = new Set<Node>();
  const dependencies = new Map<Node, Set<Node>>();
  const typeOwners = new Map<Type, ReadonlySet<Node>>();
  const ownersFor = (node: Node): ReadonlySet<Node> => {
    const semantics = source.semantics.forNode(node);
    const type = semantics.getTypeAtLocation(node);
    return type === undefined
      ? new Set()
      : ownersWithinType(semantics, type, owners, typeOwners, new Set());
  };
  rejectOpenStorageValues(source, bindings, owners);
  auditInvocations(
    source,
    nodes,
    owners,
    ownersFor,
    typeOwners,
    invalid,
    dependencies,
  );
  auditValueFlows(
    source,
    nodes,
    owners,
    bindings,
    storageDeclarationFor,
    ownersFor,
    typeOwners,
    invalid,
    dependencies,
  );
  closeInvalidOwners(invalid, dependencies);
  for (const binding of bindings.values()) {
    if (invalid.has(binding.owner)) {
      binding.valid = false;
    }
  }
}

function auditInvocations(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  owners: ReadonlySet<Node>,
  ownersFor: (node: Node) => ReadonlySet<Node>,
  typeOwners: Map<Type, ReadonlySet<Node>>,
  invalid: Set<Node>,
  dependencies: Map<Node, Set<Node>>,
): void {
  for (const node of nodes) {
    if (!source.ast.is.IsCallExpression(node) && !source.ast.is.IsNewExpression(node)) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const declaration = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(node),
    );
    const resultOwners = ownersFor(node);
    const parameters = declaration === undefined
      ? []
      : source.ast.parameters(declaration);
    const arguments_ = source.ast.arguments(node);
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index];
      if (argument === undefined) {
        continue;
      }
      const carried = ownersFor(argument);
      if (carried.size === 0) {
        continue;
      }
      const contextual = semantics.selectContextualValueType(argument);
      const retained = contextual.kind === "selected"
        ? ownersWithinType(semantics, contextual.type, owners, typeOwners, new Set())
        : new Set<Node>();
      for (const owner of carried) {
        const parameter = parameters[index];
        if (
          !source.navigation.isProjectDeclaration(declaration) ||
          !retained.has(owner) ||
          parameterPropertyIsOpen(source, parameter, owners)
        ) {
          invalid.add(owner);
        } else {
          for (const resultOwner of resultOwners) {
            appendOwnerDependency(dependencies, owner, resultOwner);
          }
        }
      }
    }
    if (source.ast.is.IsCallExpression(node)) {
      const receiver = invocationReceiver(source, node);
      if (receiver !== undefined && !source.navigation.isProjectDeclaration(declaration)) {
        for (const owner of ownersFor(receiver)) {
          invalid.add(owner);
        }
      }
    }
  }
}

function auditValueFlows(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  owners: ReadonlySet<Node>,
  bindings: ReadonlyMap<Node, ReturnStorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  ownersFor: (node: Node) => ReadonlySet<Node>,
  typeOwners: Map<Type, ReadonlySet<Node>>,
  invalid: Set<Node>,
  dependencies: Map<Node, Set<Node>>,
): void {
  for (const node of nodes) {
    if (!valueExpressionCanWiden(source, node)) {
      continue;
    }
    const carried = ownersFor(node);
    if (carried.size === 0) {
      continue;
    }
    const child = transparentChild(source, node);
    if (child !== undefined) {
      const childOwners = ownersFor(child);
      for (const owner of carried) {
        if (!childOwners.has(owner)) {
          invalid.add(owner);
        }
      }
    }
    auditTransparentConversion(
      source,
      node,
      carried,
      owners,
      typeOwners,
      invalid,
    );
    const composite = containingCompositeExpression(source, node);
    if (composite !== undefined) {
      const compositeOwners = ownersFor(composite);
      for (const owner of carried) {
        if (!compositeOwners.has(owner)) {
          invalid.add(owner);
        }
      }
    }
    const destination = storageDestination(
      source,
      node,
      bindings,
      storageDeclarationFor,
    );
    if (destination?.kind === "open") {
      for (const owner of carried) {
        invalid.add(owner);
      }
    } else if (destination?.kind === "closed") {
      for (const owner of carried) {
        appendOwnerDependency(dependencies, owner, destination.owner);
      }
    }
    const semantics = source.semantics.forNode(node);
    const contextual = semantics.selectContextualValueType(node);
    if (contextual.kind === "unavailable") {
      continue;
    }
    const selected = contextual.kind === "selected"
      ? [contextual.type]
      : contextual.types;
    for (const owner of carried) {
      if (!selected.some((type) =>
        ownersWithinType(
          semantics,
          type,
          owners,
          typeOwners,
          new Set(),
        ).has(owner)
      )) {
        invalid.add(owner);
      }
    }
  }
}

function rejectOpenStorageValues(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, ReturnStorageOwnerBinding>,
  owners: ReadonlySet<Node>,
): void {
  for (const binding of bindings.values()) {
    for (const input of binding.inputs) {
      const semantics = source.semantics.forNode(input);
      const type = semantics.getTypeAtLocation(input);
      if (
        type === undefined ||
        !typeIsClosedStorageValue(
          semantics,
          type,
          owners,
          new Set(),
        )
      ) {
        binding.valid = false;
      }
    }
  }
}

function typeIsClosedStorageValue(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
  owners: ReadonlySet<Node>,
  pending: Set<Type>,
): boolean {
  if (
    semantics.isNever(type) ||
    semantics.isVoidLike(type) ||
    semantics.isNullish(type) ||
    semantics.isStringLike(type) ||
    semantics.isNumberLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type)
  ) {
    return true;
  }
  if (semantics.isAny(type) || semantics.isUnknown(type)) {
    return false;
  }
  if (directOwnersWithinType(semantics, type, owners).size !== 0) {
    return true;
  }
  if (!semantics.isUnion(type) || pending.has(type)) {
    return false;
  }
  pending.add(type);
  const result = semantics.getUnionOrIntersectionTypes(type).every((member) =>
    member !== undefined && typeIsClosedStorageValue(
      semantics,
      member,
      owners,
      pending,
    )
  );
  pending.delete(type);
  return result;
}

function auditTransparentConversion(
  source: TargetSourceProgram,
  node: Node,
  carried: ReadonlySet<Node>,
  owners: ReadonlySet<Node>,
  typeOwners: Map<Type, ReadonlySet<Node>>,
  invalid: Set<Node>,
): void {
  const parent = source.ast.parent(node);
  if (parent === undefined || !isTransparentParent(source, parent, node)) {
    return;
  }
  const semantics = source.semantics.forNode(parent);
  const parentType = semantics.getTypeAtLocation(parent);
  const retained = parentType === undefined
    ? new Set<Node>()
    : ownersWithinType(
      semantics,
      parentType,
      owners,
      typeOwners,
      new Set(),
    );
  for (const owner of carried) {
    if (!retained.has(owner)) {
      invalid.add(owner);
    }
  }
}

function ownersWithinType(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
  candidates: ReadonlySet<Node>,
  cache: Map<Type, ReadonlySet<Node>>,
  pending: Set<Type>,
): ReadonlySet<Node> {
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(type)) {
    return new Set();
  }
  if (
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.isNever(type) ||
    semantics.isVoidLike(type) ||
    semantics.isNullish(type) ||
    semantics.isStringLike(type) ||
    semantics.isNumberLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type)
  ) {
    const empty = new Set<Node>();
    cache.set(type, empty);
    return empty;
  }
  pending.add(type);
  const result = directOwnersWithinType(semantics, type, candidates);
  if (result.size === 0) {
    const nested = [
      ...(semantics.isUnion(type) || semantics.isIntersection(type)
        ? semantics.getUnionOrIntersectionTypes(type)
        : []),
      ...(semantics.isTypeReference(type) ? semantics.getTypeArguments(type) : []),
    ];
    for (const member of nested) {
      if (member === undefined) {
        continue;
      }
      for (const owner of ownersWithinType(
        semantics,
        member,
        candidates,
        cache,
        pending,
      )) {
        result.add(owner);
      }
    }
  }
  pending.delete(type);
  cache.set(type, result);
  return result;
}

function directOwnersWithinType(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
  candidates: ReadonlySet<Node>,
): Set<Node> {
  const result = new Set<Node>();
  const declaration = semantics.getPrimarySymbolDeclaration(
    semantics.getTypeSymbol(type),
  );
  if (declaration !== undefined && candidates.has(declaration)) {
    result.add(declaration);
  }
  const target = semantics.isTypeReference(type)
    ? semantics.getTypeReferenceTarget(type)
    : undefined;
  const targetDeclaration = target === undefined
    ? undefined
    : semantics.getPrimarySymbolDeclaration(semantics.getTypeSymbol(target));
  if (targetDeclaration !== undefined && candidates.has(targetDeclaration)) {
    result.add(targetDeclaration);
  }
  return result;
}

function containingCompositeExpression(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (
      source.ast.is.IsObjectLiteralExpression(parent) ||
      source.ast.is.IsArrayLiteralExpression(parent)
    ) {
      return parent;
    }
    if (isCompositeBoundary(source, parent)) {
      return undefined;
    }
    current = parent;
  }
}

function isCompositeBoundary(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsCallExpression(node) ||
    source.ast.is.IsNewExpression(node) ||
    source.ast.is.IsReturnStatement(node) ||
    source.ast.is.IsVariableDeclaration(node) ||
    source.ast.is.IsBinaryExpression(node) ||
    source.ast.is.IsExpressionStatement(node) ||
    source.ast.is.IsSourceFile(node) ||
    source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsConstructorDeclaration(node) ||
    source.ast.is.IsGetAccessorDeclaration(node) ||
    source.ast.is.IsSetAccessorDeclaration(node);
}

function storageDestination(
  source: TargetSourceProgram,
  expression: Node,
  bindings: ReadonlyMap<Node, ReturnStorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): StorageDestination | undefined {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      const declaration = binary?.Right === current &&
          source.ast.operatorKindName(parent) === "KindEqualsToken" &&
          binary.Left !== undefined
        ? storageDeclarationFor(binary.Left)
        : undefined;
      if (binary?.Right !== current || binary.Left === undefined) {
        return undefined;
      }
      if (
        !source.ast.is.IsPropertyAccessExpression(binary.Left) &&
        !source.ast.is.IsElementAccessExpression(binary.Left)
      ) {
        return undefined;
      }
      const owner = declaration === undefined ? undefined : bindings.get(declaration)?.owner;
      return owner === undefined ? { kind: "open" } : { kind: "closed", owner };
    }
    if (source.ast.is.IsPropertyDeclaration(parent)) {
      const declaration = source.ast.as.AsPropertyDeclaration(parent)?.Initializer === current
        ? parent
        : undefined;
      if (declaration === undefined) {
        return undefined;
      }
      const owner = bindings.get(declaration)?.owner;
      return owner === undefined ? { kind: "open" } : { kind: "closed", owner };
    }
    return undefined;
  }
}

function parameterPropertyIsOpen(
  source: TargetSourceProgram,
  parameter: Node | undefined,
  owners: ReadonlySet<Node>,
): boolean {
  if (
    parameter === undefined ||
    !source.ast.is.IsParameterDeclaration(parameter) ||
    !(["public", "private", "protected", "readonly"] as const).some(
      (modifier) => source.ast.hasModifierKind(parameter, modifier),
    )
  ) {
    return false;
  }
  const constructor = source.ast.parent(parameter);
  const owner = constructor === undefined ? undefined : source.ast.parent(constructor);
  return owner === undefined || !owners.has(owner);
}

function invocationReceiver(
  source: TargetSourceProgram,
  call: Node,
): Node | undefined {
  const expression = source.ast.as.AsCallExpression(call)?.Expression;
  if (expression === undefined) {
    return undefined;
  }
  if (source.ast.is.IsPropertyAccessExpression(expression)) {
    return source.ast.as.AsPropertyAccessExpression(expression)?.Expression;
  }
  return source.ast.is.IsElementAccessExpression(expression)
    ? source.ast.as.AsElementAccessExpression(expression)?.Expression
    : undefined;
}

function closeInvalidOwners(
  invalid: Set<Node>,
  dependencies: ReadonlyMap<Node, ReadonlySet<Node>>,
): void {
  const dependents = new Map<Node, Set<Node>>();
  for (const [owner, destinations] of dependencies) {
    for (const destination of destinations) {
      const existing = dependents.get(destination);
      if (existing === undefined) {
        dependents.set(destination, new Set([owner]));
      } else {
        existing.add(owner);
      }
    }
  }
  const pending = [...invalid];
  while (pending.length !== 0) {
    const destination = pending.pop();
    if (destination === undefined) {
      continue;
    }
    for (const owner of dependents.get(destination) ?? []) {
      if (!invalid.has(owner)) {
        invalid.add(owner);
        pending.push(owner);
      }
    }
  }
}

function appendOwnerDependency(
  dependencies: Map<Node, Set<Node>>,
  owner: Node,
  destination: Node,
): void {
  if (owner === destination) {
    return;
  }
  const destinations = dependencies.get(owner);
  if (destinations === undefined) {
    dependencies.set(owner, new Set([destination]));
  } else {
    destinations.add(destination);
  }
}

function valueExpressionCanWiden(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsIdentifier(node) ||
    source.ast.is.IsCallExpression(node) ||
    source.ast.is.IsNewExpression(node) ||
    source.ast.is.IsPropertyAccessExpression(node) ||
    source.ast.is.IsElementAccessExpression(node) ||
    source.ast.is.IsConditionalExpression(node) ||
    source.ast.is.IsArrayLiteralExpression(node) ||
    source.ast.is.IsObjectLiteralExpression(node) ||
    source.ast.is.IsParenthesizedExpression(node) ||
    source.ast.is.IsAsExpression(node) ||
    source.ast.is.IsTypeAssertion(node) ||
    source.ast.is.IsSatisfiesExpression(node) ||
    source.ast.is.IsNonNullExpression(node);
}

function transparentChild(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  if (source.ast.is.IsParenthesizedExpression(node)) {
    return source.ast.as.AsParenthesizedExpression(node)?.Expression;
  }
  if (source.ast.is.IsAsExpression(node)) {
    return source.ast.as.AsAsExpression(node)?.Expression;
  }
  if (source.ast.is.IsTypeAssertion(node)) {
    return source.ast.as.AsTypeAssertion(node)?.Expression;
  }
  if (source.ast.is.IsSatisfiesExpression(node)) {
    return source.ast.as.AsSatisfiesExpression(node)?.Expression;
  }
  return source.ast.is.IsNonNullExpression(node)
    ? source.ast.as.AsNonNullExpression(node)?.Expression
    : undefined;
}
