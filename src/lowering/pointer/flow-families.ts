import {
  pointerFactKey,
  pointerOperationFactKey,
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  PointerOperationFact,
  Type,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { PointerFlowComponent } from "./flow-graph.js";
import { indexExactDeclarations } from "./flow-references.js";
import { describePointerPointee } from "./pointee-classification.js";
import { transparentExpression } from "./flow-syntax.js";

interface MutableDirectReferenceFamily {
  readonly identity: Node;
  readonly pointerTypes: Set<Node>;
  readonly operations: Map<Node, PointerOperationFact>;
  readonly blockers: Set<string>;
  producerCount: number;
}

export interface DirectReferenceFamilyPlan {
  readonly representations: ReadonlyMap<Node, "direct-object">;
  readonly familyCount: number;
}

export function planDirectReferenceFamilies(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  components: readonly PointerFlowComponent[],
): DirectReferenceFamilyPlan {
  const families = new Map<Node, MutableDirectReferenceFamily>();
  const operationFamilies = new Map<Node, MutableDirectReferenceFamily>();
  for (const node of nodes) {
    collectPointerType(source, node, families);
    collectPointerOperation(
      source,
      node,
      families,
      operationFamilies,
    );
  }
  applyGenericPointerBoundaries(
    source,
    nodes,
    families,
    operationFamilies,
  );
  applyComponentBoundaries(
    source,
    components,
    families,
    operationFamilies,
  );
  const representations = new Map<Node, "direct-object">();
  let familyCount = 0;
  for (const family of families.values()) {
    if (
      family.blockers.size !== 0 ||
      family.producerCount === 0 ||
      family.operations.size === 0
    ) {
      continue;
    }
    familyCount += 1;
    for (const pointerType of family.pointerTypes) {
      representations.set(pointerType, "direct-object");
    }
    for (const operation of family.operations.keys()) {
      representations.set(operation, "direct-object");
    }
  }
  return Object.freeze({
    representations,
    familyCount,
  });
}

function collectPointerType(
  source: TargetSourceProgram,
  node: Node,
  families: Map<Node, MutableDirectReferenceFamily>,
): void {
  if (!source.ast.is.IsTypeReferenceNode(node)) {
    return;
  }
  const fact = source.sourceFacts.getFact(node, pointerFactKey);
  if (fact === undefined) {
    return;
  }
  const semantics = source.semantics.forNode(node);
  const pointee = semantics.getTypeFromTypeNode(fact.pointee);
  const family = pointee === undefined
    ? undefined
    : directReferenceFamily(source, node, pointee, families);
  if (family === undefined) {
    return;
  }
  family.pointerTypes.add(node);
  const sourceFile = source.ast.getSourceFile(node);
  if (
    sourceFile === undefined ||
    source.ast.isDeclarationFile(sourceFile)
  ) {
    family.blockers.add("declaration-boundary");
  }
}

function collectPointerOperation(
  source: TargetSourceProgram,
  node: Node,
  families: Map<Node, MutableDirectReferenceFamily>,
  operationFamilies: Map<Node, MutableDirectReferenceFamily>,
): void {
  const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
  if (operation === undefined) {
    return;
  }
  const family = directReferenceFamily(
    source,
    operation.explicitPointeeTypeNode ?? operation.call,
    operation.pointeeType,
    families,
  );
  if (family === undefined) {
    return;
  }
  family.operations.set(node, operation);
  operationFamilies.set(node, family);
  switch (operation.operation) {
    case "allocate":
    case "address-of":
      family.producerCount += 1;
      break;
    case "load":
      break;
    case "equal-pointer":
      family.blockers.add("identity-observed");
      break;
    default:
      family.blockers.add(`operation:${operation.operation}`);
      break;
  }
}

function applyGenericPointerBoundaries(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): void {
  const boundaries = collectGenericPointerBoundaries(source, nodes);
  const callables = indexExactDeclarations(source, boundaries.callables);
  for (const [operationNode, family] of operationFamilies) {
    const operation = source.sourceFacts.getFact(
      operationNode,
      pointerOperationFactKey,
    );
    if (operation === undefined) {
      continue;
    }
    for (const operand of pointerOperands(operation)) {
      const reference = source.navigation.sourceReferenceFor(
        transparentExpression(source, operand),
      );
      const authoredType = reference === undefined
        ? undefined
        : source.ast.typeNode(reference.declaration);
      if (
        authoredType !== undefined &&
        authoredTypeContainsGenericPointer(source, operand, authoredType)
      ) {
        family.blockers.add("generic-storage-boundary");
      }
    }
  }
  for (const node of nodes) {
    if (
      !source.ast.is.IsCallExpression(node) ||
      operationFamilies.has(node)
    ) {
      continue;
    }
    const callExpression = source.ast.as.AsCallExpression(node)?.Expression;
    const target = transparentExpression(source, callExpression);
    const targetReference = source.ast.name(target) ?? target;
    if (callables.declarationFor(targetReference) === undefined) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const call = semantics.getResolvedCallInfo(node);
    if (call?.sourceSelectedSignatureKind !== "resolved") {
      continue;
    }
    for (const binding of call.sourceArgumentBindings) {
      const parameter = call.sourceSelectedSignatureParameters[
        binding.sourceParameterIndex
      ];
      if (
        parameter?.authoredTypeNode === undefined ||
        !authoredTypeContainsGenericPointer(
          source,
          node,
          parameter.authoredTypeNode,
        )
      ) {
        continue;
      }
      blockSelectedPointerFamilies(
        source,
        node,
        binding.selectedParameterType,
        families,
        "generic-call-boundary",
      );
    }
    const selectedDeclaration = semantics.getSignatureDeclaration(
      call.selectedSignature,
    );
    const returnType = selectedDeclaration === undefined
      ? undefined
      : source.ast.typeNode(selectedDeclaration);
    if (
      returnType !== undefined &&
      authoredTypeContainsGenericPointer(source, node, returnType)
    ) {
      blockSelectedPointerFamilies(
        source,
        node,
        call.sourceResultType,
        families,
        "generic-call-boundary",
      );
    }
  }
}

function pointerOperands(operation: PointerOperationFact): readonly Node[] {
  switch (operation.operation) {
    case "load":
    case "store":
    case "hash-pointer":
    case "project-pointer":
      return [operation.pointerExpression];
    case "equal-pointer":
      return [operation.leftExpression, operation.rightExpression];
    case "address-of":
    case "allocate":
    case "bind-pointer":
      return [];
  }
}

interface GenericPointerBoundaries {
  readonly callables: ReadonlySet<Node>;
}

function collectGenericPointerBoundaries(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): GenericPointerBoundaries {
  const callables = new Set<Node>();
  for (const node of nodes) {
    if (!source.ast.is.IsTypeReferenceNode(node)) {
      continue;
    }
    const fact = source.sourceFacts.getFact(node, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const pointee = semantics.getTypeFromTypeNode(fact.pointee);
    if (
      pointee === undefined ||
      !semantics.couldContainTypeVariables(pointee)
    ) {
      continue;
    }
    const owner = typedDeclarationOwner(source, node);
    if (owner !== undefined) {
      const callable = signatureCallableOwner(source, owner, node);
      if (callable !== undefined) {
        callables.add(callable);
      }
    }
  }
  return Object.freeze({ callables });
}

function signatureCallableOwner(
  source: TargetSourceProgram,
  owner: Node,
  pointerType: Node,
): Node | undefined {
  for (
    let current: Node | undefined = owner;
    current !== undefined && !source.ast.is.IsSourceFile(current);
    current = source.ast.parent(current)
  ) {
    if (!isCallableDeclaration(source, current)) {
      continue;
    }
    const inParameter = source.ast.parameters(current).some((parameter) =>
      parameter !== undefined && containsNode(source, parameter, pointerType)
    );
    const returnType = source.ast.typeNode(current);
    return inParameter ||
        returnType !== undefined && containsNode(source, returnType, pointerType)
      ? current
      : undefined;
  }
  return undefined;
}

function isCallableDeclaration(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsConstructorDeclaration(node) ||
    source.ast.is.IsGetAccessorDeclaration(node) ||
    source.ast.is.IsSetAccessorDeclaration(node);
}

function typedDeclarationOwner(
  source: TargetSourceProgram,
  pointerType: Node,
): Node | undefined {
  for (
    let current = source.ast.parent(pointerType);
    current !== undefined && !source.ast.is.IsSourceFile(current);
    current = source.ast.parent(current)
  ) {
    const type = source.ast.typeNode(current);
    if (type !== undefined && containsNode(source, type, pointerType)) {
      return current;
    }
  }
  return undefined;
}

function containsNode(
  source: TargetSourceProgram,
  root: Node,
  expected: Node,
): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === expected) {
      return true;
    }
    if (node !== undefined) {
      for (const child of source.ast.children(node)) {
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }
  return false;
}

function authoredTypeContainsGenericPointer(
  source: TargetSourceProgram,
  anchor: Node,
  authoredType: Node,
): boolean {
  const semantics = source.semantics.forNode(anchor);
  for (const subject of semantics.getAuthoredTypeFactSubjects(authoredType)) {
    const fact = source.sourceFacts.getFact(subject, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    const pointee = semantics.getTypeFromTypeNode(fact.pointee);
    if (
      pointee !== undefined &&
      semantics.couldContainTypeVariables(pointee)
    ) {
      return true;
    }
  }
  return false;
}

function blockSelectedPointerFamilies(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type | undefined,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  blocker: string,
): void {
  if (type === undefined) {
    return;
  }
  for (const family of selectedPointerFamilies(source, anchor, type, families)) {
    family.blockers.add(blocker);
  }
}

function selectedPointerFamilies(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): ReadonlySet<MutableDirectReferenceFamily> {
  const result = new Set<MutableDirectReferenceFamily>();
  const seen = new Set<Type>();
  const pending = [type];
  const semantics = source.semantics.forNode(anchor);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (semantics.isUnion(current) || semantics.isIntersection(current)) {
      for (const member of semantics.getUnionOrIntersectionTypes(current)) {
        if (member !== undefined) {
          pending.push(member);
        }
      }
      continue;
    }
    const arguments_ = semantics.getEffectiveTypeArguments(current);
    if (selectedTypeIsPointer(source, semantics.getTypeFactSubjects(current))) {
      const pointee = arguments_?.length === 1 ? arguments_[0] : undefined;
      const description = pointee === undefined
        ? undefined
        : describePointerPointee(source, anchor, pointee);
      const family = description?.category === "direct-reference" &&
          typeof description.identity !== "string"
        ? families.get(description.identity)
        : undefined;
      if (family !== undefined) {
        result.add(family);
      }
      continue;
    }
    if (arguments_ !== undefined) {
      pending.push(...arguments_);
    }
  }
  return result;
}

function selectedTypeIsPointer(
  source: TargetSourceProgram,
  subjects: readonly ExtensionFactSubject[],
): boolean {
  return subjects.some((subject) => {
    const marker = source.sourceFacts.getFact(subject, sourceMarkerFactKey);
    return marker?.kind === "type-marker" && marker.marker === "pointer";
  });
}

function directReferenceFamily(
  source: TargetSourceProgram,
  anchor: Node,
  pointee: PointerOperationFact["pointeeType"],
  families: Map<Node, MutableDirectReferenceFamily>,
): MutableDirectReferenceFamily | undefined {
  const description = describePointerPointee(source, anchor, pointee);
  if (
    description?.category !== "direct-reference" ||
    typeof description.identity === "string"
  ) {
    return undefined;
  }
  const existing = families.get(description.identity);
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableDirectReferenceFamily = {
    identity: description.identity,
    pointerTypes: new Set(),
    operations: new Map(),
    blockers: new Set(),
    producerCount: 0,
  };
  families.set(description.identity, created);
  return created;
}

function applyComponentBoundaries(
  source: TargetSourceProgram,
  components: readonly PointerFlowComponent[],
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): void {
  for (const component of components) {
    const touched = new Set<MutableDirectReferenceFamily>();
    let hasNonDirectPointee = false;
    for (const evidence of component.pointees) {
      const description = describePointerPointee(
        source,
        evidence.anchor,
        evidence.type,
      );
      if (
        description?.category !== "direct-reference" ||
        typeof description.identity === "string"
      ) {
        hasNonDirectPointee = true;
        continue;
      }
      const family = families.get(description.identity);
      if (family !== undefined) {
        touched.add(family);
      }
    }
    for (const operation of component.operations) {
      const family = operationFamilies.get(operation);
      if (family !== undefined) {
        touched.add(family);
      }
    }
    if (hasNonDirectPointee) {
      for (const family of touched) {
        family.blockers.add("mixed-pointee-flow");
      }
    }
    if (
      component.blockers.includes("addressed-storage-may-change") ||
      component.blockers.includes("external-boundary") ||
      component.blockers.includes("unsupported-producer")
    ) {
      for (const family of touched) {
        family.blockers.add("component-boundary");
      }
    }
  }
}
