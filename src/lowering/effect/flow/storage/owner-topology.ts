import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
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
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { ExactSourceBodyInspection } from "../../model/source-membership.js";
import { isTransparentParent } from "../callable/input-reference.js";
import { storageDeclarationCanBeTracked } from "./owners.js";
import {
  collectStorageOwnerCarriers,
  emptyStorageOwnerMembership,
  storageOwnerMembershipIsEmpty,
  universalStorageOwnerMembership,
  ownersWithinStorageType,
  type StorageOwnerMembership,
} from "./owner-types.js";

export interface StorageOwnerInvocationArgument {
  readonly expression: Node;
  readonly owners: StorageOwnerMembership;
  readonly contextualOwners: StorageOwnerMembership;
}

export interface StorageOwnerInvocation {
  readonly node: Node;
  readonly resultOwners: StorageOwnerMembership;
  readonly arguments: readonly StorageOwnerInvocationArgument[];
  readonly receiverOwners: StorageOwnerMembership;
}

export interface StorageOwnerValueFlow {
  readonly node: Node;
  readonly owners: StorageOwnerMembership;
  readonly childOwners?: StorageOwnerMembership;
  readonly transparentParentOwners?: StorageOwnerMembership;
  readonly compositeOwners?: StorageOwnerMembership;
  readonly contextualOwners?: StorageOwnerMembership;
}

export interface StorageOwnerTopology {
  readonly invocations: readonly StorageOwnerInvocation[];
  readonly valueFlows: readonly StorageOwnerValueFlow[];
  covers(
    source: TargetSourceProgram,
    program: TargetProgramIndex,
    owners: ReadonlySet<Node>,
  ): boolean;
  ownersFor(node: Node): StorageOwnerMembership;
}

