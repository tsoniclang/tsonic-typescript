import type { Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

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
    const selected = semantics.removeMissingOrUndefined(type);
    if (selected === undefined || semantics.isNever(selected)) {
      continue;
    }
    if (semantics.isUnion(selected) || semantics.isIntersection(selected)) {
      appendTypes(pending, semantics.getUnionOrIntersectionTypes(selected));
      continue;
    }
    if (semantics.isTuple(selected)) {
      appendTypes(pending, semantics.getTupleElementTypes(selected));
      continue;
    }
    if (semantics.isArrayLike(selected)) {
      if (semantics.isTypeReference(selected)) {
        appendTypes(pending, semantics.getTypeArguments(selected));
      }
      appendTypes(
        pending,
        semantics.getIndexInfos(selected).map((index) => index.valueType),
      );
      continue;
    }
    const signatures = [
      ...semantics.getCallSignatures(selected),
      ...semantics.getConstructSignatures(selected),
    ];
    if (signatures.length !== 0) {
      for (const signature of signatures) {
        appendTypes(
          pending,
          semantics.getSignatureParameterInfos(signature).map((parameter) =>
            parameter.type
          ),
        );
      }
      continue;
    }
    appendTypes(
      pending,
      semantics.getPropertyInfos(selected).map((property) => property.type),
    );
    appendTypes(
      pending,
      semantics.getIndexInfos(selected).map((index) => index.valueType),
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
      sink.markAllProjectContracts();
      return;
    }
    seen.add(type);
    const selected = semantics.removeMissingOrUndefined(type);
    if (selected === undefined || semantics.isNever(selected)) {
      continue;
    }
    sink.markExposedContracts(semantics, selected);
    sink.markExposedValueContracts(semantics, selected);
    if (semantics.isUnion(selected) || semantics.isIntersection(selected)) {
      appendTypes(pending, semantics.getUnionOrIntersectionTypes(selected));
      continue;
    }
    if (semantics.isTuple(selected)) {
      appendTypes(pending, semantics.getTupleElementTypes(selected));
      continue;
    }
    for (const signature of [
      ...semantics.getCallSignatures(selected),
      ...semantics.getConstructSignatures(selected),
    ]) {
      appendTypes(
        pending,
        semantics.getSignatureParameterInfos(signature).map((parameter) =>
          parameter.type
        ),
      );
      appendTypes(pending, [semantics.getReturnTypeOfSignature(signature)]);
    }
    if (semantics.isArrayLike(selected)) {
      if (semantics.isTypeReference(selected)) {
        appendTypes(pending, semantics.getTypeArguments(selected));
      }
      appendTypes(
        pending,
        semantics.getIndexInfos(selected).map((index) => index.valueType),
      );
      continue;
    }
    appendTypes(
      pending,
      semantics.getPropertyInfos(selected).map((property) => property.type),
    );
    appendTypes(
      pending,
      semantics.getIndexInfos(selected).map((index) => index.valueType),
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
