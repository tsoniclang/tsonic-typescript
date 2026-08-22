import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import type { InvocationTransportContract } from "../../../../invocation-transport.js";
import {
  createEffectProvenanceGraphBuilder,
} from "../../../provenance/graph.js";
import type {
  EffectProvenanceEdgeKind,
  EffectProvenanceVertex,
  EffectProvenanceVertexKind,
} from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../../object/projection.js";
import {
  directContainingCall,
  isModuleForwardingReference,
} from "../../../model/syntax.js";
import {
  containingResultConsumerFunction,
  exactResultConsumerBindingPattern,
  exactResultConsumerAssignmentBindings,
  indexResultProjectionReads,
  indexResultConsumerCalls,
  isInspectableResultForwarder,
  isTransparentResultConsumerParent,
  resultConsumerBindingIsClosed,
  resultConsumerBindingKind,
  resultConsumerDeclarationInitializer,
  resultConsumerProjectionReceiver,
  resultConsumerStorageOwners,
  selectedResultConsumerBinding,
} from "./facts.js";

type ResultConsumerBoundary =
  | "open-binding"
  | "open-consumer"
  | "open-forwarder"
  | "open-reference"
  | "open-storage";

interface ConsumerState {
  readonly vertex: EffectProvenanceVertex;
  readonly kind: "value" | "binding" | "result";
  readonly occurrence: Node;
  expanded: boolean;
}

interface ConsumerContext {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly candidates: ReadonlySet<Node>;
  readonly callableReferenceIsClosed: ((reference: Node) => boolean) | undefined;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly projections: ExactAggregateProjectionIndex;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly closedStorageOwners: ReadonlySet<Node>;
  readonly callsByDeclaration: ReadonlyMap<Node, readonly Node[]>;
  readonly projectionOrigins: ReadonlyMap<Node, readonly Node[]>;
  readonly projectionInvocations: ReadonlyMap<Node, readonly Node[]>;
  readonly projectionReads: ReadonlySet<Node>;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<ResultConsumerBoundary>
  >;
  readonly values: Map<Node, ConsumerState>;
  readonly bindings: Map<Node, ConsumerState>;
  readonly results: Map<Node, ConsumerState>;
  readonly pending: ConsumerState[];
  consumerEdges: number;
}

export interface ResultConsumerGraph {
  readonly ownerEvaluations: number;
  readonly consumerEdges: number;
  callHasClosedConsumers(call: Node): boolean;
}

export function createResultConsumerGraph(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  invocationInputs: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  exactCallImplementations?: (call: Node) => readonly Node[] | undefined,
  transports?: InvocationTransportContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): ResultConsumerGraph {
  const projectionReads = indexResultProjectionReads(
    source,
    program,
    projections,
    invocationInputs,
    exactCallImplementations,
    transports,
  );
  const context: ConsumerContext = {
    source,
    program,
    candidates,
    callableReferenceIsClosed,
    invocationInputs,
    projections,
    objectProjections,
    closedStorageOwners: resultConsumerStorageOwners(source, program),
    callsByDeclaration: indexResultConsumerCalls(
      source,
      program,
      exactCallImplementations,
    ),
    projectionOrigins: projectionReads.origins,
    projectionInvocations: projectionReads.invocations,
    projectionReads: projectionReads.reads,
    builder: createEffectProvenanceGraphBuilder<ResultConsumerBoundary>(),
    values: new Map(),
    bindings: new Map(),
    results: new Map(),
    pending: [],
    consumerEdges: 0,
  };
  for (const call of program.nodesOfKind(KindCallExpression)) {
    valueState(call, context);
  }
  while (context.pending.length !== 0) {
    const state = context.pending.pop();
    if (state === undefined || state.expanded) {
      continue;
    }
    state.expanded = true;
    if (state.kind === "value") {
      expandValue(state, context);
    } else if (state.kind === "binding") {
      expandBinding(state, context);
    } else {
      expandResult(state, context);
    }
  }
  const resolution = resolveEffectProvenance(context.builder.seal());
  return Object.freeze({
    ownerEvaluations: context.results.size,
    consumerEdges: context.consumerEdges,
    callHasClosedConsumers(call: Node): boolean {
      const state = context.values.get(call);
      return state !== undefined && resolution.resolutionFor(state.vertex).closed;
    },
  });
}

