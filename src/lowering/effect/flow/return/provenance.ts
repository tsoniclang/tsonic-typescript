import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { LoweredValueContract } from "../../../value-contract.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import {
  createEffectProvenanceGraphBuilder,
} from "../../provenance/graph.js";
import type {
  EffectProvenanceEdgeKind,
  EffectProvenanceVertex,
} from "../../provenance/model.js";
import { resolveEffectProvenance } from "../../provenance/resolution.js";
import {
  createEffectProvenanceOriginIndex,
  selectOriginOccurrences,
} from "../../provenance/origin-index.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";
import {
  isFunctionLike,
  transparentExpression,
} from "../../model/syntax.js";
import {
  callableContractResultIsDefinitelyNonThenable,
  resolvedCallResultIsDefinitelyNonThenable,
} from "../../model/synchronous.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import {
  createTypeScriptRuntimeReturnContract,
} from "../../../../runtime/return-contract.js";
import { createReturnLocalFlow } from "./local.js";
import { createReturnStorageFlow } from "./storage.js";
import { createReturnProjectionFlow } from "./projection.js";
import { sameValueAlternatives } from "../value/alternatives.js";
import {
  callableResultIsInspectable,
  staticallyNonThenable,
} from "./provenance/semantics.js";
import { parameterHasExternalInvocationSurface } from "../../model/declaration-surface.js";
import {
  finalizeReturnProvenanceFlow,
  type ReturnProvenanceFlow,
} from "./provenance/finalization.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import type { ReturnFlowQueries } from "./queries.js";

export type { ReturnProvenanceResolution } from "./provenance/resolution.js";

type ReturnBoundaryReason =
  | "inexact-call"
  | "inexact-parameter"
  | "open-binding"
  | "open-projection"
  | "thenable-contract"
  | "unresolved-value";

interface ReturnState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
}

export type { ReturnProvenanceFlow } from "./provenance/finalization.js";

interface ReturnContext {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly candidates: ReadonlySet<Node>;
  readonly directCallDeclaration: (call: Node) => Node | undefined;
  readonly settledCallDeclarations: (call: Node) => Iterable<Node>;
  readonly transports: InvocationTransportContract | undefined;
  readonly loweredValues: LoweredValueContract | undefined;
  readonly runtime: ReturnType<typeof createTypeScriptRuntimeReturnContract>;
  readonly locals: ReturnType<typeof createReturnLocalFlow>;
  readonly storage: ReturnType<typeof createReturnStorageFlow>;
  readonly projections: ReturnType<typeof createReturnProjectionFlow>;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly cooperativeEffects: TypeScriptActiveCooperativeEffectProfile;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<ReturnBoundaryReason>
  >;
  readonly expressions: Map<Node, ReturnState>;
  readonly declarations: Map<Node, ReturnState>;
  readonly candidateOrigins: Set<Node>;
  terminalOrigin: Node | undefined;
}

export function createReturnProvenanceFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  candidates: ReadonlySet<Node>,
  directCallDeclaration: (call: Node) => Node | undefined,
  invocationInputs: ExactInvocationInputIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  storageOwners: ClosedStorageOwnerAnalysis,
  queries: ReturnFlowQueries,
  loweredValues?: LoweredValueContract,
  settledCallDeclarations: (call: Node) => Iterable<Node> = () => [],
  transports?: InvocationTransportContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  planningObserver?: TypeScriptPlanningObserver,
): ReturnProvenanceFlow {
  let context: ReturnContext;
  const locals = createReturnLocalFlow(source, program, planningObserver);
  const storage = createReturnStorageFlow(
    source,
    program,
    invocationInputs,
    storageOwners,
    transports,
    (call) => {
      const selected = [...settledCallDeclarations(call)];
      return selected.length === 0 ? undefined : Object.freeze(selected);
    },
    callableReferenceIsClosed,
    planningObserver,
  );
  const projectionFlow = createReturnProjectionFlow(
    source,
    program,
    projections,
    (call) => {
      const direct = directCallDeclaration(call) ??
        resolveProjectInvocation(source, call)?.implementation;
      return new Set([
        ...(direct === undefined ? [] : [direct]),
        ...settledCallDeclarations(call),
      ]);
    },
    invocationInputs,
    queries.roots,
    locals,
    storage,
    storageOwners,
    objectProjections,
    transports,
    planningObserver,
  );
  context = {
    source,
    program,
    candidates,
    directCallDeclaration,
    settledCallDeclarations,
    transports,
    loweredValues,
    runtime: createTypeScriptRuntimeReturnContract(source),
    locals,
    storage,
    projections: projectionFlow,
    objectProjections,
    invocationInputs,
    cooperativeEffects,
    builder: createEffectProvenanceGraphBuilder<ReturnBoundaryReason>(),
    expressions: new Map(),
    declarations: new Map(),
    candidateOrigins: new Set(),
    terminalOrigin: undefined,
  };
  planningObserver?.("effect-return-inputs");
  const queryVertices = new Map<Node, EffectProvenanceVertex>();
  for (const expression of queries.roots) {
    inventoryQueryExpression(expression, context, queryVertices);
  }
  planningObserver?.("effect-return-inventory", { roots: queries.roots.length });
  const graph = context.builder.seal();
  planningObserver?.("effect-return-graph", {
    boundaries: graph.boundaries.length,
    edges: graph.edges.length,
    origins: graph.origins.length,
    vertices: graph.vertices.length,
  });
  const resolution = resolveEffectProvenance(graph);
  planningObserver?.("effect-return-resolution");
  const origins = createEffectProvenanceOriginIndex(
    graph,
    resolution,
    [selectOriginOccurrences(context.candidateOrigins)],
  );
  planningObserver?.("effect-return-origin-index");
  context.expressions.clear();
  context.declarations.clear();
  planningObserver?.("effect-return-finalization");
  return finalizeReturnProvenanceFlow(queryVertices, resolution, origins);
}

