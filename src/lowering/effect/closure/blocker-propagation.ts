import type { Node } from "@tsonic/tsts";

import {
  createEffectProvenanceGraphBuilder,
  type EffectProvenanceGraphBuilder,
} from "../provenance/graph.js";
import type {
  EffectProvenanceEdge,
  EffectProvenanceEdgeKind,
  EffectProvenanceGraph,
  EffectProvenanceVertex,
} from "../provenance/model.js";
import { condenseEffectProvenance } from "../provenance/scc.js";
import {
  cooperativeEffectFallbackReasons,
  type CooperativeEffectFallbackReason,
} from "./retention.js";

export interface EffectDependencyVertex {
  readonly declaration: Node;
  readonly dependencies: ReadonlySet<EffectDependencyVertex>;
  readonly dependencyEvidence: ReadonlyMap<
    EffectDependencyVertex,
    ReadonlyMap<EffectProvenanceEdgeKind, ReadonlySet<Node>>
  >;
  readonly directBlockerNodes: ReadonlyMap<
    CooperativeEffectFallbackReason,
    ReadonlySet<Node>
  >;
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}

export interface EffectPropagationEvidence {
  readonly vertices: number;
  readonly edges: number;
  readonly components: number;
  readonly work: number;
}

export interface EffectPropagationRoot {
  readonly reason: CooperativeEffectFallbackReason;
  readonly declaration: Node;
  readonly occurrence: Node;
  readonly path: readonly Node[];
  readonly steps: readonly EffectPropagationStep[];
}

export interface EffectPropagationStep {
  readonly from: Node;
  readonly to: Node;
  readonly kind: EffectProvenanceEdgeKind;
  readonly occurrence: Node;
}

export interface EffectBlockerPropagation {
  readonly evidence: EffectPropagationEvidence;
  rootsFor(vertex: EffectDependencyVertex): readonly EffectPropagationRoot[];
}

interface BlockerWitness {
  readonly root: EffectDependencyVertex;
  readonly occurrence: Node;
  readonly rootOrder: number;
  readonly occurrenceOrder: number;
  readonly distance: number;
  readonly next?: {
    readonly component: number;
    readonly bridge: EffectProvenanceEdge;
  };
}

interface ComponentState {
  readonly dependencies: Set<number>;
  readonly dependents: Map<number, EffectProvenanceEdge>;
  readonly witnesses: Map<CooperativeEffectFallbackReason, BlockerWitness>;
  remaining: number;
}

export function propagateEffectBlockers(
  vertices: Iterable<EffectDependencyVertex>,
): EffectBlockerPropagation {
  const all = [...vertices];
  const order = new Map(all.map((vertex, index) => [vertex, index]));
  const builder = createEffectProvenanceGraphBuilder<never>();
  const graphVertices = new Map(all.map((vertex) => [
    vertex,
    builder.vertex("callable", vertex.declaration),
  ]));
  for (const vertex of all) {
    addDependencyEvidence(vertex, graphVertices, builder);
  }
  const graph = builder.seal();
  const dependencyEdges = indexDependencyEdges(graph);
  const internalPaths = new Map<
    EffectProvenanceVertex,
    Map<EffectProvenanceVertex, readonly EffectPropagationStep[]>
  >();
  const condensed = condenseEffectProvenance(graph.vertices, graph.edges);
  const componentForVertex = new Map<EffectDependencyVertex, number>();
  const ownerForGraphVertex = new Map(
    [...graphVertices].map(([owner, vertex]) => [vertex, owner]),
  );
  for (const [owner, graphVertex] of graphVertices) {
    componentForVertex.set(owner, condensed.componentFor(graphVertex));
  }
  const states: ComponentState[] = Array.from(
    { length: condensed.componentCount },
    () => ({
    dependencies: new Set(),
    dependents: new Map(),
    witnesses: new Map(),
    remaining: 0,
    }),
  );
  let work = condensed.work;
  for (const edge of graph.edges) {
    const source = condensed.componentFor(edge.source);
    const destination = condensed.componentFor(edge.destination);
    if (source === destination) {
      continue;
    }
    const selected = requiredState(states, destination);
    if (selected.dependencies.add(source)) {
      requiredState(states, source).dependents.set(destination, edge);
      work += 1;
    }
  }
  let occurrenceOrder = 0;
  for (const [owner, graphVertex] of graphVertices) {
    const componentIndex = condensed.componentFor(graphVertex);
    const state = requiredState(states, componentIndex);
    for (const [reason, occurrences] of owner.directBlockerNodes) {
      const rootOrder = order.get(owner);
      if (rootOrder === undefined) {
        throw new Error("effect blocker root lost its occurrence or order");
      }
      for (const occurrence of occurrences) {
        selectWitness(state.witnesses, reason, {
          root: owner,
          occurrence,
          rootOrder,
          occurrenceOrder,
          distance: 0,
        });
        occurrenceOrder += 1;
      }
    }
  }
  const pending: number[] = [];
  for (const [index, state] of states.entries()) {
    state.remaining = state.dependencies.size;
    if (state.remaining === 0) {
      pending.push(index);
    }
  }
  let resolved = 0;
  while (pending.length !== 0) {
    const sourceIndex = pending.pop();
    if (sourceIndex === undefined) {
      continue;
    }
    resolved += 1;
    const source = requiredState(states, sourceIndex);
    for (const [destinationIndex, bridge] of source.dependents) {
      const destination = requiredState(states, destinationIndex);
      for (const [reason, witness] of source.witnesses) {
        selectWitness(destination.witnesses, reason, {
          ...witness,
          distance: witness.distance + 1,
          next: Object.freeze({ component: sourceIndex, bridge }),
        });
        work += 1;
      }
      destination.remaining -= 1;
      if (destination.remaining === 0) {
        pending.push(destinationIndex);
      }
    }
  }
  if (resolved !== states.length) {
    throw new Error("effect blocker SCC condensation remained cyclic");
  }
  const roots = new Map<EffectDependencyVertex, readonly EffectPropagationRoot[]>();
  for (const vertex of all) {
    const component = requiredOwnerComponent(componentForVertex, vertex);
    const state = requiredState(states, component);
    for (const reason of state.witnesses.keys()) {
      vertex.blockers.add(reason);
    }
  }
  return Object.freeze({
    evidence: Object.freeze({
      vertices: all.length,
      edges: graph.edges.length,
      components: states.length,
      work,
    }),
    rootsFor(vertex: EffectDependencyVertex): readonly EffectPropagationRoot[] {
      const cached = roots.get(vertex);
      if (cached !== undefined) {
        return cached;
      }
      const component = requiredOwnerComponent(componentForVertex, vertex);
      const state = requiredState(states, component);
      const selected = Object.freeze(
        cooperativeEffectFallbackReasons.flatMap((reason) => {
          const witness = state.witnesses.get(reason);
          return witness === undefined
            ? []
            : [Object.freeze({
                reason,
                declaration: witness.root.declaration,
                occurrence: witness.occurrence,
                ...blockerPath(
                  vertex,
                  component,
                  reason,
                  witness,
                  states,
                  condensed.componentFor,
                  dependencyEdges,
                  internalPaths,
                  graphVertices,
                  ownerForGraphVertex,
                ),
              })];
        }),
      );
      roots.set(vertex, selected);
      return selected;
    },
  });
}

