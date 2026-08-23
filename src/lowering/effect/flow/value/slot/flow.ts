import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "../../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import { transparentExpression } from "../../../model/syntax.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import { sameValueAlternatives } from "../alternatives.js";
import {
  createExactValueBindingInputs,
  type ExactValueBindingInputs,
} from "../binding-inputs.js";
import {
  createExactValueBindingProjectionIndex,
  type ExactValueBindingProjectionIndex,
} from "../binding-projection.js";
import type {
  ExactValueSlotCallSource,
  ExactValueSlotFlow,
  ExactValueSlotPath,
  ExactValueSlotResolution,
  ExactValueSlotStep,
} from "./model.js";
import {
  containingExactValueSlotRead,
  exactBindingSlotPath,
  exactObjectSlotContributors,
  exactValueSlotPathIsReadonly,
  exactValueSlotRead,
  isExactObjectSpreadContainerReference,
} from "./selectors.js";
import {
  createValueSlotActiveStates,
  createValueSlotStateRegistry,
  type ValueSlotActiveStates,
  type ValueSlotState,
  type ValueSlotStateRegistry,
  type ValueSlotWorkItem,
} from "./worklist.js";
import { materializeExactValueSlotResolutions } from "./resolution.js";

type ValueSlotBoundaryReason = "open-slot" | "recursive-slot";

interface ValueSlotContext {
  readonly source: TargetSourceProgram;
  readonly projections: ExactAggregateProjectionIndex;
  readonly sourceForCall: (
    call: Node,
  ) => ExactValueSlotCallSource | undefined;
  readonly bindings: ExactValueBindingInputs;
  readonly bindingProjections: ExactValueBindingProjectionIndex;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<ValueSlotBoundaryReason>
  >;
  readonly states: ValueSlotStateRegistry;
  readonly resultSources: Map<Node, ExactValueSlotCallSource>;
  readonly valueOrigins: Map<number, Set<Node>>;
  readonly steps: Map<number, ExactValueSlotStep>;
  readonly worklist: ValueSlotWorkItem[];
  readonly active: ValueSlotActiveStates;
}

export function createExactValueSlotFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  sourceForCall: (call: Node) => ExactValueSlotCallSource | undefined,
  invocationInputs: ExactInvocationInputIndex | undefined,
  rootExpressions: readonly Node[],
  planningObserver?: TypeScriptPlanningObserver,
): ExactValueSlotFlow {
  const bindings = createExactValueBindingInputs(
    source,
    program,
    invocationInputs,
    (reference, path) =>
      containingExactValueSlotRead(source, reference) !== undefined ||
      isExactObjectSpreadContainerReference(source, reference) ||
      exactInvocationInputIsClosed(reference, invocationInputs) ||
      exactValueSlotPathIsReadonly(source, reference, path),
  );
  planningObserver?.("effect-value-slot-bindings");
  const bindingProjections = createExactValueBindingProjectionIndex(
    source,
    program,
    invocationInputs,
  );
  planningObserver?.("effect-value-slot-binding-projections");
  const builder = createEffectProvenanceGraphBuilder<ValueSlotBoundaryReason>();
  const active = createValueSlotActiveStates();
  const context: ValueSlotContext = {
    source,
    projections,
    sourceForCall,
    bindings,
    bindingProjections,
    builder,
    states: createValueSlotStateRegistry(active, builder),
    resultSources: new Map(),
    valueOrigins: new Map(),
    steps: new Map(),
    worklist: [],
    active,
  };
  const roots = new Map<Node, EffectProvenanceVertex>();
  for (const expression of rootExpressions) {
    const projection = projections.projectionFor(expression);
    if (projection !== undefined) {
      roots.set(
        expression,
        stateForExpression(
          projection.source.initializer,
          Object.freeze([{
            kind: "element" as const,
            index: projection.index,
          }]),
          context,
        ).vertex,
      );
      drainValueSlotWorklist(context);
      continue;
    }
    const read = exactValueSlotRead(source, expression);
    if (read !== undefined) {
      roots.set(
        expression,
        stateForExpression(
          read.receiver,
          Object.freeze([read.selector]),
          context,
        ).vertex,
      );
      drainValueSlotWorklist(context);
      continue;
    }
    const binding = bindingProjections.projectionForReference(expression);
    const path = binding === undefined
      ? undefined
      : exactBindingSlotPath(source, binding.steps);
    if (binding !== undefined && path !== undefined) {
      roots.set(
        expression,
        stateForBindingProjection(
          expression,
          binding.sources,
          path,
          context,
        ).vertex,
      );
      drainValueSlotWorklist(context);
    }
  }
  planningObserver?.("effect-value-slot-roots", { roots: roots.size });
  const graph = context.builder.seal();
  planningObserver?.("effect-value-slot-graph", {
    boundaries: graph.boundaries.length,
    edges: graph.edges.length,
    origins: graph.origins.length,
    vertices: graph.vertices.length,
  });
  const resolutions = resolveEffectProvenance(graph);
  planningObserver?.("effect-value-slot-components", {
    components: resolutions.componentCount,
  });
  const resolved = materializeExactValueSlotResolutions(
    graph,
    resolutions,
    roots,
    context.valueOrigins,
    context.steps,
  );
  let closed = 0;
  let values = 0;
  let steps = 0;
  for (const resolution of resolved.values()) {
    if (resolution.closed) {
      closed += 1;
      values += resolution.expressions.length;
      steps += resolution.steps.length;
    }
  }
  planningObserver?.("effect-value-slot-resolution", {
    closed,
    roots: roots.size,
    steps,
    values,
  });
  return Object.freeze({
    resultFor(expression: Node): ExactValueSlotResolution | undefined {
      const root = transparentExpression(source, expression);
      return root === undefined ? undefined : resolved.get(root);
    },
  });
}

