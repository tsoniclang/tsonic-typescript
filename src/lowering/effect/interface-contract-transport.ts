import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";
import {
  KindAsExpression,
  KindArrowFunction,
  KindBinaryExpression,
  KindParameter,
  KindPropertyDeclaration,
  KindReturnStatement,
  KindTypeAssertionExpression,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import { collectInterfaceCallTransports } from "./interface-contract-call-transport.js";
import {
  linkInterfaceContracts,
  type InterfaceContractIndex,
} from "./interface-contract-graph.js";
import {
  interfaceContractsForProperty,
  interfaceContractTypeDeclaration,
  isInterfaceContractDeclaration,
} from "./interface-contract-declarations.js";
import {
  type InterfaceContractIngress,
  retainUnprovenInterfaceIngress,
} from "./interface-contract-ingress.js";
import {
  contextualExpression,
  selectInterfaceContractContext,
} from "./interface-contract-context.js";
import {
  createInterfaceContractRelevance,
  type InterfaceContractRelevance,
} from "./interface-contract-relevance.js";
import { isFreshInterfaceTransportAggregate } from "./interface-contract-transport-context.js";
import { typeHasTrustedSynchronousCallSignatures } from "./synchronous.js";

interface PendingTypePair {
  readonly semantics: SourceFileSemantics;
  readonly source: Type;
  readonly target: Type;
}

interface TypePairState {
  readonly source: TargetSourceProgram;
  readonly contracts: InterfaceContractIndex;
  rootFile: Node | undefined;
  readonly roots: Map<string, Map<Type, Set<Type>>>;
  readonly relevance: InterfaceContractRelevance;
  readonly seen: Map<Type, Set<Type>>;
  readonly pending: PendingTypePair[];
  rootSourceIsFresh: boolean;
  rootCrossesOpaqueCall: boolean;
}

export function collectInterfaceContractTransports(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contracts: InterfaceContractIndex,
  transports?: StorageOwnerTransportContract,
): void {
  const state: TypePairState = {
    source,
    contracts,
    rootFile: undefined,
    roots: new Map(),
    relevance: createInterfaceContractRelevance(source, contracts),
    seen: new Map(),
    pending: [],
    rootSourceIsFresh: false,
    rootCrossesOpaqueCall: false,
  };
  const ingress: InterfaceContractIngress = {
    source,
    entries: contracts.entries,
    boundaries: contracts.boundaries,
    relevance: state.relevance,
    ...(transports === undefined ? {} : { transports }),
  };
  collectInterfaceCallTransports(
    source,
    program,
    state.relevance,
    ingress,
    {
      processTypePair(semantics, sourceType, targetType, expression, opaque) {
        processTypePair(
          semantics,
          sourceType,
          targetType,
          state,
          expression,
          opaque,
        );
      },
      markExposedContracts(semantics, root) {
        markExposedContracts(semantics, root, state);
      },
    },
    transports,
  );
  for (const kind of [
    KindVariableDeclaration,
    KindPropertyDeclaration,
    KindParameter,
    KindReturnStatement,
    KindBinaryExpression,
    KindAsExpression,
    KindTypeAssertionExpression,
  ]) {
    for (const node of program.nodesOfKind(kind)) {
      const expression = contextualExpression(source, node);
      if (expression === undefined) {
        continue;
      }
      const context = selectInterfaceContractContext(
        source,
        node,
        expression,
        state.relevance,
      );
      if (context !== undefined) {
        for (const target of context.targetTypes) {
          retainUnprovenInterfaceIngress(
            context.semantics,
            expression,
            context.sourceType,
            target,
            ingress,
          );
          processTypePair(
            context.semantics,
            context.sourceType,
            target,
            state,
            expression,
            false,
          );
        }
      }
    }
  }
  for (const arrow of program.nodesOfKind(KindArrowFunction)) {
    const body = source.ast.body(arrow);
    if (body === undefined || source.ast.is.IsBlock(body)) {
      continue;
    }
    const context = selectInterfaceContractContext(
      source,
      arrow,
      body,
      state.relevance,
    );
    if (context === undefined) {
      continue;
    }
    for (const target of context.targetTypes) {
      retainUnprovenInterfaceIngress(
        context.semantics,
        body,
        context.sourceType,
        target,
        ingress,
      );
      processTypePair(
        context.semantics,
        context.sourceType,
        target,
        state,
        body,
        false,
      );
    }
  }
}

function processTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: TypePairState,
  sourceExpression: Node,
  crossesOpaqueCall: boolean,
): void {
  if (state.rootFile !== semantics.sourceFile) {
    state.rootFile = semantics.sourceFile;
    state.roots.clear();
  }
  const sourceIsFresh = isFreshInterfaceTransportAggregate(
    state.source,
    sourceExpression,
  );
  const rootKey = `${crossesOpaqueCall ? "opaque" : "project"}:${
    sourceIsFresh ? "fresh" : "shared"
  }`;
  let roots = state.roots.get(rootKey);
  if (roots === undefined) {
    roots = new Map();
    state.roots.set(rootKey, roots);
  }
  if (pairWasSeen(source, target, roots)) {
    return;
  }
  state.seen.clear();
  state.rootSourceIsFresh = sourceIsFresh;
  state.rootCrossesOpaqueCall = crossesOpaqueCall;
  enqueueTypePair(semantics, source, target, state);
  drainTypePairs(state);
  state.rootSourceIsFresh = false;
  state.rootCrossesOpaqueCall = false;
}

function enqueueTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: TypePairState,
): void {
  const selectedSource = semantics.removeMissingOrUndefined(source);
  const selectedTarget = semantics.removeMissingOrUndefined(target);
  if (
    selectedSource === undefined ||
    selectedTarget === undefined ||
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
  const sourceContracts = state.relevance.contracts(semantics, selectedSource);
  const targetContracts = state.relevance.contracts(semantics, selectedTarget);
  markUnsharedIndirectContracts(
    sourceContracts,
    sourceDirect,
    targetContracts,
    state,
    "source",
  );
  markUnsharedIndirectContracts(
    targetContracts,
    targetDirect,
    sourceContracts,
    state,
    "target",
  );
  if (state.rootCrossesOpaqueCall && !state.rootSourceIsFresh) {
    markIndirectContracts(sourceContracts, sourceDirect, state);
    markIndirectContracts(targetContracts, targetDirect, state);
  }
  if (
    (sourceDirect.length === 0 && targetDirect.length === 0) ||
    pairWasSeen(selectedSource, selectedTarget, state.seen)
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
  state: TypePairState,
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
      state.contracts.boundaries.add(contract);
    }
  }
}

function markIndirectContracts(
  contracts: readonly Node[],
  direct: readonly Node[],
  state: TypePairState,
): void {
  const directSet = new Set(direct);
  for (const contract of contracts) {
    if (!directSet.has(contract)) {
      state.contracts.boundaries.add(contract);
    }
  }
}

function drainTypePairs(state: TypePairState): void {
  while (state.pending.length !== 0) {
    const pair = state.pending.pop();
    if (pair !== undefined) {
      analyzeTypePair(pair, state);
    }
  }
}

function analyzeTypePair(
  pair: PendingTypePair,
  state: TypePairState,
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
  state: TypePairState,
): void {
  if (sourceCalls.length !== 1 || targetCalls.length !== 1) {
    markExposedContracts(semantics, sourceType, state);
    markExposedContracts(semantics, targetType, state);
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
    markExposedContracts(semantics, sourceType, state);
    markExposedContracts(semantics, targetType, state);
    return;
  }
  for (let index = 0; index < sourceParameters.length; index += 1) {
    const sourceParameter = semantics.getTypeOfSymbol(sourceParameters[index]);
    const targetParameter = semantics.getTypeOfSymbol(targetParameters[index]);
    if (sourceParameter !== undefined && targetParameter !== undefined) {
      enqueueTypePair(semantics, targetParameter, sourceParameter, state);
    }
  }
  const sourceReturn = semantics.getReturnTypeOfSignature(sourceSignature);
  const targetReturn = semantics.getReturnTypeOfSignature(targetSignature);
  if (sourceReturn !== undefined && targetReturn !== undefined) {
    enqueueTypePair(semantics, sourceReturn, targetReturn, state);
  }
}

function pairObjectMembers(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceDeclaration: Node | undefined,
  targetDeclaration: Node | undefined,
  state: TypePairState,
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
      for (const contract of targetContracts) {
        state.contracts.boundaries.add(contract);
      }
      markExposedContracts(semantics, targetProperty.type, state);
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
      for (const contract of sourceContracts) {
        state.contracts.boundaries.add(contract);
      }
      markExposedContracts(semantics, sourceProperty.type, state);
      continue;
    } else if (
      targetContracts.length !== 0 &&
      !typeHasTrustedSynchronousCallSignatures(
        state.source,
        semantics,
        sourceProperty.type,
      )
    ) {
      for (const contract of targetContracts) {
        state.contracts.boundaries.add(contract);
      }
      markExposedContracts(semantics, targetProperty.type, state);
      continue;
    }
    enqueueTypePair(
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
  state: TypePairState,
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
  state: TypePairState,
): void {
  if (sources.length !== targets.length) {
    for (const type of [...sources, ...targets]) {
      if (type !== undefined) {
        markExposedContracts(semantics, type, state);
      }
    }
    return;
  }
  for (let index = 0; index < sources.length; index += 1) {
    const sourceType = sources[index];
    const targetType = targets[index];
    if (sourceType !== undefined && targetType !== undefined) {
      enqueueTypePair(semantics, sourceType, targetType, state);
    }
  }
}

function markExposedContracts(
  semantics: SourceFileSemantics,
  root: Type,
  state: TypePairState,
): void {
  for (const contract of state.relevance.contracts(semantics, root)) {
    state.contracts.boundaries.add(contract);
  }
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