function valueState(expression: Node, context: ConsumerContext): ConsumerState {
  return stateFor("value", "expression", expression, context.values, context);
}

function bindingState(declaration: Node, context: ConsumerContext): ConsumerState {
  return stateFor(
    "binding",
    resultConsumerBindingKind(context.source, declaration),
    declaration,
    context.bindings,
    context,
  );
}

function resultState(declaration: Node, context: ConsumerContext): ConsumerState {
  return stateFor("result", "result", declaration, context.results, context);
}

function stateFor(
  kind: ConsumerState["kind"],
  vertexKind: EffectProvenanceVertexKind,
  occurrence: Node,
  states: Map<Node, ConsumerState>,
  context: ConsumerContext,
): ConsumerState {
  let state = states.get(occurrence);
  if (state === undefined) {
    state = {
      vertex: context.builder.vertex(vertexKind, occurrence),
      kind,
      occurrence,
      expanded: false,
    };
    states.set(occurrence, state);
    context.pending.push(state);
  }
  return state;
}

function expandValue(state: ConsumerState, context: ConsumerContext): void {
  const { source } = context;
  const projectedReads = context.projectionInvocations.get(state.occurrence);
  if (projectedReads !== undefined) {
    if (projectedReads.length === 0) {
      origin(state, state.occurrence, context);
    }
    for (const read of projectedReads) {
      dependency(
        state,
        valueState(read, context),
        "projection",
        read,
        context,
      );
    }
    return;
  }
  let current = state.occurrence;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      boundary(state, "open-consumer", current, context);
      return;
    }
    if (isTransparentResultConsumerParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsAwaitExpression(parent)) {
      if (source.ast.as.AsAwaitExpression(parent)?.Expression === current) {
        origin(state, parent, context);
      } else {
        boundary(state, "open-consumer", parent, context);
      }
      return;
    }
    if (source.ast.is.IsExpressionStatement(parent)) {
      origin(state, parent, context);
      return;
    }
    if (source.ast.is.IsVoidExpression(parent)) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsReturnStatement(parent)) {
      consumeReturn(state, parent, context);
      return;
    }
    if (
      source.ast.is.IsArrowFunction(parent) &&
      source.ast.body(parent) === current
    ) {
      consumeCallableReturn(state, parent, parent, context);
      return;
    }
    if (source.ast.is.IsVariableDeclaration(parent)) {
      const initializer = source.ast.as.AsVariableDeclaration(parent)?.Initializer;
      if (
        initializer === current &&
        source.ast.is.IsIdentifier(source.ast.name(parent))
      ) {
        dependency(state, bindingState(parent, context), "assignment", parent, context);
      } else if (initializer === current) {
        const bindings = exactResultConsumerBindingPattern(source, parent);
        if (bindings === undefined) {
          boundary(state, "open-binding", parent, context);
          return;
        }
        if (bindings.length === 0) {
          origin(state, parent, context);
        }
        for (const binding of bindings) {
          dependency(
            state,
            bindingState(binding, context),
            "projection",
            binding,
            context,
          );
        }
      } else {
        boundary(state, "open-binding", parent, context);
      }
      return;
    }
    if (
      source.ast.is.IsPropertyDeclaration(parent) ||
      source.ast.is.IsParameterDeclaration(parent)
    ) {
      if (resultConsumerDeclarationInitializer(source, parent) === current) {
        consumeBindingDestination(state, parent, parent, context);
      } else {
        boundary(state, "open-binding", parent, context);
      }
      return;
    }
    if (source.ast.is.IsConditionalExpression(parent)) {
      const conditional = source.ast.as.AsConditionalExpression(parent);
      if (conditional?.WhenTrue === current || conditional?.WhenFalse === current) {
        current = parent;
        continue;
      }
      boundary(state, "open-consumer", parent, context);
      return;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      const operator = source.ast.operatorKindName(parent);
      if (
        operator === "KindQuestionQuestionToken" ||
        operator === "KindBarBarToken" ||
        operator === "KindAmpersandAmpersandToken"
      ) {
        if (binary?.Right === current) {
          current = parent;
          continue;
        }
        boundary(state, "open-consumer", parent, context);
        return;
      }
      if (operator === "KindCommaToken") {
        if (binary?.Left === current) {
          origin(state, current, context);
          return;
        }
        if (binary?.Right === current) {
          current = parent;
          continue;
        }
      }
      if (operator === "KindEqualsToken" && binary?.Right === current) {
        const destinations = binary.Left === undefined
          ? undefined
          : exactResultConsumerAssignmentBindings(source, binary.Left);
        if (destinations === undefined) {
          boundary(state, "open-binding", parent, context);
          return;
        }
        if (destinations.length === 0) {
          origin(state, parent, context);
        }
        for (const destination of destinations) {
          consumeBindingDestination(state, destination, parent, context);
        }
        current = parent;
        continue;
      }
      boundary(state, "open-consumer", parent, context);
      return;
    }
    if (
      source.ast.is.IsCallExpression(parent) ||
      source.ast.is.IsNewExpression(parent)
    ) {
      const target = source.ast.is.IsCallExpression(parent)
        ? source.ast.as.AsCallExpression(parent)?.Expression
        : source.ast.as.AsNewExpression(parent)?.Expression;
      if (target === current) {
        boundary(state, "open-consumer", parent, context);
        return;
      }
      consumeArgument(state, current, parent, context);
      return;
    }
    if (source.ast.is.IsArrayLiteralExpression(parent)) {
      consumeAggregateElement(state, current, context);
      return;
    }
    if (
      (source.ast.is.IsPropertyAccessExpression(parent) ||
        source.ast.is.IsElementAccessExpression(parent)) &&
      context.projectionReads.has(parent) &&
      resultConsumerProjectionReceiver(source, parent) === current
    ) {
      dependency(state, valueState(parent, context), "projection", parent, context);
      return;
    }
    if (
      source.ast.is.IsPropertyAssignment(parent) &&
      source.ast.as.AsPropertyAssignment(parent)?.Initializer === current
    ) {
      consumeObjectProperty(state, current, context);
      return;
    }
    if (
      source.ast.is.IsShorthandPropertyAssignment(parent) &&
      source.ast.name(parent) === current
    ) {
      consumeObjectProperty(state, current, context);
      return;
    }
    boundary(state, "open-consumer", parent, context);
    return;
  }
}