function exactInvocationInputIsClosed(
  expression: Node,
  invocationInputs: ExactInvocationInputIndex | undefined,
): boolean {
  if (invocationInputs === undefined) {
    return false;
  }
  const parameters = invocationInputs.parametersFor(expression);
  return parameters !== undefined && parameters.length !== 0 &&
    parameters.every((parameter) => invocationInputs.isClosed(parameter));
}

function stateForExpression(
  expression: Node,
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): ValueSlotState {
  if (path.length === 0) {
    throw new Error("value-slot flow requires a non-empty selector path");
  }
  const root = transparentExpression(context.source, expression) ?? expression;
  const state = context.states.select("expression", root, path);
  if (state.recursive) {
    boundary(state, root, context, "recursive-slot");
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  context.worklist.push({ kind: "expression", state, root, path });
  return state;
}

function drainValueSlotWorklist(context: ValueSlotContext): void {
  for (;;) {
    const item = context.worklist.pop();
    if (item === undefined) {
      return;
    }
    if (item.kind === "leave") {
      context.active.leave(item.state);
      continue;
    }
    context.active.enter(item.state, item.path);
    context.worklist.push({ kind: "leave", state: item.state });
    if (item.kind === "expression") {
      expandExpression(item.state, item.root, item.path, context);
    } else if (item.kind === "binding-projection") {
      addBindingProjectionDependencies(
        item.state,
        item.reference,
        item.sources,
        item.path,
        context,
      );
    } else {
      expandResult(
        item.state,
        item.resultOwner,
        item.expressions,
        item.path,
        context,
      );
    }
  }
}

function expandExpression(
  state: ValueSlotState,
  root: Node,
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): void {
  const { source } = context;
  const [selector, ...remaining] = path;
  if (selector === undefined) {
    throw new Error("value-slot flow lost its selector path");
  }
  if (
    selector.kind === "element" &&
    source.ast.is.IsArrayLiteralExpression(root)
  ) {
    expandArrayLiteral(state, root, selector.index, remaining, context);
    return;
  }
  if (
    selector.kind === "property" &&
    source.ast.is.IsObjectLiteralExpression(root)
  ) {
    expandObjectLiteral(state, root, selector, remaining, path, context);
    return;
  }
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === null) {
    boundary(state, root, context);
    return;
  }
  if (alternatives !== undefined) {
    for (const alternative of alternatives) {
      dependency(state, alternative, path, root, context);
    }
    return;
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    const expression = source.ast.as.AsAwaitExpression(root)?.Expression;
    if (expression === undefined) {
      boundary(state, root, context);
    } else {
      dependency(state, expression, path, root, context);
    }
    return;
  }
  const nested = exactValueSlotRead(source, root);
  if (nested !== undefined) {
    dependency(
      state,
      nested.receiver,
      Object.freeze([nested.selector, ...path]),
      root,
      context,
    );
    return;
  }
  if (source.ast.is.IsCallExpression(root)) {
    expandCall(state, root, path, context);
    return;
  }
  if (source.ast.is.IsIdentifier(root)) {
    const binding = context.bindingProjections.projectionForReference(root);
    const bindingPath = binding === undefined
      ? undefined
      : exactBindingSlotPath(source, binding.steps);
    if (binding !== undefined && bindingPath !== undefined) {
      addBindingProjectionDependencies(
        state,
        root,
        binding.sources,
        Object.freeze([...bindingPath, ...path]),
        context,
      );
      return;
    }
    const aggregate = context.projections.sourceForReference(root);
    if (aggregate !== undefined) {
      dependency(state, aggregate.initializer, path, root, context);
      return;
    }
    const inputs = context.bindings.inputsForReference(root, path);
    if (inputs !== undefined) {
      if (inputs.length === 0) {
        context.builder.addOrigin(state.vertex, root);
      }
      for (const input of inputs) {
        dependency(state, input, path, root, context);
      }
      return;
    }
  }
  boundary(state, root, context);
}