export function createStorageOwnerTopology(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlySet<Node>,
  planningObserver?: TypeScriptPlanningObserver,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): StorageOwnerTopology {
  const carrierIndex = collectStorageOwnerCarriers(
    source,
    program,
    owners,
    bodyInspectionIsCertified,
  );
  const { carriers } = carrierIndex;
  planningObserver?.("effect-indirect-storage-carriers", {
    declarations: carriers.size,
    roots: carrierIndex.owners.length,
    steps: carrierIndex.operationCount,
  });
  const typeOwners = new Map<Type, StorageOwnerMembership>();
  const positiveOwners = new Map<Node, StorageOwnerMembership>();
  const ownersFor = (node: Node): StorageOwnerMembership => {
    const existing = positiveOwners.get(node);
    if (existing !== undefined) {
      return existing;
    }
    const selected = ownersForNode(
      source,
      node,
      carriers,
      typeOwners,
      carrierIndex.owners,
    );
    if (!storageOwnerMembershipIsEmpty(selected)) {
      positiveOwners.set(node, selected);
    }
    return selected;
  };
  const valueFlows: StorageOwnerValueFlow[] = [];
  const valueFlowNodes = new Set<Node>();
  const addValueFlow = (node: Node, carried: StorageOwnerMembership): void => {
    if (storageOwnerMembershipIsEmpty(carried) || valueFlowNodes.has(node)) {
      return;
    }
    valueFlowNodes.add(node);
    valueFlows.push(createValueFlow(
      source,
      node,
      carried,
      ownersFor,
      carriers,
      typeOwners,
      carrierIndex.owners,
    ));
  };
  const invocations: StorageOwnerInvocation[] = [];
  for (const node of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    const resultOwners = ownersFor(node);
    const arguments_ = source.ast.arguments(node).flatMap((argument) => {
      if (argument === undefined) {
        return [];
      }
      const carried = ownersFor(argument);
      return storageOwnerMembershipIsEmpty(carried)
        ? []
        : [Object.freeze({
          expression: argument,
          owners: carried,
          contextualOwners: contextualOwnersFor(
            source,
            node,
            argument,
            carriers,
            typeOwners,
            carrierIndex.owners,
          ),
        })];
    });
    const receiver = source.ast.is.IsCallExpression(node)
      ? invocationReceiver(source, node)
      : undefined;
    const receiverOwners = receiver === undefined
      ? emptyStorageOwnerMembership
      : ownersFor(receiver);
    if (
      !storageOwnerMembershipIsEmpty(resultOwners) ||
      arguments_.length !== 0 ||
      !storageOwnerMembershipIsEmpty(receiverOwners)
    ) {
      invocations.push(Object.freeze({
        node,
        resultOwners,
        arguments: Object.freeze(arguments_),
        receiverOwners,
      }));
    }
    addValueFlow(node, resultOwners);
  }
  for (const node of program.nodesOfKinds([
    KindIdentifier,
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
    addValueFlow(node, ownersFor(node));
  }
  planningObserver?.("effect-indirect-storage-topology", {
    calls: invocations.length,
    declarations: typeOwners.size,
    values: valueFlows.length,
  });
  const exactOwners = new Set(owners);
  return Object.freeze({
    invocations: Object.freeze(invocations),
    valueFlows: Object.freeze(valueFlows),
    covers(
      selectedSource: TargetSourceProgram,
      selectedProgram: TargetProgramIndex,
      selectedOwners: ReadonlySet<Node>,
    ): boolean {
      return selectedSource === source &&
        selectedProgram === program &&
        [...selectedOwners].every((owner) => exactOwners.has(owner));
    },
    ownersFor(node: Node): StorageOwnerMembership {
      return ownersFor(node);
    },
  });
}

function createValueFlow(
  source: TargetSourceProgram,
  node: Node,
  owners: StorageOwnerMembership,
  ownersFor: (node: Node) => StorageOwnerMembership,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  typeOwners: Map<Type, StorageOwnerMembership>,
  allOwners: readonly Node[],
): StorageOwnerValueFlow {
  const child = transparentChild(source, node);
  const parent = source.ast.parent(node);
  const composite = containingCompositeExpression(source, node);
  const contextual = source.semantics.forNode(node)
    .types.contextualValueSelection(node);
  return Object.freeze({
    node,
    owners,
    ...(child === undefined ? {} : { childOwners: ownersFor(child) }),
    ...(parent === undefined || !isTransparentParent(source, parent, node)
      ? {}
      : { transparentParentOwners: ownersFor(parent) }),
    ...(composite === undefined
      ? {}
      : { compositeOwners: ownersFor(composite) }),
    ...(contextual.kind === "unavailable"
      ? {}
      : {
        contextualOwners: ownersForTypes(
          source,
          node,
          contextual.kind === "selected"
            ? [contextual.type]
            : contextual.types,
          carriers,
          typeOwners,
          allOwners,
        ),
      }),
  });
}

function contextualOwnersFor(
  source: TargetSourceProgram,
  invocation: Node,
  argument: Node,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  typeOwners: Map<Type, StorageOwnerMembership>,
  allOwners: readonly Node[],
): StorageOwnerMembership {
  const semantics = source.semantics.forNode(invocation);
  const contextual = semantics.types.contextualValueSelection(argument);
  return contextual.kind === "selected"
    ? ownersWithinStorageType(
      semantics,
      contextual.type,
      carriers,
      typeOwners,
      allOwners,
    )
    : emptyStorageOwnerMembership;
}

function ownersForTypes(
  source: TargetSourceProgram,
  occurrence: Node,
  types: readonly Type[],
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  typeOwners: Map<Type, StorageOwnerMembership>,
  allOwners: readonly Node[],
): StorageOwnerMembership {
  const semantics = source.semantics.forNode(occurrence);
  const result = new Set<Node>();
  for (const type of types) {
    const carried = ownersWithinStorageType(
      semantics,
      type,
      carriers,
      typeOwners,
      allOwners,
    );
    if (carried.kind === "universal") {
      return universalStorageOwnerMembership;
    }
    if (carried.kind === "sparse") {
      for (const owner of carried.owners) {
        result.add(owner);
        if (result.size === allOwners.length) {
          return universalStorageOwnerMembership;
        }
      }
    }
  }
  return result.size === 0
    ? emptyStorageOwnerMembership
    : Object.freeze({
        kind: "sparse",
        owners: Object.freeze([...result]),
      });
}

function ownersForNode(
  source: TargetSourceProgram,
  node: Node,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  typeOwners: Map<Type, StorageOwnerMembership>,
  allOwners: readonly Node[],
): StorageOwnerMembership {
  const semantics = source.semantics.forNode(node);
  const type = semantics.types.expressionType(node);
  return type === undefined
    ? emptyStorageOwnerMembership
    : ownersWithinStorageType(
      semantics,
      type,
      carriers,
      typeOwners,
      allOwners,
    );
}

function invocationReceiver(source: TargetSourceProgram, call: Node): Node | undefined {
  const expression = source.ast.as.AsCallExpression(call)?.Expression;
  if (expression === undefined) {
    return undefined;
  }
  if (source.ast.is.IsPropertyAccessExpression(expression)) {
    if (storedCallableDoesNotObserveReceiver(source, call, expression)) {
      return undefined;
    }
    return source.ast.as.AsPropertyAccessExpression(expression)?.Expression;
  }
  if (source.ast.is.IsElementAccessExpression(expression)) {
    if (storedCallableDoesNotObserveReceiver(source, call, expression)) {
      return undefined;
    }
    return source.ast.as.AsElementAccessExpression(expression)?.Expression;
  }
  return undefined;
}

function storedCallableDoesNotObserveReceiver(
  source: TargetSourceProgram,
  call: Node,
  access: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const selected = source.ast.is.IsPropertyAccessExpression(access)
    ? semantics.operations.propertyAccess(access)?.selectedDeclaration
    : semantics.operations.elementAccess(access)?.selectedDeclaration;
  const signature = semantics.operations.call(call)?.selectedSignature;
  return selected !== undefined &&
    storageDeclarationCanBeTracked(source, selected) &&
    signature !== undefined &&
    semantics.types.signatureThisParameterInfo(signature) === undefined;
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
