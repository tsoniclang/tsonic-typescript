import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindArrayLiteralExpression,
  KindAsExpression,
  KindCallExpression,
  KindConditionalExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindNewExpression,
  KindNonNullExpression,
  KindObjectLiteralExpression,
  KindParenthesizedExpression,
  KindPropertyAccessExpression,
  KindSatisfiesExpression,
  KindTypeAssertionExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import { isTransparentParent } from "../callable/input-reference.js";
import {
  collectStorageOwnerCarriers,
  emptyStorageOwnerMembership,
  ownersWithinStorageType,
  storageValueTypeIsClosed,
  type StorageOwnerMembership,
} from "./owner-types.js";
import { auditStorageOwnerIngress } from "./owner-ingress.js";

export interface StorageOwnerBinding {
  readonly declaration: Node;
  readonly owner: Node;
  readonly inputs: readonly Node[];
  valid: boolean;
}

type StorageDestination =
  | { readonly kind: "closed"; readonly owner: Node }
  | { readonly kind: "open" };

export function auditStorageOwnerBoundaries(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlySet<Node>,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  validateStoredValues: boolean,
  transports?: InvocationTransportContract,
): void {
  if (owners.size === 0) {
    return;
  }
  const invalid = new Set<Node>();
  const dependencies = new Map<Node, Set<Node>>();
  const carriers = collectStorageOwnerCarriers(source, program, owners).carriers;
  const typeOwners = new Map<Type, StorageOwnerMembership>();
  const ownersFor = (node: Node): StorageOwnerMembership => {
    const semantics = source.semantics.forNode(node);
    const type = semantics.getTypeAtLocation(node);
    return type === undefined
      ? emptyStorageOwnerMembership
      : ownersWithinStorageType(
        semantics,
        type,
        carriers,
        typeOwners,
      );
  };
  if (validateStoredValues) {
    rejectOpenStorageValues(source, bindings, owners);
  }
  auditStorageOwnerIngress(source, program, ownersFor, invalid);
  auditInvocations(
    source,
    program,
    carriers,
    ownersFor,
    typeOwners,
    invalid,
    dependencies,
    transports,
  );
  auditValueFlows(
    source,
    program,
    carriers,
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
  program: TargetProgramIndex,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  ownersFor: (node: Node) => StorageOwnerMembership,
  typeOwners: Map<Type, StorageOwnerMembership>,
  invalid: Set<Node>,
  dependencies: Map<Node, Set<Node>>,
  transports: InvocationTransportContract | undefined,
): void {
  for (const node of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    const semantics = source.semantics.forNode(node);
    const declaration = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(node),
    );
    const resultOwners = ownersFor(node);
    const projectInvocation = invocationHasProjectImplementation(
      source,
      node,
      declaration,
    );
    const transport = transports?.transportFor(node);
    if (!projectInvocation && transport === undefined) {
      for (const owner of resultOwners) {
        invalid.add(owner);
      }
    } else if (!projectInvocation && transport !== undefined) {
      for (const owner of resultOwners) {
        if (!transport.resultInputs.some((input) => ownersFor(input).includes(owner))) {
          invalid.add(owner);
        }
      }
    }
    const arguments_ = source.ast.arguments(node);
    for (const argument of arguments_) {
      if (argument === undefined) {
        continue;
      }
      const carried = ownersFor(argument);
      if (carried.length === 0) {
        continue;
      }
      for (const owner of carried) {
        if (transport?.inputs.includes(argument)) {
          continue;
        }
        const contextual = semantics.selectContextualValueType(argument);
        const retained = contextual.kind === "selected"
          ? ownersWithinStorageType(
            semantics,
            contextual.type,
            carriers,
            typeOwners,
          )
          : emptyStorageOwnerMembership;
        if (!projectInvocation || !retained.includes(owner)) {
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
      if (receiver !== undefined && !projectInvocation && transport === undefined) {
        for (const owner of ownersFor(receiver)) {
          invalid.add(owner);
        }
      }
    }
  }
}

function auditValueFlows(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  ownersFor: (node: Node) => StorageOwnerMembership,
  typeOwners: Map<Type, StorageOwnerMembership>,
  invalid: Set<Node>,
  dependencies: Map<Node, Set<Node>>,
): void {
  for (const node of program.nodesOfKinds([
    KindIdentifier,
    KindCallExpression,
    KindNewExpression,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
    KindConditionalExpression,
    KindArrayLiteralExpression,
    KindObjectLiteralExpression,
    KindParenthesizedExpression,
    KindAsExpression,
    KindTypeAssertionExpression,
    KindSatisfiesExpression,
    KindNonNullExpression,
  ])) {
    const carried = ownersFor(node);
    if (carried.length === 0) {
      continue;
    }
    const child = transparentChild(source, node);
    if (child !== undefined) {
      const childOwners = ownersFor(child);
      for (const owner of carried) {
        if (!childOwners.includes(owner)) {
          invalid.add(owner);
        }
      }
    }
    auditTransparentConversion(
      source,
      node,
      carried,
      carriers,
      typeOwners,
      invalid,
    );
    const composite = containingCompositeExpression(source, node);
    if (composite !== undefined) {
      const compositeOwners = ownersFor(composite);
      for (const owner of carried) {
        if (!compositeOwners.includes(owner)) {
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
        ownersWithinStorageType(
          semantics,
          type,
          carriers,
          typeOwners,
        ).includes(owner)
      )) {
        invalid.add(owner);
      }
    }
  }
}

function rejectOpenStorageValues(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  owners: ReadonlySet<Node>,
): void {
  for (const binding of bindings.values()) {
    for (const input of binding.inputs) {
      const semantics = source.semantics.forNode(input);
      const type = semantics.getTypeAtLocation(input);
      if (
        type === undefined ||
        !storageValueTypeIsClosed(
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

function auditTransparentConversion(
  source: TargetSourceProgram,
  node: Node,
  carried: StorageOwnerMembership,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  typeOwners: Map<Type, StorageOwnerMembership>,
  invalid: Set<Node>,
): void {
  const parent = source.ast.parent(node);
  if (parent === undefined || !isTransparentParent(source, parent, node)) {
    return;
  }
  const semantics = source.semantics.forNode(parent);
  const parentType = semantics.getTypeAtLocation(parent);
  const retained = parentType === undefined
    ? emptyStorageOwnerMembership
    : ownersWithinStorageType(
      semantics,
      parentType,
      carriers,
      typeOwners,
    );
  for (const owner of carried) {
    if (!retained.includes(owner)) {
      invalid.add(owner);
    }
  }
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
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
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

function invocationReceiver(source: TargetSourceProgram, call: Node): Node | undefined {
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

function declarationHasProjectBody(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): declaration is Node {
  return declaration !== undefined &&
    source.navigation.isProjectDeclaration(declaration) &&
    !source.ast.hasModifierKind(declaration, "ambient") &&
    source.ast.body(declaration) !== undefined;
}

function invocationHasProjectImplementation(
  source: TargetSourceProgram,
  invocation: Node,
  declaration: Node | undefined,
): boolean {
  if (declarationHasProjectBody(source, declaration)) {
    return true;
  }
  if (!source.ast.is.IsNewExpression(invocation)) {
    return false;
  }
  const expression = source.ast.as.AsNewExpression(invocation)?.Expression;
  const selected = expression === undefined
    ? undefined
    : source.navigation.sourceReferenceFor(expression)?.declaration;
  return selected !== undefined &&
    source.navigation.isProjectDeclaration(selected) &&
    source.ast.is.IsClassDeclaration(selected) &&
    source.ast.members(selected).every((member) =>
      member === undefined ||
      !source.ast.is.IsConstructorDeclaration(member)
    );
}

function transparentChild(source: TargetSourceProgram, node: Node): Node | undefined {
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
