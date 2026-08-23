import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import {
  createEffectProvenanceGraphBuilder,
} from "../../provenance/graph.js";
import type {
  EffectProvenanceVertex,
} from "../../provenance/model.js";
import { resolveEffectProvenance } from "../../provenance/resolution.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import {
  collectCallableValueInputs,
  type CallableValueInputs,
} from "./value-inputs.js";
import type { CallableFields } from "../storage/fields.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import {
  createCallableResultInputs,
  type ExactCallImplementations,
} from "./result-inputs.js";
import { createCallableInputUseContract } from "./input-use.js";
import {
  forEachInvocationTransportInput,
  invocationTransportResultOrigins,
} from "./invocation-transport.js";
import { indexDeclarationSymbols } from "./input-reference.js";
import { typeMayBeCallable } from "../../model/synchronous.js";
import type { CallableReturnRewrite } from "../../model/callable-contract.js";
import { collectCallableProjectionCandidates } from "./projection-candidates.js";
import {
  createExactCallableValueResolution,
  type CallableValueResolution,
} from "./value-resolution.js";
import {
  collectUnsafeCallableUses,
  mergeDeclarations,
} from "./provenance/state.js";
import {
  connectSynchronousCallableBodies,
} from "./provenance/body-flow.js";
import {
  appendReturnTypeContract,
  type MutableCallableReturnContract,
} from "./provenance/return-contracts.js";
import {
  callableDeclarationState,
  callableExpressionState,
} from "./provenance/expression.js";
import {
  createEffectProvenanceOriginIndex,
  selectOriginOccurrences,
} from "../../provenance/origin-index.js";
import {
  finalizeGraphCallableValueFlow,
  type GraphCallableValueFlow,
  type SettledCallableReturnContract,
} from "./provenance/finalization.js";
import {
  callableCallContractRequirement,
  callableContractSourceRequirement,
} from "./provenance/contract-settlement.js";
import { transparentExpression } from "../../model/syntax.js";
import {
  collectCallReturnContractStates,
} from "./provenance/call-contracts.js";

export type CallableBoundaryReason =
  | "inexact-reference"
  | "open-binding"
  | "open-callable"
  | "open-projection"
  | "unresolved-expression";

export interface CallableState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
  relevant: boolean;
}

interface ReturnContractState {
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly state: CallableState;
  readonly sources: readonly Node[];
}

export interface CallableContext {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly candidates: ReadonlySet<Node>;
  readonly objectProjections: ExactObjectPropertyProjectionIndex | undefined;
  readonly exactCallImplementations: ExactCallImplementations | undefined;
  readonly exactContractImplementations: ExactCallImplementations | undefined;
  readonly candidateSymbols: ReadonlyMap<Symbol, Node>;
  readonly inputs: CallableValueInputs;
  readonly results: ReturnType<typeof createCallableResultInputs>;
  readonly transports: InvocationTransportContract | undefined;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<CallableBoundaryReason>
  >;
  readonly expressions: Map<Node, CallableState>;
  readonly declarations: Map<Node, CallableState>;
  readonly calls: Map<Node, CallableState>;
  readonly callImplementations: Map<Node, readonly Node[]>;
  readonly candidateOrigins: Set<Node>;
  readonly synchronousOrigins: Set<Node>;
  terminalOrigin: Node | undefined;
  readonly callableReferences: Map<Node, CallableState>;
  readonly returnedContracts: Map<Node, ReturnContractState>;
  readonly dependents: Map<CallableState, Set<CallableState>>;
  readonly dependencies: Map<CallableState, Set<CallableState>>;
  readonly states: CallableState[];
}