function consumeObjectProperty(
  state: ConsumerState,
  initializer: Node,
  context: ConsumerContext,
): void {
  const direct = context.objectProjections.readsForInitializer(initializer);
  const returned = context.projectionOrigins.get(initializer);
  if (direct === undefined && returned === undefined) {
    boundary(state, "open-consumer", initializer, context);
    return;
  }
  const reads = new Set([...(direct ?? []), ...(returned ?? [])]);
  if (reads.size === 0) {
    origin(state, initializer, context);
    return;
  }
  for (const read of reads) {
    dependency(state, valueState(read, context), "field", read, context);
  }
}

function expandBinding(state: ConsumerState, context: ConsumerContext): void {
  const declaration = state.occurrence;
  if (
    context.source.ast.is.IsParameterDeclaration(declaration) &&
    !context.invocationInputs.isClosed(declaration)
  ) {
    boundary(state, "open-binding", declaration, context);
    return;
  }
  if (!resultConsumerBindingIsClosed(
    context.source,
    declaration,
    context.closedStorageOwners,
  )) {
    boundary(state, "open-binding", declaration, context);
    return;
  }
  const writes = new Map(
    context.program.bindingWritesFor(declaration).map((write) => [
      write.reference,
      write,
    ]),
  );
  let consumers = 0;
  for (const reference of context.source.navigation.referencesToDeclaration(declaration)) {
    if (isModuleForwardingReference(context.source, reference)) {
      boundary(state, "open-reference", reference, context);
      continue;
    }
    const write = writes.get(reference);
    if (write !== undefined) {
      if (
        write.kind !== "assignment" ||
        context.source.ast.operatorKindName(write.operation) !== "KindEqualsToken"
      ) {
        boundary(state, "open-reference", reference, context);
      }
      continue;
    }
    consumers += 1;
    dependency(state, valueState(reference, context), "alias", reference, context);
  }
  if (consumers === 0) {
    origin(state, declaration, context);
  }
}

