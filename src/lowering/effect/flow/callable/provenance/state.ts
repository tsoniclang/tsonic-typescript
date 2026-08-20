import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceEdgeKind,
  EffectProvenanceResolutionIndex,
} from "../../../provenance/model.js";
import type {
  CallableBoundaryReason,
  CallableContext,
  CallableState,
} from "../provenance-flow.js";

export function newState(
  kind: "binding" | "callable" | "expression" | "storage",
  occurrence: Node,
  context: CallableContext,
): CallableState {
  const state = {
    vertex: context.builder.vertex(kind, occurrence),
    expanded: false,
    relevant: false,
  };
  context.states.push(state);
  return state;
}

export function dependency(
  destination: CallableState,
  source: CallableState,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: CallableContext,
): void {
  context.builder.addDependency(destination.vertex, source.vertex, kind, occurrence);
  append(context.dependents, source, destination);
  append(context.dependencies, destination, source);
  if (source.relevant) {
    markRelevant(destination, context);
  }
}

export function collectUnsafeCallableUses(
  context: CallableContext,
  resolved: EffectProvenanceResolutionIndex<CallableBoundaryReason>,
): ReadonlySet<CallableState> {
  const unsafe = new Set<CallableState>();
  const pending: CallableState[] = [];
  for (const state of context.states) {
    if (!resolved.resolutionFor(state.vertex).closed) {
      unsafe.add(state);
      pending.push(state);
    }
  }
  while (pending.length !== 0) {
    const destination = pending.pop();
    if (destination === undefined) {
      continue;
    }
    for (const source of context.dependencies.get(destination) ?? []) {
      if (!unsafe.has(source)) {
        unsafe.add(source);
        pending.push(source);
      }
    }
  }
  return unsafe;
}

export function mergeDeclarations(
  occurrence: Node,
  declarations: readonly Node[],
  context: CallableContext,
  stateForDeclaration: (declaration: Node) => CallableState,
): CallableState {
  const state = newState("storage", occurrence, context);
  state.expanded = true;
  if (declarations.length === 0) {
    emptyOrigin(state, occurrence, context);
  }
  for (const declaration of declarations) {
    dependency(
      state,
      stateForDeclaration(declaration),
      "assignment",
      occurrence,
      context,
    );
  }
  return state;
}

export function candidateOrigin(
  state: CallableState,
  declaration: Node,
  context: CallableContext,
): void {
  context.candidateOrigins.add(declaration);
  context.builder.addOrigin(state.vertex, declaration);
  markRelevant(state, context);
}

export function synchronousOrigin(
  state: CallableState,
  declaration: Node,
  context: CallableContext,
): void {
  context.synchronousOrigins.add(declaration);
  context.builder.addOrigin(state.vertex, declaration);
  markRelevant(state, context);
}

export function emptyOrigin(
  state: CallableState,
  occurrence: Node,
  context: CallableContext,
): void {
  context.terminalOrigin ??= occurrence;
  context.builder.addOrigin(state.vertex, context.terminalOrigin);
}

export function boundary(
  state: CallableState,
  reason: CallableBoundaryReason,
  occurrence: Node,
  context: CallableContext,
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}

function markRelevant(
  state: CallableState,
  context: CallableContext,
): void {
  const pending = [state];
  while (pending.length !== 0) {
    const current = pending.pop();
    if (current === undefined || current.relevant) {
      continue;
    }
    current.relevant = true;
    pending.push(...context.dependents.get(current) ?? []);
  }
}

function append(
  target: Map<CallableState, Set<CallableState>>,
  key: CallableState,
  value: CallableState,
): void {
  const selected = target.get(key);
  if (selected === undefined) {
    target.set(key, new Set([value]));
  } else {
    selected.add(value);
  }
}
