import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
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
import { createOpaqueInterfaceInputLedger } from "./opaque-inputs.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import { createExactValueSlotFlow } from "../value/slot/flow.js";
import type { ExactValueSlotCallSource } from "../value/slot/model.js";
import { callableDispatchIsClosed } from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import { createInterfaceOriginRequirements } from "./ingress/requirements.js";
import { createInterfaceImplementationInputIndex } from "./ingress/implementation-inputs.js";
import { collectClosedStorageOwners } from "../storage/owners.js";
import {
  drainInterfaceContractTypePairs,
  enqueueInterfaceContractTypePair,
  interfaceContractTypePairWasSeen,
  markInterfaceContractsExposed,
  markInterfaceValueContractsExposed,
  type InterfaceContractTypePairState,
} from "./type-pair.js";
import {
  createCheckedInterfaceParameterInputs,
} from "./ingress/checked-parameters.js";

interface TypePairState extends InterfaceContractTypePairState {
  readonly roots: WeakMap<Node, Map<string, Map<Type, Set<Type>>>>;
  readonly relevance: InterfaceContractRelevance;
}

export function collectInterfaceContractTransports(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contracts: InterfaceContractIndex,
  invocationInputs: ExactInvocationInputIndex,
  aggregateProjections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  planningObserver?: TypeScriptPlanningObserver,
): ExactInvocationInputIndex {
  const state: TypePairState = {
    source,
    contracts,
    rootOccurrence: undefined,
    roots: new WeakMap(),
    relevance: createInterfaceContractRelevance(source, contracts),
    seen: new Map(),
    pending: [],
    rootSourceIsFresh: false,
  };
  const opaqueInputs = createOpaqueInterfaceInputLedger();
  const checkedParameterInputs = createCheckedInterfaceParameterInputs();
  const originRequirements = createInterfaceOriginRequirements();
  const ingress: InterfaceContractIngress = {
    source,
    program,
    entries: contracts.entries,
    boundaries: contracts.boundaries,
    implementations: contracts.implementations,
    relevance: state.relevance,
    opaqueInputs,
    invocationInputs,
    checkedParameterInputs,
    aggregateProjections,
    objectProjections,
    closedStorageOwners: collectClosedStorageOwners(source, program),
    originRequirements,
    ...(transports === undefined ? {} : { transports }),
    ...(exactCallImplementations === undefined
      ? {}
      : { exactCallImplementations }),
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
    },
    transports,
    planningObserver,
  );
  planningObserver?.("effect-interface-call-transports");
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
  planningObserver?.("effect-interface-context-transports");
  const completeInvocationInputs = createInterfaceImplementationInputIndex(
    source,
    program,
    [...contracts.entries.values()].map((entry) => Object.freeze({
      calls: Object.freeze([...entry.calls]),
      implementations: contracts.implementations.implementationsFor(
        entry.declaration,
      ),
    })),
    invocationInputs,
    aggregateProjections,
    exactCallImplementations,
    callableReferenceIsClosed,
    cooperativeEffects,
  );
  planningObserver?.("effect-interface-implementation-inputs");
  const slots = createExactValueSlotFlow(
    source,
    program,
    aggregateProjections,
    (call) => interfaceSlotSource(
      source,
      program,
      contracts,
      call,
      transports,
      exactCallImplementations,
    ),
    completeInvocationInputs,
    originRequirements.requiredValues(),
    planningObserver,
  );
  planningObserver?.("effect-interface-value-slots");
  checkedParameterInputs.seal();
  const originMeasurements = originRequirements.finish({
    ...ingress,
    slots,
    invocationInputs: completeInvocationInputs,
  });
  planningObserver?.("effect-interface-origins", originMeasurements);
  return completeInvocationInputs;
}

function interfaceSlotSource(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contracts: InterfaceContractIndex,
  call: Node,
  transports: InvocationTransportContract | undefined,
  exactCallImplementations: ExactCallImplementations | undefined,
): ExactValueSlotCallSource | undefined {
  const semantics = source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  const contract = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const transported = transports?.transportFor(call)?.resultOriginExpressions;
  if (transported !== undefined) {
    return Object.freeze({
      declaration: call,
      contracts: Object.freeze([]),
      expressions: Object.freeze([...transported]),
    });
  }
  const direct = resolveProjectInvocation(source, call)?.implementation;
  const indirect = direct === undefined
    ? exactCallImplementations?.(call)
    : undefined;
  const implementations = direct === undefined && indirect !== undefined
    ? indirect
    : direct === undefined && contract !== undefined &&
      contracts.entries.has(contract)
    ? contracts.implementations.implementationsFor(contract)
    : direct === undefined
    ? []
    : [direct];
  if (implementations.length === 0) {
    return undefined;
  }
  const expressions: (Node | undefined)[] = [];
  for (const implementation of implementations) {
    if (!callableDispatchIsClosed(source, program, implementation)) {
      return undefined;
    }
    const returned = exactCallableReturnExpressions(source, implementation);
    if (returned === undefined || returned.length === 0) {
      return undefined;
    }
    expressions.push(...returned);
  }
  return Object.freeze({
    declaration: direct ?? contract ?? implementations[0]!,
    expressions: Object.freeze(expressions),
  });
}

function processTypePair(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
  state: TypePairState,
  sourceExpression: Node,
): void {
  let fileRoots = state.roots.get(semantics.sourceFile);
  if (fileRoots === undefined) {
    fileRoots = new Map();
    state.roots.set(semantics.sourceFile, fileRoots);
  }
  const sourceIsFresh = isFreshInterfaceTransportAggregate(
    state.source,
    sourceExpression,
  );
  const rootKey = sourceIsFresh ? "fresh" : "shared";
  let roots = fileRoots.get(rootKey);
  if (roots === undefined) {
    roots = new Map();
    fileRoots.set(rootKey, roots);
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
