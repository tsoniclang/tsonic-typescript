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

import type { PointerFlowBlocker } from "./flow-graph.js";
import {
  blockDirectReferenceFamily,
  type MutableDirectReferenceFamily,
} from "./flow-family-state.js";
import { transparentExpression } from "./flow-syntax.js";
import { describePointerPointee } from "./pointee-classification.js";

export function applyGenericPointerBoundaries(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): void {
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
        authoredTypeContainsRepresentationVaryingPointer(
          source,
          operand,
          authoredType,
        )
      ) {
        blockDirectReferenceFamily(family, "generic-storage", operand);
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
        !authoredTypeContainsRepresentationVaryingPointer(
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
        "generic-call",
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
      authoredTypeContainsRepresentationVaryingPointer(
        source,
        node,
        returnType,
      )
    ) {
      blockSelectedPointerFamilies(
        source,
        node,
        call.sourceResultType,
        families,
        "generic-call",
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

function authoredTypeContainsRepresentationVaryingPointer(
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
      semantics.couldContainTypeVariables(pointee) &&
      describePointerPointee(source, fact.pointee, pointee) === undefined
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
  blocker: PointerFlowBlocker,
): void {
  if (type === undefined) {
    return;
  }
  for (const family of selectedPointerFamilies(source, anchor, type, families)) {
    blockDirectReferenceFamily(family, blocker, anchor);
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