function blockerPath(
  owner: EffectDependencyVertex,
  component: number,
  reason: CooperativeEffectFallbackReason,
  witness: BlockerWitness,
  states: readonly ComponentState[],
  componentForVertex: (vertex: EffectProvenanceVertex) => number,
  dependencyEdges: ReadonlyMap<
    EffectProvenanceVertex,
    readonly EffectProvenanceEdge[]
  >,
  pathCache: Map<
    EffectProvenanceVertex,
    Map<EffectProvenanceVertex, readonly EffectPropagationStep[]>
  >,
  vertices: ReadonlyMap<EffectDependencyVertex, EffectProvenanceVertex>,
  owners: ReadonlyMap<EffectProvenanceVertex, EffectDependencyVertex>,
): { readonly path: readonly Node[]; readonly steps: readonly EffectPropagationStep[] } {
  const steps: EffectPropagationStep[] = [];
  let currentVertex = requiredGraphVertex(vertices, owner);
  let currentComponent = component;
  let current = witness;
  while (current.next !== undefined) {
    const bridge = current.next.bridge;
    steps.push(...internalPath(
      currentVertex,
      bridge.destination,
      currentComponent,
      componentForVertex,
      dependencyEdges,
      pathCache,
      owners,
    ));
    steps.push(stepFor(bridge, owners));
    currentComponent = current.next.component;
    currentVertex = bridge.source;
    const nextWitness = requiredState(states, currentComponent).witnesses
      .get(reason);
    if (nextWitness === undefined) {
      break;
    }
    current = nextWitness;
  }
  steps.push(...internalPath(
    currentVertex,
    requiredGraphVertex(vertices, current.root),
    currentComponent,
    componentForVertex,
    dependencyEdges,
    pathCache,
    owners,
  ));
  const path = [owner.declaration, ...steps.map((step) => step.to)];
  if (path[path.length - 1] !== current.root.declaration) {
    throw new Error("effect blocker path did not reach its selected root");
  }
  return Object.freeze({
    path: Object.freeze(path),
    steps: Object.freeze(steps),
  });
}

function addDependencyEvidence(
  vertex: EffectDependencyVertex,
  vertices: ReadonlyMap<EffectDependencyVertex, EffectProvenanceVertex>,
  builder: EffectProvenanceGraphBuilder<never>,
): void {
  if (
    vertex.dependencies.size !== vertex.dependencyEvidence.size ||
    [...vertex.dependencyEvidence.keys()].some((dependency) =>
      !vertex.dependencies.has(dependency)
    )
  ) {
    throw new Error(
      "effect dependency set and evidence ledger do not exact-join",
    );
  }
  for (const dependency of vertex.dependencies) {
    const evidence = vertex.dependencyEvidence.get(dependency);
    if (
      evidence === undefined || evidence.size === 0 ||
      [...evidence.values()].some((occurrences) => occurrences.size === 0)
    ) {
      throw new Error("effect dependency has no semantic edge evidence");
    }
    for (const [kind, occurrences] of evidence) {
      for (const occurrence of occurrences) {
        builder.addDependency(
          requiredGraphVertex(vertices, vertex),
          requiredGraphVertex(vertices, dependency),
          kind,
          occurrence,
        );
      }
    }
  }
}

