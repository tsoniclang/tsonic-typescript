import type { Node, Signature, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import { sameSelectedType } from "../../model/synchronous.js";
import { exactSourceCallableImplementation } from "../../model/exact-source-invocation.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../model/source-membership.js";
import {
  indexCoversProperty,
  indexDomainCovers,
} from "./index-domain.js";
import type { InterfaceContractRelevance } from "./relevance.js";
import type { OpaqueInterfaceExposureSink } from "./opaque-exposure/model.js";
import {
  markAllRelevantSourceContracts,
  sourceContainsRelevantContracts,
} from "./opaque-exposure/relevance.js";
import { exactUniqueSignaturePairs } from "./type-pair/signatures.js";

export type { OpaqueInterfaceExposureSink } from "./opaque-exposure/model.js";

interface OpaqueInterfaceExposureState {
  readonly source: TargetSourceProgram;
  readonly relevance: InterfaceContractRelevance;
  readonly sink: OpaqueInterfaceExposureSink;
  readonly freshSeen: Map<Type, Set<Type>>;
  readonly sharedSeen: Map<Type, Set<Type>>;
  readonly relevanceCache: Map<Type, boolean>;
  readonly bodyInspectionIsCertified?: ExactSourceBodyInspection;
}

export function analyzeOpaqueInterfaceInputs(
  sourceProgram: TargetSourceProgram,
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  relevance: InterfaceContractRelevance,
  relevanceCache: Map<Type, boolean>,
  sink: OpaqueInterfaceExposureSink,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): void {
  analyzeOpaquePair(
    semantics,
    source,
    target,
    sourceIsFresh,
    {
      source: sourceProgram,
      relevance,
      sink,
      freshSeen: new Map(),
      sharedSeen: new Map(),
      relevanceCache,
      ...(bodyInspectionIsCertified === undefined
        ? {}
        : { bodyInspectionIsCertified }),
    },
  );
}

function analyzeOpaquePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  state: OpaqueInterfaceExposureState,
): void {
  const selectedSource = semantics.types.withoutMissingOrUndefined(source);
  const selectedTarget = semantics.types.withoutMissingOrUndefined(target);
  if (
    selectedSource === undefined ||
    selectedTarget === undefined ||
    semantics.types.isNever(selectedSource) ||
    semantics.types.isNever(selectedTarget) ||
    !sourceContainsRelevantContracts(
      semantics,
      selectedSource,
      state.relevance,
      state.relevanceCache,
    ) ||
    pairWasSeen(
      selectedSource,
      selectedTarget,
      sourceIsFresh ? state.freshSeen : state.sharedSeen,
    )
  ) {
    return;
  }
  if (
    semantics.types.isAny(selectedTarget) ||
    semantics.types.isUnknown(selectedTarget)
  ) {
    markAllRelevantSourceContracts(
      semantics,
      selectedSource,
      state.relevance,
      state.sink,
    );
    return;
  }
  if (
    pairOpaqueUnion(
      semantics,
      selectedSource,
      selectedTarget,
      sourceIsFresh,
      state,
    )
  ) {
    return;
  }
  retainCallableInputs(
    semantics,
    selectedSource,
    selectedTarget,
    state,
  );
  if (
    pairOpaqueSequences(
      semantics,
      selectedSource,
      selectedTarget,
      sourceIsFresh,
      state,
    )
  ) {
    return;
  }
  pairOpaqueMembers(
    semantics,
    selectedSource,
    selectedTarget,
    sourceIsFresh,
    state,
  );
}

function pairOpaqueUnion(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  state: OpaqueInterfaceExposureState,
): boolean {
  if (semantics.types.isUnion(source)) {
    const members = selectedMembers(semantics, source);
    if (members === undefined) {
      markAllRelevantSourceContracts(
        semantics,
        source,
        state.relevance,
        state.sink,
      );
      return true;
    }
    for (const member of members) {
      pairOpaqueUnionMember(
        semantics,
        member,
        target,
        sourceIsFresh,
        state,
      );
    }
    return true;
  }
  if (!semantics.types.isUnion(target)) {
    return false;
  }
  pairOpaqueUnionMember(
    semantics,
    source,
    target,
    sourceIsFresh,
    state,
  );
  return true;
}

