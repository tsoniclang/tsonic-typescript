import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { EffectProvenanceVertexKind } from "../../../provenance/model.js";
import {
  directContainingCall,
  isModuleForwardingReference,
} from "../../../model/syntax.js";
import { isExactValueAssignmentOperator } from "../../storage/assignment.js";
import {
  containingResultConsumerFunction,
  exactResultConsumerAssignmentBindings,
  exactResultConsumerBindingPattern,
  isInspectableResultForwarder,
  isTransparentResultConsumerParent,
  resultConsumerBindingIsClosed,
  resultConsumerBindingKind,
  resultConsumerDeclarationInitializer,
  resultConsumerProjectionReceiver,
} from "./facts.js";
import type { ConsumerContext, ConsumerState } from "./model.js";
import {
  addConsumerBoundary as boundary,
  addConsumerDependency as dependency,
  addConsumerOrigin as origin,
} from "./edges.js";

export function createConsumerValueState(
  expression: Node,
  context: ConsumerContext,
): ConsumerState {
  return stateFor("value", "expression", expression, context.values, context);
}

export function expandConsumerState(
  state: ConsumerState,
  context: ConsumerContext,
): void {
  if (state.kind === "value") {
    expandValue(state, context);
  } else if (state.kind === "binding") {
    expandBinding(state, context);
  } else {
    expandResult(state, context);
  }
}

function bindingState(
  declaration: Node,
  context: ConsumerContext,
): ConsumerState {
  return stateFor(
    "binding",
    resultConsumerBindingKind(context.source, declaration),
    declaration,
    context.bindings,
    context,
  );
}

function resultState(
  declaration: Node,
  context: ConsumerContext,
): ConsumerState {
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
        createConsumerValueState(read, context),
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
      boundary(state, "open-consumer", parent, context);
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
        dependency(
          state,
          bindingState(parent, context),
          "assignment",
          parent,
          context,
        );
      } else if (initializer === current) {
        consumeBindingPattern(state, parent, context);
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
      const next = consumeBinaryValue(state, current, parent, context);
      if (next !== undefined) {
        current = next;
        continue;
      }
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
        if (context.callableReferenceIsClosed?.(current) === true) {
          origin(state, parent, context);
        } else {
          boundary(state, "open-consumer", parent, context);
        }
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
      dependency(
        state,
        createConsumerValueState(parent, context),
        "projection",
        parent,
        context,
      );
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

function consumeBindingPattern(
  state: ConsumerState,
  declaration: Node,
  context: ConsumerContext,
): void {
  const bindings = exactResultConsumerBindingPattern(context.source, declaration);
  if (bindings === undefined) {
    boundary(state, "open-binding", declaration, context);
    return;
  }
  if (bindings.length === 0) {
    origin(state, declaration, context);
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
}

function consumeBinaryValue(
  state: ConsumerState,
  current: Node,
  parent: Node,
  context: ConsumerContext,
): Node | undefined {
  const { source } = context;
  const binary = source.ast.as.AsBinaryExpression(parent);
  const operator = source.ast.operatorKindName(parent);
  if (
    operator === "KindQuestionQuestionToken" ||
    operator === "KindBarBarToken" ||
    operator === "KindAmpersandAmpersandToken"
  ) {
    if (binary?.Right === current) {
      return parent;
    }
    boundary(state, "open-consumer", parent, context);
    return undefined;
  }
  if (operator === "KindCommaToken") {
    if (binary?.Left === current) {
      boundary(state, "open-consumer", parent, context);
      return undefined;
    }
    if (binary?.Right === current) {
      return parent;
    }
  }
  if (isExactValueAssignmentOperator(operator) && binary?.Right === current) {
    const destinations = binary.Left === undefined
      ? undefined
      : exactResultConsumerAssignmentBindings(
          source,
          binary.Left,
          context.bodyInspectionIsCertified,
        );
    if (destinations === undefined) {
      boundary(state, "open-binding", parent, context);
      return undefined;
    }
    if (destinations.length === 0) {
      origin(state, parent, context);
    }
    for (const destination of destinations) {
      consumeBindingDestination(state, destination, parent, context);
    }
    return assignmentResultIsDiscarded(source, parent) ? undefined : parent;
  }
  boundary(state, "open-consumer", parent, context);
  return undefined;
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
    boundary(state, "open-consumer", initializer, context);
    return;
  }
  for (const read of reads) {
    dependency(
      state,
      createConsumerValueState(read, context),
      "field",
      read,
      context,
    );
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
    context.allowExportedDeclarations,
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
  for (
    const reference of context.source.navigation.referencesToDeclaration(
      declaration,
    )
  ) {
    if (isModuleForwardingReference(context.source, reference)) {
      if (
        !context.allowExportedDeclarations &&
        context.callableReferenceIsClosed?.(reference) !== true
      ) {
        boundary(state, "open-reference", reference, context);
      }
      continue;
    }
    const write = writes.get(reference);
    if (write !== undefined) {
      if (
        write.kind !== "assignment" ||
        !isExactValueAssignmentOperator(
          context.source.ast.operatorKindName(write.operation),
        )
      ) {
        boundary(state, "open-reference", reference, context);
      }
      continue;
    }
    consumers += 1;
    dependency(
      state,
      createConsumerValueState(reference, context),
      "alias",
      reference,
      context,
    );
  }
  if (consumers === 0) {
    boundary(state, "open-consumer", declaration, context);
  }
}

function assignmentResultIsDiscarded(
  source: TargetSourceProgram,
  assignment: Node,
): boolean {
  let current = assignment;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentResultConsumerParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsExpressionStatement(parent)) {
      return true;
    }
    if (
      source.ast.is.IsVoidExpression(parent) &&
      source.ast.as.AsVoidExpression(parent)?.Expression === current
    ) {
      return true;
    }
    if (!source.ast.is.IsBinaryExpression(parent)) {
      return false;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    if (source.ast.operatorKindName(parent) !== "KindCommaToken") {
      return false;
    }
    if (binary?.Left === current) {
      return true;
    }
    if (binary?.Right !== current) {
      return false;
    }
    current = parent;
  }
}

function expandResult(state: ConsumerState, context: ConsumerContext): void {
  const declaration = state.occurrence;
  if (!isInspectableResultForwarder(
    context.source,
    context.program,
    declaration,
    context.bodyInspectionIsCertified,
    context.allowExportedDeclarations,
  )) {
    boundary(state, "open-forwarder", declaration, context);
    return;
  }
  const calls = context.callsByDeclaration.get(declaration) ?? [];
  const selectedCalls = new Set(calls);
  const references = context.source.navigation.referencesToDeclaration(declaration);
  if (references.some((reference) => {
    if (isModuleForwardingReference(context.source, reference)) {
      return !context.allowExportedDeclarations &&
        context.callableReferenceIsClosed?.(reference) !== true;
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
    dependency(
      state,
      createConsumerValueState(call, context),
      "result-consumption",
      call,
      context,
    );
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
    dependency(
      state,
      bindingState(parameter, context),
      "argument",
      invocation,
      context,
    );
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
    context.allowExportedDeclarations,
  )) {
    boundary(state, "open-storage", occurrence, context);
    return;
  }
  dependency(
    state,
    bindingState(declaration, context),
    "assignment",
    occurrence,
    context,
  );
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
    dependency(
      state,
      createConsumerValueState(read, context),
      "element",
      read,
      context,
    );
  }
}
