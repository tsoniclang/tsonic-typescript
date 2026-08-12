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
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { PointerFlowBlocker } from "./flow-graph.js";
import {
  type MutableDirectReferenceFamily,
  requireCanonicalDirectReferenceFamily,
} from "./flow-family-state.js";
import { transparentExpression } from "./flow-syntax.js";
import { describePointerPointee } from "./pointee-classification.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export function applyGenericPointerBoundaries(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  ledger: PointerPlanningLedger,
): void {
  for (const [operationNode, family] of operationFamilies) {
    ledger.record("direct-family");
    const operation = source.sourceFacts.getFact(
      operationNode,
      pointerOperationFactKey,
    );
    if (operation === undefined) {
      continue;
    }
    for (const operand of pointerOperands(operation)) {
      ledger.record("direct-family");
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
          ledger,
        )
      ) {
        requireCanonicalDirectReferenceFamily(
          family,
          "generic-storage",
          operand,
        );
      }
    }
  }
  for (const node of program.nodesOfKind(KindCallExpression)) {
    ledger.record("direct-family");
    if (operationFamilies.has(node)) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const call = semantics.getResolvedCallInfo(node);
    if (call?.sourceSelectedSignatureKind !== "resolved") {
      continue;
    }
    for (const binding of call.sourceArgumentBindings) {
      ledger.record("direct-family");
      const parameter = call.sourceSelectedSignatureParameters[
        binding.sourceParameterIndex
      ];
      if (
        parameter?.authoredTypeNode === undefined ||
        !authoredTypeContainsRepresentationVaryingPointer(
          source,
          node,
          parameter.authoredTypeNode,
          ledger,
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
        ledger,
      );
      blockSelectedPointerFamilies(
        source,
        node,
        binding.selectedArgumentType,
        families,
        "generic-call",
        ledger,
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
        ledger,
      )
    ) {
      blockSelectedPointerFamilies(
        source,
        node,
        call.sourceResultType,
        families,
        "generic-call",
        ledger,
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
  ledger: PointerPlanningLedger,
): boolean {
  const semantics = source.semantics.forNode(anchor);
  for (const subject of semantics.getAuthoredTypeFactSubjects(authoredType)) {
    ledger.record("direct-family");
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
  ledger: PointerPlanningLedger,
): void {
  if (type === undefined) {
    return;
  }
  for (const family of selectedPointerFamilies(
    source,
    anchor,
    type,
    families,
    ledger,
  )) {
    ledger.record("direct-family");
    requireCanonicalDirectReferenceFamily(family, blocker, anchor);
  }
}

function selectedPointerFamilies(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  ledger: PointerPlanningLedger,
): ReadonlySet<MutableDirectReferenceFamily> {
  const result = new Set<MutableDirectReferenceFamily>();
  const seen = new Set<Type>();
  const pending: (Type | undefined)[] = [type];
  const semantics = source.semantics.forNode(anchor);
  while (pending.length > 0) {
    ledger.record("direct-family");
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (semantics.isUnion(current) || semantics.isIntersection(current)) {
      for (const member of semantics.getUnionOrIntersectionTypes(current)) {
        ledger.record("direct-family");
        if (member !== undefined) {
          pending.push(member);
        }
      }
      continue;
    }
    const arguments_ = semantics.getEffectiveTypeArguments(current);
    if (selectedTypeIsPointer(
      source,
      semantics.getTypeFactSubjects(current),
      ledger,
    )) {
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
    for (const signature of [
      ...semantics.getCallSignatures(current),
      ...semantics.getConstructSignatures(current),
    ]) {
      ledger.record("direct-family");
      if (signature === undefined) {
        continue;
      }
      pending.push(semantics.getReturnTypeOfSignature(signature));
      for (const parameter of semantics.getSignatureParameters(signature)) {
        ledger.record("direct-family");
        pending.push(semantics.getTypeOfSymbol(parameter));
      }
    }
  }
  return result;
}

function selectedTypeIsPointer(
  source: TargetSourceProgram,
  subjects: readonly ExtensionFactSubject[],
  ledger: PointerPlanningLedger,
): boolean {
  for (const subject of subjects) {
    ledger.record("direct-family");
    const marker = source.sourceFacts.getFact(subject, sourceMarkerFactKey);
    if (marker?.kind === "type-marker" && marker.marker === "pointer") {
      return true;
    }
  }
  return false;
}
