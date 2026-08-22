import type { Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import type { InterfaceContractRelevance } from "../relevance.js";
import type { OpaqueInterfaceExposureSink } from "./model.js";

const maximumOpaqueExposureTypeCount = 256;

export function sourceContainsRelevantContracts(
  semantics: SourceFileSemantics,
  root: Type,
  relevance: InterfaceContractRelevance,
  cache: Map<Type, boolean>,
): boolean {
  const cached = cache.get(root);
  if (cached !== undefined) {
    return cached;
  }
  if (
    relevance.contains(semantics, root) ||
    relevance.valueContracts(semantics, root).length !== 0
  ) {
    cache.set(root, true);
    return true;
  }
  const pending = [root];
  const seen = new Set<Type>();
  while (pending.length !== 0) {
    const type = pending.pop();
    if (type === undefined || seen.has(type)) {
      continue;
    }
    if (seen.size >= maximumOpaqueExposureTypeCount) {
      cache.set(root, true);
      return true;
    }
    seen.add(type);
    if (relevance.contains(semantics, type)) {
      cache.set(root, true);
      return true;
    }
    const selected = semantics.types.withoutMissingOrUndefined(type);
    if (selected === undefined || semantics.types.isNever(selected)) {
      continue;
    }
    if (semantics.types.isUnion(selected) || semantics.types.isIntersection(selected)) {
      appendTypes(pending, semantics.types.unionOrIntersectionTypes(selected));
      continue;
    }
    if (semantics.types.isTuple(selected)) {
      appendTypes(pending, semantics.types.tupleElementTypes(selected));
      continue;
    }
    if (semantics.types.isArrayLike(selected)) {
      if (semantics.types.isTypeReference(selected)) {
        appendTypes(pending, semantics.types.typeArguments(selected));
      }
      appendTypes(
        pending,
        semantics.types.indexInfos(selected).map((index) => index.valueType),
      );
      continue;
    }
    const signatures = [
      ...semantics.types.callSignatures(selected),
      ...semantics.types.constructSignatures(selected),
    ];
    if (signatures.length !== 0) {
      for (const signature of signatures) {
        appendTypes(
          pending,
          semantics.types.signatureParameterInfos(signature).map((parameter) =>
            parameter.type
          ),
        );
      }
      continue;
    }
    appendTypes(
      pending,
      semantics.types.propertyInfos(selected).map((property) => property.type),
    );
    appendTypes(
      pending,
      semantics.types.indexInfos(selected).map((index) => index.valueType),
    );
  }
  cache.set(root, false);
  return false;
}

export function markAllRelevantSourceContracts(
  semantics: SourceFileSemantics,
  root: Type,
  relevance: InterfaceContractRelevance,
  sink: OpaqueInterfaceExposureSink,
): void {
  const pending = [root];
  const seen = new Set<Type>();
  while (pending.length !== 0) {
    const type = pending.pop();
    if (type === undefined || seen.has(type)) {
      continue;
    }
    if (seen.size >= maximumOpaqueExposureTypeCount) {
      sink.markExposedContracts(semantics, root);
      sink.markExposedValueContracts(semantics, root);
      return;
    }
    seen.add(type);
    const selected = semantics.types.withoutMissingOrUndefined(type);
    if (selected === undefined || semantics.types.isNever(selected)) {
      continue;
    }
    sink.markExposedContracts(semantics, selected);
    sink.markExposedValueContracts(semantics, selected);
    if (semantics.types.isUnion(selected) || semantics.types.isIntersection(selected)) {
      appendTypes(pending, semantics.types.unionOrIntersectionTypes(selected));
      continue;
    }
    if (semantics.types.isTuple(selected)) {
      appendTypes(pending, semantics.types.tupleElementTypes(selected));
      continue;
    }
    for (const signature of [
      ...semantics.types.callSignatures(selected),
      ...semantics.types.constructSignatures(selected),
    ]) {
      appendTypes(
        pending,
        semantics.types.signatureParameterInfos(signature).map((parameter) =>
          parameter.type
        ),
      );
      appendTypes(pending, [semantics.types.returnType(signature)]);
    }
    if (semantics.types.isArrayLike(selected)) {
      if (semantics.types.isTypeReference(selected)) {
        appendTypes(pending, semantics.types.typeArguments(selected));
      }
      appendTypes(
        pending,
        semantics.types.indexInfos(selected).map((index) => index.valueType),
      );
      continue;
    }
    appendTypes(
      pending,
      semantics.types.propertyInfos(selected).map((property) => property.type),
    );
    appendTypes(
      pending,
      semantics.types.indexInfos(selected).map((index) => index.valueType),
    );
  }
}

function appendTypes(
  pending: Type[],
  types: readonly (Type | undefined)[],
): void {
  for (const type of types) {
    if (type !== undefined) {
      pending.push(type);
    }
  }
}
