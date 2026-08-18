import type { Node, Signature, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import { sameSelectedType } from "../../model/synchronous.js";
import { projectCallableImplementation } from "../../model/project-invocation.js";
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

export type { OpaqueInterfaceExposureSink } from "./opaque-exposure/model.js";

interface OpaqueInterfaceExposureState {
  readonly source: TargetSourceProgram;
  readonly relevance: InterfaceContractRelevance;
  readonly sink: OpaqueInterfaceExposureSink;
  readonly freshSeen: Map<Type, Set<Type>>;
  readonly sharedSeen: Map<Type, Set<Type>>;
  readonly relevanceCache: Map<Type, boolean>;
}

export function opaqueInterfaceSourceContainsContracts(
  semantics: SourceFileSemantics,
  source: Type,
  relevance: InterfaceContractRelevance,
): boolean {
  return sourceContainsRelevantContracts(
    semantics,
    source,
    relevance,
    new Map(),
  );
}

export function retainOpaqueInterfaceInputs(
  sourceProgram: TargetSourceProgram,
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  sourceIsFresh: boolean,
  relevance: InterfaceContractRelevance,
  sink: OpaqueInterfaceExposureSink,
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
      relevanceCache: new Map(),
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
  const selectedSource = semantics.removeMissingOrUndefined(source);
  const selectedTarget = semantics.removeMissingOrUndefined(target);
  if (
    selectedSource === undefined ||
    selectedTarget === undefined ||
    semantics.isNever(selectedSource) ||
    semantics.isNever(selectedTarget) ||
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
    semantics.isAny(selectedTarget) ||
    semantics.isUnknown(selectedTarget)
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
  if (semantics.isUnion(source)) {
    for (const member of selectedMembers(semantics, source)) {
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
  if (!semantics.isUnion(target)) {
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
  if (!semantics.isUnion(target)) {
    analyzeOpaquePair(semantics, source, target, sourceIsFresh, state);
    return;
  }
  const exact = selectedMembers(semantics, target).filter((member) =>
    sameSelectedType(semantics, source, member)
  );
  if (exact.length !== 1) {
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
    semantics.getCallSignatures(source),
    semantics.getCallSignatures(target),
    state,
  );
  retainSignatureInputs(
    semantics,
    source,
    semantics.getConstructSignatures(source),
    semantics.getConstructSignatures(target),
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
  if (sources.length !== 1 || targets.length !== 1) {
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
  const sourceParameters = semantics.getSignatureParameterInfos(sources[0]);
  const targetParameters = semantics.getSignatureParameterInfos(targets[0]);
  if (
    sourceParameters.length !== targetParameters.length ||
    sourceParameters.some((parameter, index) =>
      parameter.parameterKind !== targetParameters[index]?.parameterKind
    )
  ) {
    for (const parameter of sourceParameters) {
      markAllRelevantSourceContracts(
        semantics,
        parameter.type,
        state.relevance,
        state.sink,
      );
    }
    return;
  }
  const implementation = projectCallableImplementation(
    state.source,
    semantics.getSignatureDeclaration(sources[0]),
  );
  if (implementation !== undefined) {
    const declarations = sourceParameters.map((parameter) =>
      parameter.declaration
    );
    if (
      declarations.every((declaration): declaration is Node =>
        declaration !== undefined &&
        state.source.ast.is.IsParameterDeclaration(declaration) &&
        state.source.navigation.isProjectDeclaration(declaration) &&
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
  for (const parameter of semantics.getSignatureParameterInfos(signature)) {
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
  if (semantics.isTuple(type)) {
    return semantics.getTupleElementInfos(type).map((element) => element.type);
  }
  if (!semantics.isArrayLike(type)) {
    return undefined;
  }
  const arguments_ = semantics.isTypeReference(type)
    ? semantics.getTypeArguments(type).filter(
      (argument): argument is Type => argument !== undefined,
    )
    : [];
  if (arguments_.length === 1) {
    return arguments_;
  }
  const indexed = semantics.getIndexInfos(type).map((index) => index.valueType)
    .filter((value): value is Type => value !== undefined);
  return indexed.length === 1 ? indexed : undefined;
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
  const indexes = semantics.getIndexInfos(type);
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
    semantics.getPropertyInfos(source).map((property) => [
      property.name,
      property,
    ]),
  );
  for (const targetProperty of semantics.getPropertyInfos(target)) {
    const sourceProperty = sources.get(targetProperty.name);
    const sourceProviders = sourceProperty === undefined
      ? semantics.getIndexInfos(source).filter((index) =>
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
  const sourceIndexes = semantics.getIndexInfos(source);
  const sourceProperties = [...sources.values()];
  for (const targetIndex of semantics.getIndexInfos(target)) {
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
): readonly Type[] {
  return semantics.getUnionOrIntersectionTypes(type).filter(
    (member): member is Type => member !== undefined,
  );
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
