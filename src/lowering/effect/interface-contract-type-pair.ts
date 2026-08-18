import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import {
  linkInterfaceContracts,
  type InterfaceContractIndex,
} from "./interface-contract-graph.js";
import {
  interfaceContractsForProperty,
  interfaceContractTypeDeclaration,
  isInterfaceContractDeclaration,
} from "./interface-contract-declarations.js";
import type { InterfaceContractRelevance } from "./interface-contract-relevance.js";
import { typeHasTrustedSynchronousCallSignatures } from "./synchronous.js";
import type { InterfaceContractBoundaryReason } from "./interface-contract-boundary.js";

export interface InterfaceContractPendingTypePair {
  readonly semantics: SourceFileSemantics;
  readonly source: Type;
  readonly target: Type;
}

export interface InterfaceContractTypePairState {
  readonly source: TargetSourceProgram;
  readonly contracts: InterfaceContractIndex;
  rootOccurrence: Node | undefined;
  readonly relevance: InterfaceContractRelevance;
  readonly seen: Map<Type, Set<Type>>;
  readonly pending: InterfaceContractPendingTypePair[];
  rootSourceIsFresh: boolean;
  rootCrossesOpaqueCall: boolean;
}

export function enqueueInterfaceContractTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: InterfaceContractTypePairState,
): void {
  const selectedSource = semantics.removeMissingOrUndefined(source);
  const selectedTarget = semantics.removeMissingOrUndefined(target);
  if (
    selectedSource === undefined ||
    selectedTarget === undefined ||
    semantics.isNever(selectedSource) ||
    semantics.isNever(selectedTarget) ||
    selectedSource === selectedTarget
  ) {
    return;
  }
  const sourceDirect = state.relevance.directContracts(
    semantics,
    selectedSource,
  );
  const targetDirect = state.relevance.directContracts(
    semantics,
    selectedTarget,
  );
  const sourceValues = state.relevance.valueContracts(
    semantics,
    selectedSource,
  );
  const targetValues = state.relevance.valueContracts(
    semantics,
    selectedTarget,
  );
  markUnsharedIndirectContracts(
    sourceValues,
    sourceDirect,
    targetValues,
    state,
    "source",
  );
  markUnsharedIndirectContracts(
    targetValues,
    targetDirect,
    sourceValues,
    state,
    "target",
  );
  if (state.rootCrossesOpaqueCall && !state.rootSourceIsFresh) {
    markIndirectContracts(sourceValues, sourceDirect, state);
    markIndirectContracts(targetValues, targetDirect, state);
  }
  if (
    (sourceDirect.length === 0 && targetDirect.length === 0) ||
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

function markUnsharedIndirectContracts(
  contracts: readonly Node[],
  direct: readonly Node[],
  counterpart: readonly Node[],
  state: InterfaceContractTypePairState,
  side: "source" | "target",
): void {
  const directSet = new Set(direct);
  const counterpartSet = new Set(counterpart);
  for (const contract of contracts) {
    if (!directSet.has(contract) && !counterpartSet.has(contract)) {
      if (
        side === "source" &&
        counterpartSet.size === 0 &&
        state.rootSourceIsFresh
      ) {
        continue;
      }
      markBoundary(state, contract, "unmatched-nested-contract");
    }
  }
}

function markIndirectContracts(
  contracts: readonly Node[],
  direct: readonly Node[],
  state: InterfaceContractTypePairState,
): void {
  const directSet = new Set(direct);
  for (const contract of contracts) {
    if (!directSet.has(contract)) {
      markBoundary(state, contract, "opaque-call-transport");
    }
  }
}

export function drainInterfaceContractTypePairs(
  state: InterfaceContractTypePairState,
): void {
  while (state.pending.length !== 0) {
    const pair = state.pending.pop();
    if (pair !== undefined) {
      analyzeTypePair(pair, state);
    }
  }
}

function analyzeTypePair(
  pair: InterfaceContractPendingTypePair,
  state: InterfaceContractTypePairState,
): void {
  const { semantics } = pair;
  const sourceType = pair.source;
  const targetType = pair.target;
  const sourceDeclaration = interfaceContractTypeDeclaration(
    semantics,
    sourceType,
  );
  const targetDeclaration = interfaceContractTypeDeclaration(
    semantics,
    targetType,
  );
  if (
    sourceDeclaration !== undefined &&
    targetDeclaration !== undefined &&
    sourceDeclaration === targetDeclaration
  ) {
    if (
      semantics.isTypeReference(sourceType) &&
      semantics.isTypeReference(targetType) &&
      semantics.getTypeReferenceTarget(sourceType) !== undefined &&
      semantics.getTypeReferenceTarget(targetType) !== undefined
    ) {
      pairTypeArguments(semantics, sourceType, targetType, state);
    }
    return;
  }
  if (
    isInterfaceContractDeclaration(state.source, sourceDeclaration) ||
    isInterfaceContractDeclaration(state.source, targetDeclaration)
  ) {
    pairObjectMembers(
      semantics,
      sourceType,
      targetType,
      sourceDeclaration,
      targetDeclaration,
      state,
    );
    return;
  }
  const sourceCalls = semantics.getCallSignatures(sourceType);
  const targetCalls = semantics.getCallSignatures(targetType);
  if (sourceCalls.length !== 0 || targetCalls.length !== 0) {
    pairCallSignatures(
      semantics,
      sourceType,
      targetType,
      sourceCalls,
      targetCalls,
      state,
    );
    return;
  }
  if (semantics.isTuple(sourceType) && semantics.isTuple(targetType)) {
    pairTypeLists(
      semantics,
      semantics.getTupleElementTypes(sourceType),
      semantics.getTupleElementTypes(targetType),
      state,
    );
    return;
  }
  if (
    semantics.isTypeReference(sourceType) &&
    semantics.isTypeReference(targetType)
  ) {
    const sourceTarget = semantics.getTypeReferenceTarget(sourceType);
    if (
      sourceTarget !== undefined &&
      sourceTarget === semantics.getTypeReferenceTarget(targetType)
    ) {
      pairTypeArguments(semantics, sourceType, targetType, state);
      return;
    }
  }
  pairObjectMembers(
    semantics,
    sourceType,
    targetType,
    sourceDeclaration,
    targetDeclaration,
    state,
  );
}

function pairCallSignatures(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceCalls: readonly Parameters<SourceFileSemantics["getReturnTypeOfSignature"]>[0][],
  targetCalls: readonly Parameters<SourceFileSemantics["getReturnTypeOfSignature"]>[0][],
  state: InterfaceContractTypePairState,
): void {
  if (sourceCalls.length !== 1 || targetCalls.length !== 1) {
    markInterfaceContractsExposed(
      semantics,
      sourceType,
      state,
      "incompatible-call-signature",
    );
    markInterfaceContractsExposed(
      semantics,
      targetType,
      state,
      "incompatible-call-signature",
    );
    return;
  }
  const sourceSignature = sourceCalls[0];
  const targetSignature = targetCalls[0];
  if (sourceSignature === undefined || targetSignature === undefined) {
    return;
  }
  const sourceParameters = semantics.getSignatureParameters(sourceSignature);
  const targetParameters = semantics.getSignatureParameters(targetSignature);
  if (sourceParameters.length !== targetParameters.length) {
    markInterfaceContractsExposed(
      semantics,
      sourceType,
      state,
      "incompatible-call-signature",
    );
    markInterfaceContractsExposed(
      semantics,
      targetType,
      state,
      "incompatible-call-signature",
    );
    return;
  }
  for (let index = 0; index < sourceParameters.length; index += 1) {
    const sourceParameter = semantics.getTypeOfSymbol(sourceParameters[index]);
    const targetParameter = semantics.getTypeOfSymbol(targetParameters[index]);
    if (sourceParameter !== undefined && targetParameter !== undefined) {
      enqueueInterfaceContractTypePair(
        semantics,
        targetParameter,
        sourceParameter,
        state,
      );
    }
  }
  const sourceReturn = semantics.getReturnTypeOfSignature(sourceSignature);
  const targetReturn = semantics.getReturnTypeOfSignature(targetSignature);
  if (sourceReturn !== undefined && targetReturn !== undefined) {
    enqueueInterfaceContractTypePair(
      semantics,
      sourceReturn,
      targetReturn,
      state,
    );
  }
}

function pairObjectMembers(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceDeclaration: Node | undefined,
  targetDeclaration: Node | undefined,
  state: InterfaceContractTypePairState,
): void {
  const sourceProperties = new Map(
    semantics.getPropertyInfos(sourceType).map((property) => [
      property.name,
      property,
    ]),
  );
  for (const targetProperty of semantics.getPropertyInfos(targetType)) {
    const sourceProperty = sourceProperties.get(targetProperty.name);
    const targetContracts = interfaceContractsForProperty(
      state.source,
      semantics,
      targetProperty.symbol,
      targetDeclaration,
      targetProperty.name,
      state.contracts.entries,
      state.contracts.declarationContracts,
    );
    if (sourceProperty === undefined) {
      markBoundaries(state, targetContracts, "missing-transport-member");
      markInterfaceContractsExposed(
        semantics,
        targetProperty.type,
        state,
        "missing-transport-member",
      );
      continue;
    }
    const sourceContracts = interfaceContractsForProperty(
      state.source,
      semantics,
      sourceProperty.symbol,
      sourceDeclaration,
      sourceProperty.name,
      state.contracts.entries,
      state.contracts.declarationContracts,
    );
    const exactImplicitImplementation = sourceContracts.length === 0 &&
      targetContracts.length !== 0 &&
      state.contracts.implementations.recordTypeImplementations(
        semantics,
        sourceType,
        targetContracts,
      );
    if (sourceContracts.length !== 0 && targetContracts.length !== 0) {
      for (const sourceContract of sourceContracts) {
        for (const targetContract of targetContracts) {
          linkInterfaceContracts(
            sourceContract,
            targetContract,
            state.contracts.links,
          );
        }
      }
    } else if (
      sourceContracts.length !== 0 &&
      !typeHasTrustedSynchronousCallSignatures(
        state.source,
        semantics,
        targetProperty.type,
      )
    ) {
      markBoundaries(state, sourceContracts, "untrusted-callable-member");
      markInterfaceContractsExposed(
        semantics,
        sourceProperty.type,
        state,
        "untrusted-callable-member",
      );
      continue;
    } else if (
      targetContracts.length !== 0 &&
      !exactImplicitImplementation &&
      !typeHasTrustedSynchronousCallSignatures(
        state.source,
        semantics,
        sourceProperty.type,
      )
    ) {
      markBoundaries(state, targetContracts, "untrusted-callable-member");
      markInterfaceContractsExposed(
        semantics,
        targetProperty.type,
        state,
        "untrusted-callable-member",
      );
      continue;
    }
    enqueueInterfaceContractTypePair(
      semantics,
      sourceProperty.type,
      targetProperty.type,
      state,
    );
  }
}

function pairTypeArguments(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  state: InterfaceContractTypePairState,
): void {
  pairTypeLists(
    semantics,
    semantics.getTypeArguments(sourceType),
    semantics.getTypeArguments(targetType),
    state,
  );
}

function pairTypeLists(
  semantics: SourceFileSemantics,
  sources: readonly (Type | undefined)[],
  targets: readonly (Type | undefined)[],
  state: InterfaceContractTypePairState,
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
    const sourceType = sources[index];
    const targetType = targets[index];
    if (sourceType !== undefined && targetType !== undefined) {
      enqueueInterfaceContractTypePair(
        semantics,
        sourceType,
        targetType,
        state,
      );
    }
  }
}

export function markInterfaceContractsExposed(
  semantics: SourceFileSemantics,
  root: Type,
  state: InterfaceContractTypePairState,
  reason: InterfaceContractBoundaryReason,
  occurrence: Node = currentOccurrence(state),
): void {
  for (const contract of state.relevance.contracts(semantics, root)) {
    state.contracts.boundaries.mark(contract, reason, occurrence);
  }
}

export function markInterfaceValueContractsExposed(
  semantics: SourceFileSemantics,
  root: Type,
  state: InterfaceContractTypePairState,
  reason: InterfaceContractBoundaryReason,
  occurrence: Node = currentOccurrence(state),
): void {
  for (const contract of state.relevance.valueContracts(semantics, root)) {
    state.contracts.boundaries.mark(contract, reason, occurrence);
  }
}

function markBoundaries(
  state: InterfaceContractTypePairState,
  contracts: readonly Node[],
  reason: InterfaceContractBoundaryReason,
): void {
  for (const contract of contracts) {
    markBoundary(state, contract, reason);
  }
}

function markBoundary(
  state: InterfaceContractTypePairState,
  contract: Node,
  reason: InterfaceContractBoundaryReason,
): void {
  state.contracts.boundaries.mark(contract, reason, currentOccurrence(state));
}

function currentOccurrence(state: InterfaceContractTypePairState): Node {
  if (state.rootOccurrence === undefined) {
    throw new Error("interface transport boundary has no source occurrence");
  }
  return state.rootOccurrence;
}

export function interfaceContractTypePairWasSeen(
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
