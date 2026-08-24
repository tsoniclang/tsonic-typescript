import type { Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import { sameSelectedType } from "../../../model/synchronous.js";
import {
  type InterfaceContractTypePairEnqueue,
  type InterfaceContractTypePairState,
  markInterfaceContractsExposed,
  markNestedTypeMismatch,
} from "./state.js";

export function pairUnionTypes(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): boolean {
  if (semantics.types.isUnion(source)) {
    const members = selectedMembers(semantics, source);
    if (members === undefined || members.length === 0) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    for (const member of members) {
      pairSourceToTargetUnion(semantics, member, target, state, enqueue);
    }
    return true;
  }
  if (!semantics.types.isUnion(target)) {
    return false;
  }
  pairSourceToTargetUnion(semantics, source, target, state, enqueue);
  return true;
}

export function pairTargetIntersection(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): boolean {
  if (!semantics.types.isIntersection(target)) {
    return false;
  }
  const members = selectedMembers(semantics, target);
  if (members === undefined || members.length === 0) {
    markNestedTypeMismatch(semantics, source, target, state);
    return true;
  }
  for (const member of members) {
    enqueue(semantics, source, member, state);
  }
  return true;
}

export function pairSequenceTypes(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): boolean {
  const sourceTuple = semantics.types.isTuple(source);
  const targetTuple = semantics.types.isTuple(target);
  const sourceArray = sourceTuple || semantics.types.isArrayLike(source);
  const targetArray = targetTuple || semantics.types.isArrayLike(target);
  if (!sourceArray && !targetArray) {
    return false;
  }
  if (!sourceArray || !targetArray) {
    markNestedTypeMismatch(semantics, source, target, state);
    return true;
  }
  if (sourceTuple && targetTuple) {
    const sources = semantics.types.tupleElementInfos(source);
    const targets = semantics.types.tupleElementInfos(target);
    if (
      sources.length !== targets.length ||
      sources.some((entry, index) =>
        entry.elementKind !== targets[index]?.elementKind
      )
    ) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    for (let index = 0; index < sources.length; index += 1) {
      enqueue(
        semantics,
        sources[index]!.type,
        targets[index]!.type,
        state,
      );
    }
    return true;
  }
  if (sourceTuple) {
    const targetElement = arrayElementType(semantics, target);
    if (targetElement === undefined) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    const sourceElements = semantics.types.tupleElementTypes(source);
    if (sourceElements.some((element) => element === undefined)) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    for (const sourceElement of sourceElements) {
      enqueue(semantics, sourceElement!, targetElement, state);
    }
    return true;
  }
  if (targetTuple) {
    const sourceElement = arrayElementType(semantics, source);
    if (sourceElement === undefined) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    const targetElements = semantics.types.tupleElementTypes(target);
    if (targetElements.some((element) => element === undefined)) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    for (const targetElement of targetElements) {
      enqueue(semantics, sourceElement, targetElement!, state);
    }
    return true;
  }
  const sourceElement = arrayElementType(semantics, source);
  const targetElement = arrayElementType(semantics, target);
  if (sourceElement === undefined || targetElement === undefined) {
    markNestedTypeMismatch(semantics, source, target, state);
  } else {
    enqueue(semantics, sourceElement, targetElement, state);
  }
  return true;
}

export function pairTypeArguments(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  const sources = semantics.types.effectiveTypeArguments(source);
  const targets = semantics.types.effectiveTypeArguments(target);
  if (sources === undefined || targets === undefined) {
    markInterfaceContractsExposed(
      semantics,
      source,
      state,
      "incompatible-type-arguments",
    );
    markInterfaceContractsExposed(
      semantics,
      target,
      state,
      "incompatible-type-arguments",
    );
    return;
  }
  pairTypeLists(
    semantics,
    sources,
    targets,
    state,
    enqueue,
  );
}

function pairSourceToTargetUnion(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  if (!semantics.types.isUnion(target)) {
    enqueue(semantics, source, target, state);
    return;
  }
  const targets = selectedMembers(semantics, target);
  if (targets === undefined || targets.length === 0) {
    markNestedTypeMismatch(semantics, source, target, state);
    return;
  }
  const exact = targets.filter((member) =>
    sameSelectedType(semantics, source, member)
  );
  if (exact.length === 1) {
    enqueue(semantics, source, exact[0]!, state);
    return;
  }
  const sameDeclaration = targets.filter((member) =>
    sameTypeReferenceDeclaration(semantics, source, member)
  );
  if (sameDeclaration.length === 1) {
    enqueue(semantics, source, sameDeclaration[0]!, state);
    return;
  }
  const related = targets.filter((member) =>
    semantics.types.relationship(source, member) !== "unrelated"
  );
  if (related.length !== 0) {
    for (const member of related) {
      enqueue(semantics, source, member, state);
    }
    return;
  }
  const relevant = targets.filter((member) =>
    state.relevance.valueContracts(semantics, member).length !== 0
  );
  if (relevant.length !== 0) {
    for (const member of relevant) {
      enqueue(semantics, source, member, state);
    }
    return;
  }
  markNestedTypeMismatch(semantics, source, target, state);
}

function sameTypeReferenceDeclaration(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
): boolean {
  if (
    !semantics.types.isTypeReference(source) ||
    !semantics.types.isTypeReference(target)
  ) {
    return false;
  }
  const sourceTarget = semantics.types.typeReferenceTarget(source);
  return sourceTarget !== undefined &&
    sourceTarget === semantics.types.typeReferenceTarget(target);
}

function pairTypeLists(
  semantics: SourceFileSemantics,
  sources: readonly Type[],
  targets: readonly Type[],
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  if (sources.length !== targets.length) {
    for (const type of [...sources, ...targets]) {
      markInterfaceContractsExposed(
        semantics,
        type,
        state,
        "incompatible-type-arguments",
      );
    }
    return;
  }
  for (let index = 0; index < sources.length; index += 1) {
    enqueue(semantics, sources[index]!, targets[index]!, state);
  }
}

function arrayElementType(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  if (!semantics.types.isArrayLike(type)) {
    return undefined;
  }
  const arguments_ = semantics.types.isTypeReference(type)
    ? semantics.types.effectiveTypeArguments(type)
    : [];
  if (arguments_ === undefined) {
    return undefined;
  }
  if (arguments_.length === 1) {
    return arguments_[0];
  }
  const indexes = semantics.types.indexInfos(type);
  return indexes.length === 1 && indexes[0]?.valueType !== undefined
    ? indexes[0].valueType
    : undefined;
}

function selectedMembers(
  semantics: SourceFileSemantics,
  type: Type,
): readonly Type[] | undefined {
  const members = semantics.types.unionOrIntersectionTypes(type);
  return members.length !== 0 && members.every((member) => member !== undefined)
    ? members as readonly Type[]
    : undefined;
}
