import {
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  PointerOperationFact,
  Type,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { PointerFlowBlocker } from "./flow-graph.js";
import {
  blockDirectReferenceFamily,
  type MutableDirectReferenceFamily,
  requireCanonicalDirectReferenceFamily,
} from "./flow-family-state.js";
import { transparentExpression } from "./flow-syntax.js";
import { describePointerPointee } from "./pointee-classification.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export function applyGenericPointerBoundaries(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  facts: PointerTypedFactLedger,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  representationTransportCalls: ReadonlyMap<Node, ReadonlySet<Node>>,
  ledger: PointerPlanningLedger,
): void {
  for (const [operationNode, family] of operationFamilies) {
    ledger.record("direct-family");
    const operation = facts.operationFor(operationNode);
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
          facts,
          ledger,
        )
      ) {
        requireCanonicalDirectReferenceFamily(
          family,
          "generic-storage",
          operand,
          operationNode,
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
    const call = semantics.operations.call(node);
    if (call?.sourceSelectedSignatureKind !== "resolved") {
      continue;
    }
    const transportedFamilies = selectedTransportFamilies(
      source,
      node,
      call,
      representationTransportCalls.get(node),
      families,
      ledger,
    );
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
          facts,
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
        transportedFamilies,
        "generic-call",
        ledger,
      );
      blockSelectedPointerFamilies(
        source,
        node,
        binding.selectedArgumentType,
        families,
        transportedFamilies,
        "generic-call",
        ledger,
      );
    }
    const selectedDeclaration = semantics.declarations.signatureDeclaration(
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
        facts,
        ledger,
      )
    ) {
      blockSelectedPointerFamilies(
        source,
        node,
        call.sourceResultType,
        families,
        transportedFamilies,
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
  facts: PointerTypedFactLedger,
  ledger: PointerPlanningLedger,
): boolean {
  const semantics = source.semantics.forNode(anchor);
  for (const subject of semantics.facts.authoredTypeSubjects(authoredType)) {
    ledger.record("direct-family");
    const fact = facts.pointerFactFor(subject);
    if (fact === undefined) {
      continue;
    }
    const pointee = semantics.types.authoredType(fact.pointee);
    if (
      pointee !== undefined &&
      semantics.types.couldContainTypeVariables(pointee) &&
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
  excluded: ReadonlySet<MutableDirectReferenceFamily>,
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
    if (excluded.has(family)) {
      continue;
    }
    blockDirectReferenceFamily(family, blocker, anchor);
  }
}

function selectedTransportFamilies(
  source: TargetSourceProgram,
  anchor: Node,
  call: {
    readonly sourceArgumentBindings: readonly {
      readonly sourceParameterIndex: number;
      readonly selectedParameterType?: Type;
      readonly selectedArgumentType?: Type;
    }[];
    readonly sourceSelectedSignatureParameters: readonly {
      readonly parameterDeclaration?: Node;
    }[];
  },
  transportedParameters: ReadonlySet<Node> | undefined,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  ledger: PointerPlanningLedger,
): ReadonlySet<MutableDirectReferenceFamily> {
  const result = new Set<MutableDirectReferenceFamily>();
  if (transportedParameters === undefined) {
    return result;
  }
  for (const binding of call.sourceArgumentBindings) {
    ledger.record("direct-family");
    const parameter = call.sourceSelectedSignatureParameters[
      binding.sourceParameterIndex
    ];
    if (
      parameter?.parameterDeclaration === undefined ||
      !transportedParameters.has(parameter.parameterDeclaration)
    ) {
      continue;
    }
    for (const type of [binding.selectedParameterType, binding.selectedArgumentType]) {
      const family = directSelectedPointerFamily(
        source,
        anchor,
        type,
        families,
        ledger,
      );
      if (family !== undefined) {
        result.add(family);
      }
    }
  }
  return result;
}

function directSelectedPointerFamily(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type | undefined,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  ledger: PointerPlanningLedger,
): MutableDirectReferenceFamily | undefined {
  if (type === undefined) {
    return undefined;
  }
  const semantics = source.semantics.forNode(anchor);
  let selected = type;
  if (semantics.types.isUnion(selected)) {
    const nonNullish = semantics.types.unionOrIntersectionTypes(selected)
      .filter((candidate) => !semantics.types.isNullish(candidate));
    if (nonNullish.length !== 1 || nonNullish[0] === undefined) {
      return undefined;
    }
    selected = nonNullish[0];
  }
  ledger.record("direct-family");
  if (
    semantics.types.isIntersection(selected) ||
    !selectedTypeIsPointer(
      source,
      semantics.facts.typeSubjects(selected),
      ledger,
    )
  ) {
    return undefined;
  }
  const arguments_ = semantics.types.effectiveTypeArguments(selected);
  const pointee = arguments_?.length === 1 ? arguments_[0] : undefined;
  const description = pointee === undefined
    ? undefined
    : describePointerPointee(source, anchor, pointee);
  return description?.category === "direct-reference" &&
      typeof description.identity !== "string"
    ? families.get(description.identity)
    : undefined;
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
    if (semantics.types.isUnion(current) || semantics.types.isIntersection(current)) {
      for (const member of semantics.types.unionOrIntersectionTypes(current)) {
        ledger.record("direct-family");
        if (member !== undefined) {
          pending.push(member);
        }
      }
      continue;
    }
    const arguments_ = semantics.types.effectiveTypeArguments(current);
    if (selectedTypeIsPointer(
      source,
      semantics.facts.typeSubjects(current),
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
      ...semantics.types.callSignatures(current),
      ...semantics.types.constructSignatures(current),
    ]) {
      ledger.record("direct-family");
      if (signature === undefined) {
        continue;
      }
      pending.push(semantics.types.returnType(signature));
      for (const parameter of semantics.declarations.signatureParameters(signature)) {
        ledger.record("direct-family");
        pending.push(semantics.types.typeOfSymbol(parameter));
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
