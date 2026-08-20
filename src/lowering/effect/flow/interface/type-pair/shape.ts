import type { Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

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
  if (semantics.isUnion(source)) {
    for (const member of selectedMembers(semantics, source)) {
      pairSourceToTargetUnion(semantics, member, target, state, enqueue);
    }
    return true;
  }
  if (!semantics.isUnion(target)) {
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
  if (!semantics.isIntersection(target)) {
    return false;
  }
  const members = selectedMembers(semantics, target);
  if (members.length === 0) {
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
  const sourceTuple = semantics.isTuple(source);
  const targetTuple = semantics.isTuple(target);
  const sourceArray = sourceTuple || semantics.isArrayLike(source);
  const targetArray = targetTuple || semantics.isArrayLike(target);
  if (!sourceArray && !targetArray) {
    return false;
  }
  if (!sourceArray || !targetArray) {
    markNestedTypeMismatch(semantics, source, target, state);
    return true;
  }
  if (sourceTuple && targetTuple) {
    const sources = semantics.getTupleElementInfos(source);
    const targets = semantics.getTupleElementInfos(target);
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
    for (const sourceElement of semantics.getTupleElementTypes(source)) {
      if (sourceElement !== undefined) {
        enqueue(semantics, sourceElement, targetElement, state);
      }
    }
    return true;
  }
  if (targetTuple) {
    const sourceElement = arrayElementType(semantics, source);
    if (sourceElement === undefined) {
      markNestedTypeMismatch(semantics, source, target, state);
      return true;
    }
    for (const targetElement of semantics.getTupleElementTypes(target)) {
      if (targetElement !== undefined) {
        enqueue(semantics, sourceElement, targetElement, state);
      }
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
  pairTypeLists(
    semantics,
    semantics.getTypeArguments(source),
    semantics.getTypeArguments(target),
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
  if (!semantics.isUnion(target)) {
    enqueue(semantics, source, target, state);
    return;
  }
  const targets = selectedMembers(semantics, target);
  const exact = targets.filter((member) =>
    sameSelectedType(semantics, source, member)
  );
  if (exact.length === 1) {
    enqueue(semantics, source, exact[0]!, state);
    return;
  }
  const relevant = targets.filter((member) =>
    state.relevance.valueContracts(semantics, member).length !== 0
  );
  if (relevant.length === 1) {
    enqueue(semantics, source, relevant[0]!, state);
    return;
  }
  markNestedTypeMismatch(semantics, source, target, state);
}

function pairTypeLists(
  semantics: SourceFileSemantics,
  sources: readonly (Type | undefined)[],
  targets: readonly (Type | undefined)[],
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  if (sources.length !== targets.length) {
    for (const type of [...sources, ...targets]) {
      if (type !== undefined) {
        markInterfaceContractsExposed(
          semantics,
          type,
          state,
          "incompatible-type-arguments",
        );
      }
    }
    return;
  }
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const target = targets[index];
    if (source !== undefined && target !== undefined) {
      enqueue(semantics, source, target, state);
    }
  }
}

function arrayElementType(
  semantics: SourceFileSemantics,
  type: Type,
): Type | undefined {
  if (!semantics.isArrayLike(type)) {
    return undefined;
  }
  const arguments_ = semantics.isTypeReference(type)
    ? semantics.getTypeArguments(type).filter(
      (argument): argument is Type => argument !== undefined,
    )
    : [];
  if (arguments_.length === 1) {
    return arguments_[0];
  }
  const values = semantics.getIndexInfos(type).map((index) => index.valueType)
    .filter((value): value is Type => value !== undefined);
  return values.length === 1 ? values[0] : undefined;
}

function selectedMembers(
  semantics: SourceFileSemantics,
  type: Type,
): readonly Type[] {
  return semantics.getUnionOrIntersectionTypes(type).filter(
    (member): member is Type => member !== undefined,
  );
}