function indexDependencyEdges(
  graph: EffectProvenanceGraph<never>,
): ReadonlyMap<EffectProvenanceVertex, readonly EffectProvenanceEdge[]> {
  const mutable = new Map<EffectProvenanceVertex, EffectProvenanceEdge[]>();
  for (const edge of graph.edges) {
    const selected = mutable.get(edge.destination);
    if (selected === undefined) {
      mutable.set(edge.destination, [edge]);
    } else {
      selected.push(edge);
    }
  }
  return new Map([...mutable].map(([vertex, edges]) => [
    vertex,
    Object.freeze(edges),
  ]));
}

function internalPath(
  from: EffectProvenanceVertex,
  to: EffectProvenanceVertex,
  component: number,
  componentForVertex: (vertex: EffectProvenanceVertex) => number,
  dependencyEdges: ReadonlyMap<
    EffectProvenanceVertex,
    readonly EffectProvenanceEdge[]
  >,
  cache: Map<
    EffectProvenanceVertex,
    Map<EffectProvenanceVertex, readonly EffectPropagationStep[]>
  >,
  owners: ReadonlyMap<EffectProvenanceVertex, EffectDependencyVertex>,
): readonly EffectPropagationStep[] {
  if (from === to) {
    return Object.freeze([]);
  }
  const cached = cache.get(from)?.get(to);
  if (cached !== undefined) {
    return cached;
  }
  const previous = new Map<EffectProvenanceVertex, EffectProvenanceEdge>();
  const pending = [from];
  for (let index = 0; index < pending.length && !previous.has(to); index += 1) {
    const current = pending[index];
    if (current === undefined) {
      continue;
    }
    for (const edge of dependencyEdges.get(current) ?? []) {
      const next = edge.source;
      if (
        componentForVertex(next) !== component ||
        next === from ||
        previous.has(next)
      ) {
        continue;
      }
      previous.set(next, edge);
      pending.push(next);
    }
  }
  if (!previous.has(to)) {
    throw new Error("effect blocker SCC has no internal dependency path");
  }
  const reversed: EffectProvenanceEdge[] = [];
  let current = to;
  while (current !== from) {
    const edge = previous.get(current);
    if (edge === undefined) {
      throw new Error("effect blocker internal path lost an edge");
    }
    reversed.push(edge);
    current = edge.destination;
  }
  const result = Object.freeze(
    reversed.reverse().map((edge) => stepFor(edge, owners)),
  );
  let selected = cache.get(from);
  if (selected === undefined) {
    selected = new Map();
    cache.set(from, selected);
  }
  selected.set(to, result);
  return result;
}

function stepFor(
  edge: EffectProvenanceEdge,
  owners: ReadonlyMap<EffectProvenanceVertex, EffectDependencyVertex>,
): EffectPropagationStep {
  const from = owners.get(edge.destination);
  const to = owners.get(edge.source);
  if (from === undefined || to === undefined) {
    throw new Error("effect blocker path edge lost its callable owner");
  }
  return Object.freeze({
    from: from.declaration,
    to: to.declaration,
    kind: edge.kind,
    occurrence: edge.occurrence,
  });
}

function selectWitness(
  witnesses: Map<CooperativeEffectFallbackReason, BlockerWitness>,
  reason: CooperativeEffectFallbackReason,
  candidate: BlockerWitness,
): void {
  const existing = witnesses.get(reason);
  if (
    existing === undefined ||
    candidate.distance < existing.distance ||
    (candidate.distance === existing.distance &&
      compareWitnesses(candidate, existing) < 0)
  ) {
    witnesses.set(reason, candidate);
  }
}

function compareWitnesses(left: BlockerWitness, right: BlockerWitness): number {
  return left.rootOrder - right.rootOrder ||
    left.occurrenceOrder - right.occurrenceOrder;
}

function requiredGraphVertex(
  vertices: ReadonlyMap<EffectDependencyVertex, EffectProvenanceVertex>,
  vertex: EffectDependencyVertex,
): EffectProvenanceVertex {
  const selected = vertices.get(vertex);
  if (selected === undefined) {
    throw new Error("effect dependency references a non-candidate vertex");
  }
  return selected;
}

function requiredOwnerComponent(
  components: ReadonlyMap<EffectDependencyVertex, number>,
  vertex: EffectDependencyVertex,
): number {
  const selected = components.get(vertex);
  if (selected === undefined) {
    throw new Error("effect candidate has no SCC component");
  }
  return selected;
}

function requiredState(
  states: readonly ComponentState[],
  index: number,
): ComponentState {
  const selected = states[index];
  if (selected === undefined) {
    throw new Error("effect blocker component is missing");
  }
  return selected;
}