export function createGraphCallableValueFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  projections: ExactAggregateProjectionIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  invocationInputs?: ExactInvocationInputIndex,
  exactContractImplementations?: ExactCallImplementations,
  objectProjections?: ExactObjectPropertyProjectionIndex,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  callableFields?: CallableFields,
  planningObserver?: TypeScriptPlanningObserver,
): GraphCallableValueFlow {
  const projectionCandidates = collectCallableProjectionCandidates(
    source,
    program,
    planningObserver,
  );
  const results = createCallableResultInputs(
    source,
    program,
    projections,
    candidates,
    exactCallImplementations,
    invocationInputs,
    projectionCandidates,
    (call) => invocationTransportResultOrigins(call, transports),
    planningObserver,
  );
  const inputUses = createCallableInputUseContract(source, results, transports);
  const inputs = collectCallableValueInputs(
    source,
    program,
    inputUses,
    invocationInputs,
    exactCallImplementations,
    callableReferenceIsClosed,
    planningObserver,
    callableFields,
  );
  const context: CallableContext = {
    source,
    program,
    candidates,
    objectProjections,
    exactCallImplementations,
    exactContractImplementations,
    candidateSymbols: indexDeclarationSymbols(source, candidates),
    inputs,
    results,
    transports,
    builder: createEffectProvenanceGraphBuilder<CallableBoundaryReason>(),
    expressions: new Map(),
    declarations: new Map(),
    calls: new Map(),
    callImplementations: new Map(),
    candidateOrigins: new Set(),
    synchronousOrigins: new Set(),
    terminalOrigin: undefined,
    callableReferences: new Map(),
    returnedContracts: new Map(),
    dependents: new Map(),
    dependencies: new Map(),
    states: [],
  };
  forEachInvocationTransportInput(program, transports, (input) => {
    callableExpressionState(input, context);
  });
  planningObserver?.("effect-callable-transport-inputs");
  for (const property of objectProjections?.properties ?? []) {
    const callable = property.initializers.some((initializer) => {
      const semantics = source.semantics.forNode(initializer);
      const type = semantics.types.expressionType(initializer);
      return type !== undefined && typeMayBeCallable(semantics, type);
    });
    if (callable) {
      for (const initializer of property.initializers) {
        callableExpressionState(initializer, context);
      }
      for (const read of objectProjections?.readsForInitializer(
        property.initializers[0]!,
      ) ?? []) {
        callableExpressionState(read, context);
      }
    }
  }
  planningObserver?.("effect-callable-object-projections");
  for (const call of program.nodesOfKind(KindCallExpression)) {
    callableExpressionState(call, context);
  }
  planningObserver?.("effect-callable-calls");
  connectSynchronousCallableBodies(
    context,
    (declaration) => callableDeclarationState(declaration, context),
  );
  planningObserver?.("effect-callable-bodies");
  const callContractStates = collectCallReturnContractStates(context);
  const contractStates = inputs.contracts.map((contract) => ({
    rewrite: contract.returnType,
    state: mergeDeclarations(
      contract.returnType.target,
      contract.extractedDeclarations,
      context,
      (declaration) => callableDeclarationState(declaration, context),
    ),
    sources: Object.freeze(contract.extractedDeclarations.flatMap(
      (declaration) => inputs.valuesFor(declaration) ?? [],
    )),
  }));
  const storageContractStates = inputs.storageContracts.flatMap((contract) => {
    const occurrence = contract.returnTypes[0]?.target ?? contract.declarations[0];
    if (occurrence === undefined) {
      return [];
    }
    const state = mergeDeclarations(
      occurrence,
      contract.declarations,
      context,
      (declaration) => callableDeclarationState(declaration, context),
    );
    const sources = Object.freeze(contract.declarations.flatMap(
      (declaration) => inputs.valuesFor(declaration) ?? [],
    ));
    return contract.returnTypes.map((rewrite) => ({ rewrite, state, sources }));
  });
  planningObserver?.("effect-callable-contracts", {
    contracts: callContractStates.length + contractStates.length +
      storageContractStates.length,
  });
  const graph = context.builder.seal();
  planningObserver?.("effect-callable-graph", {
    boundaries: graph.boundaries.length,
    edges: graph.edges.length,
    origins: graph.origins.length,
    vertices: graph.vertices.length,
  });
  const resolved = resolveEffectProvenance(graph);
  planningObserver?.("effect-callable-resolution");
  const origins = createEffectProvenanceOriginIndex(
    graph,
    resolved,
    [
      selectOriginOccurrences(context.candidateOrigins),
      selectOriginOccurrences(context.synchronousOrigins),
    ],
  );
  planningObserver?.("effect-callable-origin-index");
  const resolutionByComponent = new Map<number, CallableValueResolution>();
  const resolutionForState = (state: CallableState): CallableValueResolution => {
    const component = resolved.componentFor(state.vertex);
    const existing = resolutionByComponent.get(component);
    if (existing !== undefined) {
      return existing;
    }
    const result = resolved.resolutionFor(state.vertex);
    const resolution = createExactCallableValueResolution(
      result.closed,
      origins.selectionFor(state.vertex, 0),
      origins.selectionFor(state.vertex, 1),
    );
    resolutionByComponent.set(component, resolution);
    return resolution;
  };
  const unsafeCallableUses = collectUnsafeCallableUses(context, resolved);
  planningObserver?.("effect-callable-unsafe-uses");
  const expressionResolution = (
    expression: Node,
  ): CallableValueResolution | undefined => {
    const root = transparentExpression(source, expression) ?? expression;
    const state = context.expressions.get(root);
    return state === undefined || unsafeCallableUses.has(state)
      ? undefined
      : resolutionForState(state);
  };
  const callResolutions = new Map<Node, CallableValueResolution>();
  for (const [call, state] of context.calls) {
    const resolution = resolutionForState(state);
    if (
      resolution.closed ||
      resolution.dependencyCount !== 0 ||
      resolution.synchronousDeclarationCount !== 0
    ) {
      callResolutions.set(call, resolution);
    }
  }
  planningObserver?.("effect-callable-call-resolutions");
  const returnTypes = new Map<Node, MutableCallableReturnContract>();
  for (const { rewrite, state, sources } of [
    ...contractStates.map((contract) => ({
      ...contract,
      sources: contract.sources.map((expression) => ({
        expression,
        kind: "callable-value" as const,
      })),
    })),
    ...storageContractStates.map((contract) => ({
      ...contract,
      sources: contract.sources.map((expression) => ({
        expression,
        kind: "callable-value" as const,
      })),
    })),
    ...callContractStates.flatMap(({ returnTypes, state, sources }) =>
      returnTypes.map((rewrite) => ({
        rewrite,
        state,
        sources,
      }))
    ),
    ...[...context.returnedContracts.values()].flatMap(({
      returnTypes,
      state,
      sources,
    }) =>
      returnTypes.map((rewrite) => ({
        rewrite,
        state,
        sources: sources.map((expression) => ({
          expression,
          kind: "callable-value" as const,
        })),
      }))
    ),
  ]) {
    appendReturnTypeContract(returnTypes, rewrite, state, sources);
  }
  const signatureFamilies = Object.freeze(contractStates.flatMap(({ state }) => {
    const resolution = resolutionForState(state);
    return resolution.closed && resolution.dependencyCount !== 0
      ? [Object.freeze([...resolution.dependencyNodes()])]
      : [];
  }));
  const closedCallableReferences = new Set(
    [...context.callableReferences].flatMap(([reference, state]) =>
      unsafeCallableUses.has(state) ? [] : [reference]
    ),
  );
  const settledReturnContracts: readonly SettledCallableReturnContract[] = Object.freeze(
    [...returnTypes.values()].map(({ rewrite, states, sources }) => Object.freeze({
      rewrite,
      resolutions: Object.freeze(states.map(resolutionForState)),
      sourceRequirements: Object.freeze(sources.map(({ expression, kind }) =>
        callableContractSourceRequirement(
          expression,
          kind,
          context,
          callResolutions,
          expressionResolution,
        )
      )),
    })),
  );
  const callContractRequirements = new Map([...callResolutions.keys()].map(
    (call) => [
      call,
      callableCallContractRequirement(
        call,
        context,
        callResolutions,
        expressionResolution,
      ),
    ] as const,
  ));
  planningObserver?.("effect-callable-finalization", {
    boundaries: settledReturnContracts.filter((contract) =>
      contract.sourceRequirements.some((requirement) => !requirement.resolvable)
    ).length,
    closed: settledReturnContracts.filter((contract) =>
      contract.resolutions.every((resolution) => resolution.closed)
    ).length,
    contracts: settledReturnContracts.length,
  });
  return finalizeGraphCallableValueFlow(
    signatureFamilies,
    callResolutions,
    closedCallableReferences,
    settledReturnContracts,
    callContractRequirements,
    callableReferenceIsClosed,
  );
}
