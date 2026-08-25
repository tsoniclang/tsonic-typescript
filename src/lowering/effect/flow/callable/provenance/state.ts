import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceEdgeKind,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
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
  if (source.relevant) {
    markRelevant(destination, context);
  }
}

export interface UnsafeCallableUseIndex {
  readonly count: number;
  has(state: CallableState): boolean;
}

export function collectUnsafeCallableUses(
  vertices: readonly EffectProvenanceVertex[],
  resolved: EffectProvenanceResolutionIndex<CallableBoundaryReason>,
): UnsafeCallableUseIndex {
  const unsafe = new Uint8Array(resolved.componentCount);
  const pending = new Uint32Array(resolved.componentCount);
  let pendingCount = 0;
  for (let component = 0; component < resolved.componentCount; component += 1) {
    if (!resolved.componentIsClosed(component)) {
      unsafe[component] = 1;
      pending[pendingCount] = component;
      pendingCount += 1;
    }
  }
  while (pendingCount !== 0) {
    pendingCount -= 1;
    const destination = requiredComponent(pending, pendingCount);
    const dependencyCount = resolved.componentDependencyCount(destination);
    for (let index = 0; index < dependencyCount; index += 1) {
      const source = resolved.componentDependency(destination, index);
      if (unsafe[source] === 0) {
        unsafe[source] = 1;
        pending[pendingCount] = source;
        pendingCount += 1;
      }
    }
  }
  let count = 0;
  for (const vertex of vertices) {
    if (unsafe[resolved.componentFor(vertex)] === 1) {
      count += 1;
    }
  }
  return Object.freeze({
    count,
    has(state: CallableState): boolean {
      return unsafe[resolved.componentFor(state.vertex)] === 1;
    },
  });
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

export function contractOrigin(
  state: CallableState,
  declaration: Node,
  context: CallableContext,
): void {
  context.contractOrigins.add(declaration);
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

function requiredComponent(values: Uint32Array, index: number): number {
  const selected = values[index];
  if (selected === undefined) {
    throw new Error("unsafe callable component is missing");
  }
  return selected;
}