function expandResult(state: ConsumerState, context: ConsumerContext): void {
  const declaration = state.occurrence;
  if (!isInspectableResultForwarder(
    context.source,
    context.program,
    declaration,
  )) {
    boundary(state, "open-forwarder", declaration, context);
    return;
  }
  const calls = context.callsByDeclaration.get(declaration) ?? [];
  const selectedCalls = new Set(calls);
  const references = context.source.navigation.referencesToDeclaration(declaration);
  if (references.some((reference) => {
    if (isModuleForwardingReference(context.source, reference)) {
      return true;
    }
    const call = directContainingCall(context.source, reference);
    return (call === undefined || !selectedCalls.has(call)) &&
      context.callableReferenceIsClosed?.(reference) !== true;
  })) {
    boundary(state, "open-reference", declaration, context);
    return;
  }
  if (calls.length === 0) {
    origin(state, declaration, context);
    return;
  }
  for (const call of calls) {
    dependency(state, valueState(call, context), "result-consumption", call, context);
  }
}

function consumeReturn(
  state: ConsumerState,
  statement: Node,
  context: ConsumerContext,
): void {
  const owner = containingResultConsumerFunction(context.source, statement);
  if (owner === undefined) {
    boundary(state, "open-consumer", statement, context);
    return;
  }
  consumeCallableReturn(state, owner, statement, context);
}

function consumeCallableReturn(
  state: ConsumerState,
  owner: Node,
  occurrence: Node,
  context: ConsumerContext,
): void {
  if (context.candidates.has(owner)) {
    origin(state, occurrence, context);
  } else {
    dependency(state, resultState(owner, context), "return", occurrence, context);
  }
}

function consumeArgument(
  state: ConsumerState,
  argument: Node,
  invocation: Node,
  context: ConsumerContext,
): void {
  const parameters = context.invocationInputs.parametersFor(argument);
  if (parameters === undefined || parameters.length === 0) {
    boundary(state, "open-consumer", invocation, context);
    return;
  }
  for (const parameter of parameters) {
    dependency(state, bindingState(parameter, context), "argument", invocation, context);
  }
}

function consumeBindingDestination(
  state: ConsumerState,
  declaration: Node,
  occurrence: Node,
  context: ConsumerContext,
): void {
  if (!resultConsumerBindingIsClosed(
    context.source,
    declaration,
    context.closedStorageOwners,
  )) {
    boundary(state, "open-storage", occurrence, context);
    return;
  }
  dependency(state, bindingState(declaration, context), "assignment", occurrence, context);
}

function consumeAggregateElement(
  state: ConsumerState,
  element: Node,
  context: ConsumerContext,
): void {
  const reads = context.projectionOrigins.get(element);
  if (reads === undefined || reads.length === 0) {
    boundary(state, "open-consumer", element, context);
    return;
  }
  for (const read of reads) {
    dependency(state, valueState(read, context), "element", read, context);
  }
}

function dependency(
  destination: ConsumerState,
  source: ConsumerState,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: ConsumerContext,
): void {
  context.builder.addDependency(destination.vertex, source.vertex, kind, occurrence);
  context.consumerEdges += 1;
}

function origin(
  state: ConsumerState,
  occurrence: Node,
  context: ConsumerContext,
): void {
  context.builder.addOrigin(state.vertex, occurrence);
}

function boundary(
  state: ConsumerState,
  reason: ResultConsumerBoundary,
  occurrence: Node,
  context: ConsumerContext,
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}
