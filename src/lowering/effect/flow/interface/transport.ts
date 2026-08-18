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

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import { collectInterfaceCallTransports } from "./call-transport.js";
import type { InterfaceContractIndex } from "./graph.js";
import {
  type InterfaceContractIngress,
  retainUnprovenInterfaceIngress,
} from "./ingress.js";
import {
  contextualExpression,
  selectInterfaceContractContext,
} from "./context.js";
import {
  createInterfaceContractRelevance,
  type InterfaceContractRelevance,
} from "./relevance.js";
import { isFreshInterfaceTransportAggregate } from "./transport-context.js";
import {
  drainInterfaceContractTypePairs,
  enqueueInterfaceContractTypePair,
  interfaceContractTypePairWasSeen,
  markInterfaceContractsExposed,
  markInterfaceValueContractsExposed,
  type InterfaceContractTypePairState,
} from "./type-pair.js";

interface TypePairState extends InterfaceContractTypePairState {
  rootFile: Node | undefined;
  readonly roots: Map<string, Map<Type, Set<Type>>>;
  readonly relevance: InterfaceContractRelevance;
}

export function collectInterfaceContractTransports(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contracts: InterfaceContractIndex,
  transports?: InvocationTransportContract,
): void {
  const state: TypePairState = {
    source,
    contracts,
    rootFile: undefined,
    rootOccurrence: undefined,
    roots: new Map(),
    relevance: createInterfaceContractRelevance(source, contracts),
    seen: new Map(),
    pending: [],
    rootSourceIsFresh: false,
  };
  const ingress: InterfaceContractIngress = {
    source,
    program,
    entries: contracts.entries,
    boundaries: contracts.boundaries,
    implementations: contracts.implementations,
    relevance: state.relevance,
    ...(transports === undefined ? {} : { transports }),
  };
  collectInterfaceCallTransports(
    source,
    program,
    state.relevance,
    ingress,
    {
      processTypePair(semantics, sourceType, targetType, expression) {
        processTypePair(
          semantics,
          sourceType,
          targetType,
          state,
          expression,
        );
      },
      markExposedContracts(semantics, root, occurrence, reason) {
        markInterfaceContractsExposed(
          semantics,
          root,
          state,
          reason,
          occurrence,
        );
      },
      markExposedValueContracts(semantics, root, occurrence, reason) {
        markInterfaceValueContractsExposed(
          semantics,
          root,
          state,
          reason,
          occurrence,
        );
      },
      markAllContracts(occurrence, reason) {
        for (const contract of state.contracts.entries.keys()) {
          state.contracts.boundaries.mark(contract, reason, occurrence);
        }
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
          processTypePair(
            context.semantics,
            context.sourceType,
            target,
            state,
            expression,
          );
          retainUnprovenInterfaceIngress(
            context.semantics,
            expression,
            context.sourceType,
            target,
            ingress,
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
      processTypePair(
        context.semantics,
        context.sourceType,
        target,
        state,
        body,
      );
      retainUnprovenInterfaceIngress(
        context.semantics,
        body,
        context.sourceType,
        target,
        ingress,
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
): void {
  if (state.rootFile !== semantics.sourceFile) {
    state.rootFile = semantics.sourceFile;
    state.roots.clear();
  }
  const sourceIsFresh = isFreshInterfaceTransportAggregate(
    state.source,
    sourceExpression,
  );
  const rootKey = sourceIsFresh ? "fresh" : "shared";
  let roots = state.roots.get(rootKey);
  if (roots === undefined) {
    roots = new Map();
    state.roots.set(rootKey, roots);
  }
  if (interfaceContractTypePairWasSeen(source, target, roots)) {
    return;
  }
  state.seen.clear();
  state.rootSourceIsFresh = sourceIsFresh;
  state.rootOccurrence = sourceExpression;
  enqueueInterfaceContractTypePair(semantics, source, target, state);
  drainInterfaceContractTypePairs(state);
  state.rootSourceIsFresh = false;
  state.rootOccurrence = undefined;
}
