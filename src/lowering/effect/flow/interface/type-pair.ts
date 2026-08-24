import type { Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import {
  interfaceContractTypeDeclaration,
  isInterfaceContractDeclaration,
} from "./declarations.js";
import { pairObjectMembers } from "./type-pair/members.js";
import {
  pairSequenceTypes,
  pairTargetIntersection,
  pairTypeArguments,
  pairUnionTypes,
} from "./type-pair/shape.js";
import { pairCallableTypes } from "./type-pair/signatures.js";
import {
  interfaceContractTypePairWasSeen,
  type InterfaceContractTypePairState,
} from "./type-pair/state.js";

export type {
  InterfaceContractPendingTypePair,
  InterfaceContractTypePairState,
} from "./type-pair/state.js";
export {
  interfaceContractTypePairWasSeen,
  markInterfaceContractsExposed,
  markInterfaceValueContractsExposed,
} from "./type-pair/state.js";

export function enqueueInterfaceContractTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
): void {
  const selectedSource = semantics.types.withoutMissingOrUndefined(source);
  const selectedTarget = semantics.types.withoutMissingOrUndefined(target);
  if (
    selectedSource === undefined ||
    selectedTarget === undefined ||
    semantics.types.isNever(selectedSource) ||
    semantics.types.isNever(selectedTarget) ||
    selectedSource === selectedTarget
  ) {
    return;
  }
  const sourceValues = state.relevance.valueContracts(
    semantics,
    selectedSource,
  );
  const targetValues = state.relevance.valueContracts(
    semantics,
    selectedTarget,
  );
  if (
    (sourceValues.length === 0 && targetValues.length === 0) ||
    interfaceContractTypePairWasSeen(
      selectedSource,
      selectedTarget,
      state.seen,
    )
  ) {
    return;
  }
  state.pending.push({
    semantics,
    source: selectedSource,
    target: selectedTarget,
  });
}

export function drainInterfaceContractTypePairs(
  state: InterfaceContractTypePairState,
): void {
  while (state.pending.length !== 0) {
    const pair = state.pending.pop();
    if (pair !== undefined) {
      analyzeTypePair(pair.semantics, pair.source, pair.target, state);
    }
  }
}

function analyzeTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
): void {
  if (
    pairUnionTypes(
      semantics,
      source,
      target,
      state,
      enqueueInterfaceContractTypePair,
    )
  ) {
    return;
  }
  if (
    pairTargetIntersection(
      semantics,
      source,
      target,
      state,
      enqueueInterfaceContractTypePair,
    )
  ) {
    return;
  }
  const sourceDeclaration = interfaceContractTypeDeclaration(
    semantics,
    source,
  );
  const targetDeclaration = interfaceContractTypeDeclaration(
    semantics,
    target,
  );
  if (
    sourceDeclaration !== undefined &&
    targetDeclaration !== undefined &&
    sourceDeclaration === targetDeclaration
  ) {
    if (
      semantics.types.isTypeReference(source) &&
      semantics.types.isTypeReference(target) &&
      semantics.types.typeReferenceTarget(source) !== undefined &&
      semantics.types.typeReferenceTarget(target) !== undefined
    ) {
      pairTypeArguments(
        semantics,
        source,
        target,
        state,
        enqueueInterfaceContractTypePair,
      );
    }
    pairCallableTypes(
      semantics,
      source,
      target,
      state,
      enqueueInterfaceContractTypePair,
    );
    pairSequenceTypes(
      semantics,
      source,
      target,
      state,
      enqueueInterfaceContractTypePair,
    );
    pairObjectMembers(
      semantics,
      source,
      target,
      sourceDeclaration,
      targetDeclaration,
      state,
      enqueueInterfaceContractTypePair,
    );
    return;
  }
  if (
    isInterfaceContractDeclaration(state.source, sourceDeclaration) ||
    isInterfaceContractDeclaration(state.source, targetDeclaration)
  ) {
    pairObjectMembers(
      semantics,
      source,
      target,
      sourceDeclaration,
      targetDeclaration,
      state,
      enqueueInterfaceContractTypePair,
    );
    return;
  }
  if (
    pairCallableTypes(
      semantics,
      source,
      target,
      state,
      enqueueInterfaceContractTypePair,
    ) ||
    pairSequenceTypes(
      semantics,
      source,
      target,
      state,
      enqueueInterfaceContractTypePair,
    )
  ) {
    return;
  }
  if (
    semantics.types.isTypeReference(source) &&
    semantics.types.isTypeReference(target)
  ) {
    const sourceTarget = semantics.types.typeReferenceTarget(source);
    if (
      sourceTarget !== undefined &&
      sourceTarget === semantics.types.typeReferenceTarget(target)
    ) {
      pairTypeArguments(
        semantics,
        source,
        target,
        state,
        enqueueInterfaceContractTypePair,
      );
      pairCallableTypes(
        semantics,
        source,
        target,
        state,
        enqueueInterfaceContractTypePair,
      );
      pairSequenceTypes(
        semantics,
        source,
        target,
        state,
        enqueueInterfaceContractTypePair,
      );
      pairObjectMembers(
        semantics,
        source,
        target,
        sourceDeclaration,
        targetDeclaration,
        state,
        enqueueInterfaceContractTypePair,
      );
      return;
    }
  }
  pairObjectMembers(
    semantics,
    source,
    target,
    sourceDeclaration,
    targetDeclaration,
    state,
    enqueueInterfaceContractTypePair,
  );
}
