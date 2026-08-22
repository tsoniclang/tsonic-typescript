import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "../../../../program-index.js";
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
  exactValueSlotPathKey,
  exactValueSlotPathIsReadonly,
  exactValueSlotRead,
  isExactObjectSpreadContainerReference,
} from "./selectors.js";

type ValueSlotBoundaryReason = "open-slot";

interface ValueSlotState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
}

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
  readonly expressions: Map<Node, Map<string, ValueSlotState>>;
  readonly results: Map<Node, Map<string, ValueSlotState>>;
  readonly resultInputs: Map<Node, readonly (Node | undefined)[]>;
  readonly resultContracts: Map<Node, readonly Node[]>;
  readonly valueOrigins: Map<number, Set<Node>>;
  readonly steps: Map<number, ExactValueSlotStep>;
}

export function createExactValueSlotFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  sourceForCall: (call: Node) => ExactValueSlotCallSource | undefined,
  invocationInputs?: ExactInvocationInputIndex,
  rootExpressions: readonly Node[] = Object.freeze([]),
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
  const bindingProjections = createExactValueBindingProjectionIndex(
    source,
    program,
    invocationInputs,
  );
  const context: ValueSlotContext = {
    source,
    projections,
    sourceForCall,
    bindings,
    bindingProjections,
    builder: createEffectProvenanceGraphBuilder<ValueSlotBoundaryReason>(),
    expressions: new Map(),
    results: new Map(),
    resultInputs: new Map(),
    resultContracts: new Map(),
    valueOrigins: new Map(),
    steps: new Map(),
  };
  const roots = new Map<Node, ValueSlotState>();
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
        ),
      );
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
        ),
      );
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
        ),
      );
    }
  }
  const resolutions = resolveEffectProvenance(context.builder.seal());
  const resolved = new Map<Node, ExactValueSlotResolution>();
  for (const [expression, state] of roots) {
    const resolution = resolutions.resolutionFor(state.vertex);
    const values = new Set<Node>();
    const steps = new Map<number, ExactValueSlotStep>();
    for (const evidence of resolution.originEvidence) {
      for (const value of context.valueOrigins.get(evidence.vertex.index) ?? []) {
        values.add(value);
      }
      const step = context.steps.get(evidence.vertex.index);
      if (step !== undefined) {
        steps.set(evidence.vertex.index, step);
      }
    }
    resolved.set(expression, Object.freeze({
      closed: resolution.closed,
      expressions: Object.freeze([...values]),
      steps: Object.freeze([...steps.values()]),
    }));
  }
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
  const state = selectedState(context.expressions, root, path, context);
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  expandExpression(state, root, path, context);
  return state;
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
  const state = selectedState(context.expressions, reference, path, context);
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  addBindingProjectionDependencies(state, reference, sources, path, context);
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
  const contracts = Object.freeze(source.contracts ?? [source.declaration]);
  const previousInputs = context.resultInputs.get(source.declaration);
  if (previousInputs === undefined) {
    context.resultInputs.set(source.declaration, source.expressions);
    context.resultContracts.set(source.declaration, contracts);
  } else {
    assertSameValues("inputs", source.declaration, previousInputs, source.expressions);
    assertSameValues(
      "contracts",
      source.declaration,
      context.resultContracts.get(source.declaration) ?? [],
      contracts,
    );
  }
  context.steps.set(state.vertex.index, Object.freeze({
    declaration: source.declaration,
    contracts,
    invocation: call,
    path,
  }));
  context.builder.addOrigin(state.vertex, call);
  context.builder.addDependency(
    state.vertex,
    stateForResult(source.declaration, source.expressions, path, context).vertex,
    "return",
    call,
  );
}

function stateForResult(
  declaration: Node,
  expressions: readonly (Node | undefined)[],
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): ValueSlotState {
  const state = selectedState(context.results, declaration, path, context);
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  for (const expression of expressions) {
    if (expression === undefined) {
      boundary(state, declaration, context);
    } else {
      dependency(state, expression, path, declaration, context);
    }
  }
  return state;
}

function selectedState(
  states: Map<Node, Map<string, ValueSlotState>>,
  occurrence: Node,
  path: ExactValueSlotPath,
  context: ValueSlotContext,
): ValueSlotState {
  let selected = states.get(occurrence);
  if (selected === undefined) {
    selected = new Map();
    states.set(occurrence, selected);
  }
  const key = exactValueSlotPathKey(path);
  let state = selected.get(key);
  if (state === undefined) {
    state = {
      vertex: context.builder.vertex("value-slot", occurrence),
      expanded: false,
    };
    selected.set(key, state);
  }
  return state;
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
): void {
  context.builder.addBoundary(state.vertex, "open-slot", occurrence);
}

function assertSameValues(
  kind: string,
  declaration: Node,
  left: readonly (Node | undefined)[],
  right: readonly (Node | undefined)[],
): void {
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new Error(
      `value slot ${kind} disagreed for declaration ${String(declaration)}`,
    );
  }
}