function expandArrayLiteral(
  state: ValueSlotState,
  root: Node,
  index: number,
  remaining: ExactValueSlotPath,
  context: ValueSlotContext,
): void {
  const selected = context.source.ast.elements(root)[index];
  if (selected === undefined) {
    context.builder.addOrigin(state.vertex, root);
  } else if (context.source.ast.is.IsSpreadElement(selected)) {
    boundary(state, root, context);
  } else if (remaining.length !== 0) {
    dependency(state, selected, remaining, root, context);
  } else {
    addValueOrigin(state, selected, context);
  }
}

function expandObjectLiteral(
  state: ValueSlotState,
  root: Node,
  selector: Extract<ExactValueSlotPath[number], { readonly kind: "property" }>,
  remaining: ExactValueSlotPath,
  fullPath: ExactValueSlotPath,
  context: ValueSlotContext,
): void {
  const contributors = exactObjectSlotContributors(
    context.source,
    root,
    selector,
  );
  if (contributors === null) {
    boundary(state, root, context);
    return;
  }
  if (contributors.length === 0) {
    context.builder.addOrigin(state.vertex, root);
    return;
  }
  for (const contributor of contributors) {
    if (contributor.kind === "container") {
      dependency(
        state,
        contributor.expression,
        Object.freeze([contributor.selector, ...remaining]),
        root,
        context,
      );
    } else if (remaining.length !== 0) {
      dependency(state, contributor.expression, remaining, root, context);
    } else {
      addValueOrigin(state, contributor.expression, context);
    }
  }
}

function stateForBindingProjection(
  reference: Node,
  sources: readonly Node[],
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): ValueSlotState {
  const state = context.states.select("expression", reference, path);
  if (state.recursive) {
    boundary(state, reference, context, "recursive-slot");
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  context.worklist.push({
    kind: "binding-projection",
    state,
    reference,
    sources,
    path,
  });
  return state;
}

function addBindingProjectionDependencies(
  state: ValueSlotState,
  reference: Node,
  sources: readonly Node[],
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): void {
  if (sources.length === 0) {
    context.builder.addOrigin(state.vertex, reference);
    return;
  }
  for (const source of sources) {
    dependency(state, source, path, reference, context);
  }
}

function expandCall(
  state: ValueSlotState,
  call: Node,
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): void {
  const source = context.sourceForCall(call);
  if (source === undefined || source.expressions.length === 0) {
    boundary(state, call, context);
    return;
  }
  const previous = context.resultSources.get(source.resultOwner);
  if (previous === undefined) {
    context.resultSources.set(source.resultOwner, source);
  } else {
    assertSameValues(
      "inputs",
      source.resultOwner,
      previous.expressions,
      source.expressions,
    );
    assertSameValues(
      "contracts",
      source.resultOwner,
      previous.contracts,
      source.contracts,
    );
  }
  context.steps.set(state.vertex.index, Object.freeze({
    resultOwner: source.resultOwner,
    contracts: source.contracts,
    invocation: call,
    path,
  }));
  context.builder.addOrigin(state.vertex, call);
  context.builder.addDependency(
    state.vertex,
    stateForResult(source.resultOwner, source.expressions, path, context).vertex,
    "return",
    call,
  );
}

function stateForResult(
  resultOwner: Node,
  expressions: readonly (Node | undefined)[],
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): ValueSlotState {
  const state = context.states.select("result", resultOwner, path);
  if (state.recursive) {
    boundary(state, resultOwner, context, "recursive-slot");
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  context.worklist.push({
    kind: "result",
    state,
    resultOwner,
    expressions,
    path,
  });
  return state;
}

function expandResult(
  state: ValueSlotState,
  resultOwner: Node,
  expressions: readonly (Node | undefined)[],
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): void {
  for (const expression of expressions) {
    if (expression === undefined) {
      boundary(state, resultOwner, context);
    } else {
      dependency(state, expression, path, resultOwner, context);
    }
  }
}

function dependency(
  destination: ValueSlotState,
  expression: Node,
  path: ExactValueSlotPath,
  occurrence: Node,
  context: ValueSlotContext,
): void {
  context.builder.addDependency(
    destination.vertex,
    stateForExpression(expression, path, context).vertex,
    "projection",
    occurrence,
  );
}

function addValueOrigin(
  state: ValueSlotState,
  expression: Node,
  context: ValueSlotContext,
): void {
  const selected = context.valueOrigins.get(state.vertex.index);
  if (selected === undefined) {
    context.valueOrigins.set(state.vertex.index, new Set([expression]));
  } else {
    selected.add(expression);
  }
  context.builder.addOrigin(state.vertex, expression);
}

function boundary(
  state: ValueSlotState,
  occurrence: Node,
  context: ValueSlotContext,
  reason: ValueSlotBoundaryReason = "open-slot",
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}

function assertSameValues(
  kind: string,
  resultOwner: Node,
  left: readonly (Node | undefined)[],
  right: readonly (Node | undefined)[],
): void {
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new Error(
      `value slot ${kind} disagreed for result owner ${String(resultOwner)}`,
    );
  }
}
