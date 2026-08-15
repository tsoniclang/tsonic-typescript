import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";
import {
  KindBinaryExpression,
  KindCallExpression,
  KindNewExpression,
  KindParameter,
  KindPropertyDeclaration,
  KindReturnStatement,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import {
  linkInterfaceContracts,
  type InterfaceContractIndex,
  type MutableInterfaceContractEntry,
} from "./interface-contract-graph.js";
import {
  contextualExpression,
  selectInterfaceContractContext,
} from "./interface-contract-context.js";
import {
  createInterfaceContractRelevance,
  type InterfaceContractRelevance,
} from "./interface-contract-relevance.js";

interface PendingTypePair {
  readonly semantics: SourceFileSemantics;
  readonly source: Type;
  readonly target: Type;
}

interface TypePairState {
  readonly source: TargetSourceProgram;
  readonly contracts: InterfaceContractIndex;
  rootFile: Node | undefined;
  readonly roots: Map<Type, Set<Type>>;
  readonly relevance: InterfaceContractRelevance;
  readonly seen: Map<Type, Set<Type>>;
  readonly pending: PendingTypePair[];
}

export function collectInterfaceContractTransports(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contracts: InterfaceContractIndex,
): void {
  const state: TypePairState = {
    source,
    contracts,
    rootFile: undefined,
    roots: new Map(),
    relevance: createInterfaceContractRelevance(source, contracts),
    seen: new Map(),
    pending: [],
  };
  for (const kind of [KindCallExpression, KindNewExpression]) {
    for (const node of program.nodesOfKind(kind)) {
      const semantics = source.semantics.forNode(node);
      processCallTransports(source, semantics, node, state);
    }
  }
  for (const kind of [
    KindVariableDeclaration,
    KindPropertyDeclaration,
    KindParameter,
    KindReturnStatement,
    KindBinaryExpression,
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
          processTypePair(
            context.semantics,
            context.sourceType,
            target,
            state,
          );
        }
      }
    }
  }
}

function processCallTransports(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  node: Node,
  state: TypePairState,
): boolean {
  const arguments_ = source.ast.arguments(node);
  const argumentTypes = arguments_.map((argument) =>
    semantics.getTypeAtLocation(argument)
  );
  const signature = semantics.getResolvedSignature(node);
  const signatureParameters = semantics.getSignatureParameters(signature);
  const parameterTypes = signatureParameters.map((parameter) =>
    semantics.getTypeOfSymbol(parameter)
  );
  let selected = false;
  for (const type of [...argumentTypes, ...parameterTypes]) {
    if (
      type !== undefined &&
      typeRequiresDirectTransport(semantics, type, state)
    ) {
      selected = true;
    }
  }
  if (!selected) {
    return false;
  }
  const declaration = semantics.getSignatureDeclaration(signature);
  const declarationParameters = declaration === undefined
    ? []
    : source.ast.parameters(declaration);
  const complex = declaration === undefined ||
    declarationParameters.length !== signatureParameters.length ||
    arguments_.some((argument) => source.ast.is.IsSpreadElement(argument)) ||
    declarationParameters.some((parameter) =>
      source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !==
        undefined
    );
  if (complex) {
    for (const type of [...argumentTypes, ...parameterTypes]) {
      if (type !== undefined) {
        markExposedContracts(semantics, type, state);
      }
    }
    return true;
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const sourceType = argumentTypes[index];
    const targetType = parameterTypes[index];
    if (sourceType === undefined || targetType === undefined) {
      if (sourceType !== undefined) {
        markExposedContracts(semantics, sourceType, state);
      }
      if (targetType !== undefined) {
        markExposedContracts(semantics, targetType, state);
      }
      continue;
    }
    processTypePair(semantics, sourceType, targetType, state);
  }
  return true;
}

function processTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: TypePairState,
): void {
  if (state.rootFile !== semantics.sourceFile) {
    state.rootFile = semantics.sourceFile;
    state.roots.clear();
  }
  if (pairWasSeen(source, target, state.roots)) {
    return;
  }
  state.seen.clear();
  enqueueTypePair(semantics, source, target, state);
  drainTypePairs(state);
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
  const sourceIsDirect = typeRequiresDirectTransport(
    semantics,
    selectedSource,
    state,
  );
  const targetIsDirect = typeRequiresDirectTransport(
    semantics,
    selectedTarget,
    state,
  );
  if (
    (!sourceIsDirect && !targetIsDirect) ||
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

function typeRequiresDirectTransport(
  semantics: SourceFileSemantics,
  type: Type,
  state: TypePairState,
): boolean {
  const direct = state.relevance.directContracts(semantics, type);
  const directSet = new Set(direct);
  for (const contract of state.relevance.contracts(semantics, type)) {
    if (!directSet.has(contract)) {
      state.contracts.boundaries.add(contract);
    }
  }
  return direct.length !== 0;
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
  const sourceDeclaration = typeDeclaration(semantics, sourceType);
  const targetDeclaration = typeDeclaration(semantics, targetType);
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
    isInterface(state.source, sourceDeclaration) ||
    isInterface(state.source, targetDeclaration)
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
    if (sourceProperty === undefined) {
      continue;
    }
    const sourceContracts = contractsForProperty(
      state.source,
      semantics,
      sourceProperty.symbol,
      sourceDeclaration,
      sourceProperty.name,
      state.contracts.entries,
      state.contracts.declarationContracts,
    );
    const targetContracts = contractsForProperty(
      state.source,
      semantics,
      targetProperty.symbol,
      targetDeclaration,
      targetProperty.name,
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
    } else if (sourceContracts.length !== 0) {
      for (const contract of sourceContracts) {
        state.contracts.boundaries.add(contract);
      }
      markExposedContracts(semantics, sourceProperty.type, state);
      continue;
    } else if (targetContracts.length !== 0) {
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

function typeDeclaration(
  semantics: SourceFileSemantics,
  type: Type,
): Node | undefined {
  const target = semantics.isTypeReference(type)
    ? semantics.getTypeReferenceTarget(type) ?? type
    : type;
  const symbols = [
    semantics.getTypeSymbol(target),
    semantics.getTypeAliasSymbol(target),
    semantics.getTypeSymbol(type),
    semantics.getTypeAliasSymbol(type),
  ].filter((symbol, index, selected) =>
    symbol !== undefined && selected.indexOf(symbol) === index
  );
  const declarations = symbols.flatMap((symbol) =>
    semantics.getSymbolDeclarations(symbol)
  ).filter((declaration, index, selected) =>
    declaration !== undefined && selected.indexOf(declaration) === index
  );
  return declarations.length === 1 ? declarations[0] : undefined;
}

function contractsForProperty(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  symbol: Parameters<SourceFileSemantics["getSymbolDeclarations"]>[0],
  owner: Node | undefined,
  name: string,
  entries: ReadonlyMap<Node, MutableInterfaceContractEntry>,
  declarationContracts: ReadonlyMap<Node, readonly Node[]>,
): readonly Node[] {
  const result = new Set(
    semantics.getSymbolDeclarations(symbol)
      .filter((declaration): declaration is Node =>
        declaration !== undefined && entries.has(declaration)
      ),
  );
  if (owner !== undefined && isClassLike(source, owner)) {
    for (const contract of declarationContracts.get(owner) ?? []) {
      const contractName = source.ast.name(contract);
      if (
        contractName !== undefined &&
        source.ast.text(contractName) === name
      ) {
        result.add(contract);
      }
    }
  }
  return [...result];
}

function isInterface(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): boolean {
  return declaration !== undefined &&
    source.ast.is.IsInterfaceDeclaration(declaration);
}

function isClassLike(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): boolean {
  return declaration !== undefined &&
    (
      source.ast.is.IsClassDeclaration(declaration) ||
      source.ast.is.IsClassExpression(declaration)
    );
}

function isExactProjectDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile !== undefined &&
    source.semantics.includes(sourceFile) &&
    source.navigation.isProjectDeclaration(declaration);
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