function pairOpaqueUnionMember(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  state: OpaqueInterfaceExposureState,
): void {
  if (!semantics.types.isUnion(target)) {
    analyzeOpaquePair(semantics, source, target, sourceIsFresh, state);
    return;
  }
  const targets = selectedMembers(semantics, target);
  const exact = targets?.filter((member) =>
    sameSelectedType(semantics, source, member)
  ) ?? [];
  if (targets === undefined || exact.length !== 1) {
    markAllRelevantSourceContracts(
      semantics,
      source,
      state.relevance,
      state.sink,
    );
    return;
  }
  analyzeOpaquePair(semantics, source, exact[0]!, sourceIsFresh, state);
}

function retainCallableInputs(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: OpaqueInterfaceExposureState,
): void {
  retainSignatureInputs(
    semantics,
    source,
    semantics.types.callSignatures(source),
    semantics.types.callSignatures(target),
    state,
  );
  retainSignatureInputs(
    semantics,
    source,
    semantics.types.constructSignatures(source),
    semantics.types.constructSignatures(target),
    state,
  );
}

function retainSignatureInputs(
  semantics: SourceFileSemantics,
  sourceType: Type,
  sources: readonly (Signature | undefined)[],
  targets: readonly (Signature | undefined)[],
  state: OpaqueInterfaceExposureState,
): void {
  if (targets.length === 0) {
    return;
  }
  const pairs = exactUniqueSignaturePairs(
    semantics,
    sources,
    targets,
    state.relevance,
  );
  if (pairs === undefined) {
    if (sources.length === 0) {
      markAllRelevantSourceContracts(
        semantics,
        sourceType,
        state.relevance,
        state.sink,
      );
    }
    for (const signature of sources) {
      if (signature !== undefined) {
        markSignatureParameters(semantics, signature, state);
      }
    }
    return;
  }
  for (const [source] of pairs) {
    retainSignaturePairInputs(semantics, source, state);
  }
}

function retainSignaturePairInputs(
  semantics: SourceFileSemantics,
  source: Signature,
  state: OpaqueInterfaceExposureState,
): void {
  const sourceParameters = semantics.types.signatureParameterInfos(source);
  const implementation = exactSourceCallableImplementation(
    state.source,
    semantics.declarations.signatureDeclaration(source),
    state.bodyInspectionIsCertified,
  );
  if (implementation !== undefined) {
    const declarations = sourceParameters.map((parameter) =>
      parameter.declaration
    );
    if (
      declarations.every((declaration): declaration is Node =>
        declaration !== undefined &&
        state.source.ast.is.IsParameterDeclaration(declaration) &&
        sourceBodyInspectionIsExact(
          state.source,
          declaration,
          state.bodyInspectionIsCertified,
        ) &&
        state.source.ast.parent(declaration) === implementation
      )
    ) {
      for (const declaration of declarations) {
        state.sink.markOpaqueInput(declaration);
      }
      return;
    }
  }
  for (const parameter of sourceParameters) {
    markAllRelevantSourceContracts(
      semantics,
      parameter.type,
      state.relevance,
      state.sink,
    );
  }
}

function markSignatureParameters(
  semantics: SourceFileSemantics,
  signature: Signature,
  state: OpaqueInterfaceExposureState,
): void {
  for (const parameter of semantics.types.signatureParameterInfos(signature)) {
    markAllRelevantSourceContracts(
      semantics,
      parameter.type,
      state.relevance,
      state.sink,
    );
  }
}

function pairOpaqueSequences(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  state: OpaqueInterfaceExposureState,
): boolean {
  const sourceSequence = sequenceElements(semantics, source);
  const targetSequence = sequenceElements(semantics, target);
  if (sourceSequence === undefined && targetSequence === undefined) {
    return false;
  }
  if (sourceSequence === undefined || targetSequence === undefined) {
    markAllRelevantSourceContracts(
      semantics,
      source,
      state.relevance,
      state.sink,
    );
    return true;
  }
  const pairs = pairSequenceElements(sourceSequence, targetSequence);
  if (pairs === undefined) {
    markAllRelevantSourceContracts(
      semantics,
      source,
      state.relevance,
      state.sink,
    );
    return true;
  }
  const writable = !sourceIsFresh && sequenceIsWritable(semantics, target);
  for (const [sourceElement, targetElement] of pairs) {
    if (writable) {
      markAllRelevantSourceContracts(
        semantics,
        sourceElement,
        state.relevance,
        state.sink,
      );
    }
    analyzeOpaquePair(
      semantics,
      sourceElement,
      targetElement,
      false,
      state,
    );
  }
  return true;
}

