import type { Node } from "@tsonic/tsts";

import { transparentExpression } from "../../../model/syntax.js";
import {
  callableDeclarationAllowsSynchronousValue,
} from "../../../model/callable-contract/declarations.js";
import { sameValueAlternatives } from "../alternatives.js";
import {
  exactBindingSlotPath,
  exactObjectSlotContributors,
  exactValueSlotRead,
} from "./selectors.js";
import type {
  ExactValueSlotPath,
  ExactValueSlotSelector,
} from "./model.js";
import type {
  ExactTrackedValueSlot,
  ExactTrackedValueSlotInput,
} from "./tracked.js";
import type {
  ValueSlotState,
} from "./worklist.js";
import type {
  ValueSlotBoundaryReason,
  ValueSlotContext,
} from "./context.js";

export function stateForExpression(
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

export function drainValueSlotWorklist(context: ValueSlotContext): void {
  for (;;) {
    if (context.boundaryFound) {
      context.worklist.length = 0;
      return;
    }
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
    } else if (item.kind === "tracked-slot") {
      expandTrackedSlot(
        item.state,
        item.inputs,
        item.occurrence,
        item.closed,
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

export function stateForBindingProjection(
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
    selector.kind === "property" &&
    expandClosedStorageSlot(state, selector, remaining, root, context)
  ) {
    return;
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
    expandObjectLiteral(state, root, selector, remaining, context);
    return;
  }
  if (
    selector.kind === "property" &&
    source.ast.is.IsNewExpression(root)
  ) {
    const inputs = context.storageSlots.constructionInputsFor(
      root,
      selector,
    );
    if (inputs === undefined) {
      boundary(state, root, context);
      return;
    }
    for (const input of inputs) {
      if (remaining.length === 0) {
        addValueOrigin(state, input, context);
      } else {
        dependency(state, input, remaining, root, context);
      }
    }
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

function expandClosedStorageSlot(
  state: ValueSlotState,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
  remaining: ExactValueSlotPath,
  occurrence: Node,
  context: ValueSlotContext,
): boolean {
  const storage = context.storageSlots.slotFor(selector);
  if (storage === undefined) {
    return false;
  }
  if (
    !context.structuralWrites.pathCanBeTracked(remaining) &&
    !callableDeclarationAllowsSynchronousValue(
      context.source,
      storage.declaration,
    )
  ) {
    return false;
  }
  const mutations = context.structuralWrites.mutationsFor(
    storage.declaration,
    remaining,
  );
  addTrackedSlotDependency(
    state,
    Object.freeze({
      declaration: storage.declaration,
      closed: mutations.closed,
      inputs: Object.freeze([
        ...storage.inputs.map((expression) => Object.freeze({
          expression,
          path: remaining,
        })),
        ...mutations.inputs,
      ]),
    }),
    remaining,
    occurrence,
    context,
  );
  return true;
}

function addTrackedSlotDependency(
  destination: ValueSlotState,
  slot: ExactTrackedValueSlot,
  path: ExactValueSlotPath,
  occurrence: Node,
  context: ValueSlotContext,
): void {
  if (slot.closed && slot.inputs.length === 0) {
    return;
  }
  const state = stateForTrackedSlot(slot, path, occurrence, context);
  context.builder.addDependency(
    destination.vertex,
    state.vertex,
    "field",
    occurrence,
  );
}

function stateForTrackedSlot(
  slot: ExactTrackedValueSlot,
  path: ExactValueSlotPath,
  occurrence: Node,
  context: ValueSlotContext,
): ValueSlotState {
  const state = context.states.select("tracked-slot", slot.declaration, path);
  if (state.recursive) {
    boundary(state, occurrence, context, "recursive-slot");
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  context.worklist.push({
    kind: "tracked-slot",
    state,
    inputs: slot.inputs,
    path,
    occurrence,
    closed: slot.closed,
  });
  return state;
}

function expandTrackedSlot(
  state: ValueSlotState,
  inputs: readonly ExactTrackedValueSlotInput[],
  occurrence: Node,
  closed: boolean,
  context: ValueSlotContext,
): void {
  if (!closed) {
    boundary(state, occurrence, context);
  }
  for (const input of inputs) {
    if (input.path.length === 0) {
      addValueOrigin(state, input.expression, context);
    } else {
      dependency(
        state,
        input.expression,
        input.path,
        occurrence,
        context,
      );
    }
  }
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
  context: ValueSlotContext,
): void {
  if (
    !context.structuralWrites.pathIsClosed(
      Object.freeze([selector, ...remaining]),
    )
  ) {
    boundary(state, root, context);
  }
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
  context.boundaryFound = true;
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
