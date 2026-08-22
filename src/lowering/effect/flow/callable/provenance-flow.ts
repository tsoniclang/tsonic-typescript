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
import { createExactValueSlotFlow } from "../value/slot/flow.js";
import type { ExactValueSlotFlow } from "../value/slot/model.js";
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
import {
  allCallableDependenciesAreOptimized,
  createCallableValueResolution,
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
}

interface SettledReturnContract {
  readonly rewrite: CallableReturnRewrite;
  readonly resolutions: readonly CallableValueResolution[];
}

export interface CallableContext {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly candidates: ReadonlySet<Node>;
  readonly objectProjections: ExactObjectPropertyProjectionIndex | undefined;
  readonly slots: ExactValueSlotFlow;
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
  readonly candidateOrigins: Set<Node>;
  readonly synchronousOrigins: Set<Node>;
  terminalOrigin: Node | undefined;
  readonly callableReferences: Map<Node, CallableState>;
  readonly returnedContracts: Map<Node, ReturnContractState>;
  readonly dependents: Map<CallableState, Set<CallableState>>;
  readonly dependencies: Map<CallableState, Set<CallableState>>;
  readonly states: CallableState[];
}

export interface GraphCallableValueFlow {
  readonly signatureFamilies: readonly (readonly Node[])[];
  forEachCall(
    visitor: (call: Node, resolution: CallableValueResolution) => void,
  ): void;
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  allowsCallableReference(node: Node): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
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
  const results = createCallableResultInputs(
    source,
    program,
    projections,
    candidates,
    exactCallImplementations,
    invocationInputs,
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
  const slots = createExactValueSlotFlow(
    source,
    program,
    projections,
    (call) => {
      const transported = invocationTransportResultOrigins(call, transports);
      if (transported !== undefined) {
        return Object.freeze({
          declaration: call,
          contracts: Object.freeze([]),
          expressions: Object.freeze([...transported]),
        });
      }
      return results.sourceFor(call);
    },
    invocationInputs,
  );
  const context: CallableContext = {
    source,
    program,
    candidates,
    objectProjections,
    slots,
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
  for (const call of program.nodesOfKind(KindCallExpression)) {
    callableExpressionState(call, context);
  }
  connectSynchronousCallableBodies(
    context,
    (declaration) => callableDeclarationState(declaration, context),
  );
  const contractStates = inputs.contracts.map((contract) => ({
    rewrite: contract.returnType,
    state: mergeDeclarations(
      contract.returnType.target,
      contract.extractedDeclarations,
      context,
      (declaration) => callableDeclarationState(declaration, context),
    ),
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
    return contract.returnTypes.map((rewrite) => ({ rewrite, state }));
  });
  const graph = context.builder.seal();
  const resolved = resolveEffectProvenance(graph);
  const resolutionForState = (state: CallableState): CallableValueResolution => {
    const result = resolved.resolutionFor(state.vertex);
    const dependencies = result.origins.filter((origin) =>
      context.candidateOrigins.has(origin)
    );
    const synchronous = result.origins.filter((origin) =>
      context.synchronousOrigins.has(origin)
    );
    return createCallableValueResolution(
      result.closed,
      dependencies,
      synchronous,
    );
  };
  const unsafeCallableUses = collectUnsafeCallableUses(context, resolved);
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
  const returnTypes = new Map<Node, MutableCallableReturnContract>();
  for (const { rewrite, state } of [
    ...contractStates,
    ...storageContractStates,
    ...[...context.returnedContracts.values()].flatMap(({ returnTypes, state }) =>
      returnTypes.map((rewrite) => ({ rewrite, state }))
    ),
  ]) {
    appendReturnTypeContract(returnTypes, rewrite, state);
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
  const settledReturnContracts: readonly SettledReturnContract[] = Object.freeze(
    [...returnTypes.values()].map(({ rewrite, states }) => Object.freeze({
      rewrite,
      resolutions: Object.freeze(states.map(resolutionForState)),
    })),
  );
  return Object.freeze({
    signatureFamilies,
    forEachCall(
      visitor: (call: Node, resolution: CallableValueResolution) => void,
    ): void {
      for (const [call, resolution] of callResolutions) {
        visitor(call, resolution);
      }
    },
    resolutionFor(call: Node | undefined): CallableValueResolution | undefined {
      return call === undefined ? undefined : callResolutions.get(call);
    },
    allowsCallableReference(node: Node): boolean {
      return callableReferenceIsClosed?.(node) === true ||
        closedCallableReferences.has(node);
    },
    settledReturnTypes(
      optimized: ReadonlySet<Node>,
    ): readonly CallableReturnRewrite[] {
      return Object.freeze(settledReturnContracts.flatMap(
        ({ rewrite, resolutions }) =>
          resolutions.every((resolution) => {
            return resolution.closed &&
              allCallableDependenciesAreOptimized(resolution, optimized);
          })
            ? [rewrite]
            : [],
      ));
    },
  });
}