function sequenceElements(
  semantics: SourceFileSemantics,
  type: Type,
): readonly Type[] | undefined {
  if (semantics.types.isTuple(type)) {
    return semantics.types.tupleElementInfos(type).map((element) => element.type);
  }
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
    return arguments_;
  }
  const indexes = semantics.types.indexInfos(type);
  return indexes.length === 1 && indexes[0]?.valueType !== undefined
    ? Object.freeze([indexes[0].valueType])
    : undefined;
}

function pairSequenceElements(
  sources: readonly Type[],
  targets: readonly Type[],
): readonly (readonly [Type, Type])[] | undefined {
  if (sources.length === targets.length) {
    return sources.map((source, index) => [source, targets[index]!] as const);
  }
  if (sources.length === 1) {
    return targets.map((target) => [sources[0]!, target] as const);
  }
  if (targets.length === 1) {
    return sources.map((source) => [source, targets[0]!] as const);
  }
  return undefined;
}

function sequenceIsWritable(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  const indexes = semantics.types.indexInfos(type);
  return indexes.length === 0 || indexes.some((index) => !index.readonly);
}

function pairOpaqueMembers(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  state: OpaqueInterfaceExposureState,
): void {
  const sources = new Map(
    semantics.types.propertyInfos(source).map((property) => [
      property.name,
      property,
    ]),
  );
  for (const targetProperty of semantics.types.propertyInfos(target)) {
    const sourceProperty = sources.get(targetProperty.name);
    const sourceProviders = sourceProperty === undefined
      ? semantics.types.indexInfos(source).filter((index) =>
        index.valueType !== undefined &&
        indexCoversProperty(
          state.source,
          semantics,
          index,
          targetProperty,
        )
      ).map((index) => index.valueType!)
      : [sourceProperty.type];
    for (const sourceProvider of sourceProviders) {
      if (!sourceIsFresh && !targetProperty.readonly) {
        markAllRelevantSourceContracts(
          semantics,
          sourceProvider,
          state.relevance,
          state.sink,
        );
      }
      analyzeOpaquePair(
        semantics,
        sourceProvider,
        targetProperty.type,
        false,
        state,
      );
    }
  }
  const sourceIndexes = semantics.types.indexInfos(source);
  const sourceProperties = [...sources.values()];
  for (const targetIndex of semantics.types.indexInfos(target)) {
    if (targetIndex.keyType === undefined || targetIndex.valueType === undefined) {
      markAllRelevantSourceContracts(
        semantics,
        source,
        state.relevance,
        state.sink,
      );
      continue;
    }
    const indexProviders = sourceIndexes.filter((sourceIndex) =>
      sourceIndex.keyType !== undefined &&
      sourceIndex.valueType !== undefined &&
      indexDomainCovers(
        semantics,
        sourceIndex.keyType,
        targetIndex.keyType!,
      )
    ).map((sourceIndex) => sourceIndex.valueType!);
    const propertyProviders = sourceProperties.filter((property) =>
      indexCoversProperty(
        state.source,
        semantics,
        targetIndex,
        property,
      )
    ).map((property) => property.type);
    for (const sourceProvider of [...indexProviders, ...propertyProviders]) {
      if (!sourceIsFresh && !targetIndex.readonly) {
        markAllRelevantSourceContracts(
          semantics,
          sourceProvider,
          state.relevance,
          state.sink,
        );
      }
      analyzeOpaquePair(
        semantics,
        sourceProvider,
        targetIndex.valueType,
        false,
        state,
      );
    }
  }
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

function pairWasSeen(
  source: Type,
  target: Type,
  seen: Map<Type, Set<Type>>,
): boolean {
  const targets = seen.get(source);
  if (targets?.has(target) === true) {
    return true;
  }
  if (targets === undefined) {
    seen.set(source, new Set([target]));
  } else {
    targets.add(target);
  }
  return false;
}