function inventoryQueryExpression(
  expression: Node,
  context: ReturnContext,
  queries: Map<Node, EffectProvenanceVertex>,
): void {
  const root = transparentExpression(context.source, expression) ?? expression;
  const vertex = stateForExpression(expression, context).vertex;
  queries.set(expression, vertex);
  queries.set(root, vertex);
}
function stateForExpression(
  expression: Node,
  context: ReturnContext,
): ReturnState {
  const root = transparentExpression(context.source, expression);
  const selected = root ?? expression;
  let state = context.expressions.get(selected);
  if (state === undefined) {
    state = newState("expression", selected, context);
    context.expressions.set(selected, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (root === undefined) {
    boundary(state, "unresolved-value", expression, context);
    return state;
  }
  expandExpression(state, root, context);
  return state;
}

function expandExpression(
  state: ReturnState,
  root: Node,
  context: ReturnContext,
): void {
  const { source } = context;
  if (staticallyNonThenable(source, root)) {
    origin(state, root, context);
    return;
  }
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === null) {
    boundary(state, "unresolved-value", root, context);
    return;
  }
  if (alternatives !== undefined) {
    for (const branch of alternatives) {
      dependency(
        state,
        stateForExpression(branch, context),
        "conditional",
        root,
        context,
      );
    }
    return;
  }
  if (context.runtime.callResultIsDefinitelyNonThenable(root)) {
    origin(state, root, context);
    return;
  }
  const loweredInputs: Node[] = [];
  const lowered = context.loweredValues?.isDefinitelyNonThenable(root, (input) => {
    loweredInputs.push(input);
    return true;
  });
  if (lowered === true) {
    if (loweredInputs.length === 0) {
      origin(state, root, context);
    } else {
      for (const input of loweredInputs) {
        dependency(state, stateForExpression(input, context), "projection", root, context);
      }
    }
    return;
  }
  if (source.ast.is.IsCallExpression(root)) {
    expandCall(state, root, context);
    return;
  }
  const projectionInputs: Node[] = [];
  const projected = context.projections.isDefinitelyNonThenable(root, (input) => {
    projectionInputs.push(input);
    return true;
  });
  if (projected) {
    if (projectionInputs.length === 0) {
      origin(state, root, context);
    } else {
      for (const input of projectionInputs) {
        dependency(state, stateForExpression(input, context), "projection", root, context);
      }
    }
    return;
  }
  const objectProperty = context.objectProjections.projectionFor(root);
  if (objectProperty !== undefined) {
    for (const initializer of objectProperty.initializers) {
      dependency(
        state,
        stateForExpression(initializer, context),
        "field",
        root,
        context,
      );
    }
    return;
  }
  const local = source.ast.is.IsIdentifier(root)
    ? context.locals.bindingFor(root)
    : undefined;
  const stored = context.storage.bindingFor(root);
  const binding = local ?? stored;
  if (binding !== undefined) {
    dependency(
      state,
      stateForBinding(binding.declaration, binding.inputs, context),
      "assignment",
      root,
      context,
    );
    return;
  }
  if (source.ast.is.IsIdentifier(root)) {
    const declaration = source.navigation.sourceReferenceFor(root)?.declaration;
    if (
      declaration !== undefined &&
      source.ast.is.IsParameterDeclaration(declaration)
    ) {
      dependency(
        state,
        stateForParameter(declaration, context),
        "argument",
        root,
        context,
      );
      return;
    }
  }
  boundary(state, "thenable-contract", root, context);
}

function expandCall(
  state: ReturnState,
  call: Node,
  context: ReturnContext,
): void {
  const { source } = context;
  const transport = context.transports?.transportFor(call);
  if (transport !== undefined) {
    const origins = transport.resultOriginExpressions;
    if (origins === undefined) {
      boundary(state, "inexact-call", call, context);
      return;
    }
    if (origins.length === 0) {
      origin(state, call, context);
      return;
    }
    for (const value of origins) {
      dependency(
        state,
        stateForExpression(value, context),
        "provider-transport",
        call,
        context,
      );
    }
    return;
  }
  if (resolvedCallResultIsDefinitelyNonThenable(source, call)) {
    origin(state, call, context);
    return;
  }
  const declarations = new Set<Node>();
  const directCandidate = context.directCallDeclaration(call);
  if (directCandidate !== undefined) {
    declarations.add(directCandidate);
  }
  for (const declaration of context.settledCallDeclarations(call)) {
    declarations.add(declaration);
  }
  const implementation = resolveProjectInvocation(source, call)?.implementation;
  if (implementation !== undefined) {
    declarations.add(implementation);
  }
  if (declarations.size === 0) {
    boundary(state, "inexact-call", call, context);
    return;
  }
  for (const declaration of declarations) {
    if (callableContractResultIsDefinitelyNonThenable(source, declaration)) {
      origin(state, declaration, context);
      continue;
    }
    if (context.candidates.has(declaration)) {
      context.candidateOrigins.add(declaration);
      context.builder.addOrigin(state.vertex, declaration);
    }
    dependency(
      state,
      stateForResult(declaration, context),
      "return",
      call,
      context,
    );
  }
}

function stateForResult(
  declaration: Node,
  context: ReturnContext,
): ReturnState {
  let state = context.declarations.get(declaration);
  if (state === undefined) {
    state = newState("result", declaration, context);
    context.declarations.set(declaration, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (!callableResultIsInspectable(
    context.source,
    context.program,
    context.candidates,
    declaration,
  )) {
    boundary(state, "inexact-call", declaration, context);
    return state;
  }
  const returns = exactCallableReturnExpressions(context.source, declaration);
  if (returns === undefined) {
    boundary(state, "inexact-call", declaration, context);
    return state;
  }
  if (returns.length === 0) {
    origin(state, declaration, context);
  }
  for (const expression of returns) {
    if (expression === undefined) {
      origin(state, declaration, context);
    } else {
      dependency(
        state,
        stateForExpression(expression, context),
        "return",
        declaration,
        context,
      );
    }
  }
  return state;
}

function stateForBinding(
  declaration: Node,
  inputs: readonly Node[],
  context: ReturnContext,
): ReturnState {
  let state = context.declarations.get(declaration);
  if (state === undefined) {
    state = newState("binding", declaration, context);
    context.declarations.set(declaration, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (inputs.length === 0) {
    origin(state, declaration, context);
  }
  for (const input of inputs) {
    dependency(
      state,
      stateForExpression(input, context),
      "assignment",
      declaration,
      context,
    );
  }
  return state;
}

function stateForParameter(
  parameter: Node,
  context: ReturnContext,
): ReturnState {
  let state = context.declarations.get(parameter);
  if (state === undefined) {
    state = newState("parameter", parameter, context);
    context.declarations.set(parameter, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  const inputs = context.invocationInputs.inputsFor(parameter);
  if (
    parameterHasExternalInvocationSurface(
      context.source,
      parameter,
      context.cooperativeEffects,
    ) ||
    inputs === undefined ||
    !context.invocationInputs.isClosed(parameter)
  ) {
    boundary(state, "inexact-parameter", parameter, context);
    return state;
  }
  if (inputs.length === 0) {
    origin(state, parameter, context);
    return state;
  }
  for (const input of inputs) {
    dependency(
      state,
      stateForExpression(input, context),
      "argument",
      parameter,
      context,
    );
  }
  return state;
}

function newState(
  kind: "binding" | "expression" | "parameter" | "result",
  occurrence: Node,
  context: ReturnContext,
): ReturnState {
  return {
    vertex: context.builder.vertex(kind, occurrence),
    expanded: false,
  };
}

function dependency(
  destination: ReturnState,
  source: ReturnState,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: ReturnContext,
): void {
  context.builder.addDependency(destination.vertex, source.vertex, kind, occurrence);
}

function origin(
  state: ReturnState,
  occurrence: Node,
  context: ReturnContext,
): void {
  context.terminalOrigin ??= occurrence;
  context.builder.addOrigin(state.vertex, context.terminalOrigin);
}

function boundary(
  state: ReturnState,
  reason: ReturnBoundaryReason,
  occurrence: Node,
  context: ReturnContext,
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}
