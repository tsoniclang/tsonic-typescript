import type {
  Node,
  PointerOperationFact,
  Type,
} from "@tsonic/tsts";

export type PointerFlowBlocker =
  | "addressed-storage-may-change"
  | "captured-parameter"
  | "declaration-boundary"
  | "external-boundary"
  | "generic-call"
  | "generic-storage"
  | "identity-observed"
  | "indirect-call"
  | "mixed-pointee"
  | "non-bijective-identity"
  | "nil-capable"
  | "open-call"
  | "pointee-replacement"
  | "pointer-rebinding"
  | "unsupported-flow"
  | "unsupported-pointee"
  | "unsupported-producer";

export interface PointerFlowVertex {
  readonly node: Node;
  readonly operations: Set<Node>;
  readonly pointerTypes: Set<Node>;
  readonly pointees: Map<Type, Node>;
  readonly producers: Set<PointerOperationFact>;
  readonly blockerOccurrences: Map<PointerFlowBlocker, Set<Node>>;
}

export interface PointerFlowComponent {
  readonly vertices: readonly PointerFlowVertex[];
  readonly operations: readonly Node[];
  readonly pointerTypes: readonly Node[];
  readonly pointees: readonly PointerPointeeEvidence[];
  readonly producers: readonly PointerOperationFact[];
  readonly blockers: readonly PointerFlowBlocker[];
  readonly blockerEvidence: readonly PointerFlowBlockerOccurrence[];
}

export interface PointerFlowBlockerOccurrence {
  readonly reason: PointerFlowBlocker;
  readonly occurrences: readonly Node[];
}

export interface PointerPointeeEvidence {
  readonly type: Type;
  readonly anchor: Node;
}

export class PointerFlowGraph {
  readonly #vertices = new Map<Node, PointerFlowVertex>();
  readonly #parents = new Map<PointerFlowVertex, PointerFlowVertex>();

  add(node: Node): PointerFlowVertex {
    const existing = this.#vertices.get(node);
    if (existing !== undefined) {
      return existing;
    }
    const created: PointerFlowVertex = {
      node,
      operations: new Set(),
      pointerTypes: new Set(),
      pointees: new Map(),
      producers: new Set(),
      blockerOccurrences: new Map(),
    };
    this.#vertices.set(node, created);
    this.#parents.set(created, created);
    return created;
  }

  get(node: Node | undefined): PointerFlowVertex | undefined {
    return node === undefined ? undefined : this.#vertices.get(node);
  }

  union(left: PointerFlowVertex, right: PointerFlowVertex): void {
    const leftRoot = this.root(left);
    const rightRoot = this.root(right);
    if (leftRoot === rightRoot) {
      return;
    }
    this.#parents.set(rightRoot, leftRoot);
  }

  block(
    vertex: PointerFlowVertex | undefined,
    blocker: PointerFlowBlocker,
    occurrence: Node,
  ): void {
    if (vertex === undefined) {
      return;
    }
    const existing = vertex.blockerOccurrences.get(blocker);
    if (existing === undefined) {
      vertex.blockerOccurrences.set(blocker, new Set([occurrence]));
    } else {
      existing.add(occurrence);
    }
  }

  nodesInBlockedComponents(): ReadonlySet<Node> {
    const blockedRoots = new Set<PointerFlowVertex>();
    for (const vertex of this.#vertices.values()) {
      if (vertex.blockerOccurrences.size !== 0) {
        blockedRoots.add(this.root(vertex));
      }
    }
    return new Set(
      [...this.#vertices.values()]
        .filter((vertex) => blockedRoots.has(this.root(vertex)))
        .map((vertex) => vertex.node),
    );
  }

  connected(
    left: PointerFlowVertex | undefined,
    right: PointerFlowVertex | undefined,
  ): boolean {
    return left !== undefined && right !== undefined &&
      this.root(left) === this.root(right);
  }

  components(): readonly PointerFlowComponent[] {
    const groups = new Map<PointerFlowVertex, PointerFlowVertex[]>();
    for (const vertex of this.#vertices.values()) {
      const root = this.root(vertex);
      const group = groups.get(root);
      if (group === undefined) {
        groups.set(root, [vertex]);
      } else {
        group.push(vertex);
      }
    }
    return Object.freeze([...groups.values()].map(sealComponent));
  }

  private root(vertex: PointerFlowVertex): PointerFlowVertex {
    let root = vertex;
    for (;;) {
      const parent = this.#parents.get(root);
      if (parent === undefined || parent === root) {
        break;
      }
      root = parent;
    }
    let current = vertex;
    while (current !== root) {
      const parent = this.#parents.get(current);
      this.#parents.set(current, root);
      if (parent === undefined || parent === current) {
        break;
      }
      current = parent;
    }
    return root;
  }
}

function sealComponent(
  vertices: readonly PointerFlowVertex[],
): PointerFlowComponent {
  const operations = new Set<Node>();
  const pointerTypes = new Set<Node>();
  const pointees = new Map<Type, Node>();
  const producers = new Set<PointerOperationFact>();
  const blockerOccurrences = new Map<PointerFlowBlocker, Set<Node>>();
  for (const vertex of vertices) {
    append(operations, vertex.operations);
    append(pointerTypes, vertex.pointerTypes);
    for (const [type, anchor] of vertex.pointees) {
      pointees.set(type, anchor);
    }
    append(producers, vertex.producers);
    for (const [reason, occurrences] of vertex.blockerOccurrences) {
      const existing = blockerOccurrences.get(reason);
      if (existing === undefined) {
        blockerOccurrences.set(reason, new Set(occurrences));
      } else {
        append(existing, occurrences);
      }
    }
  }
  const blockerEvidence = [...blockerOccurrences]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, occurrences]) => Object.freeze({
      reason,
      occurrences: Object.freeze([...occurrences]),
    }));
  return Object.freeze({
    vertices: Object.freeze([...vertices]),
    operations: Object.freeze([...operations]),
    pointerTypes: Object.freeze([...pointerTypes]),
    pointees: Object.freeze([...pointees].map(([type, anchor]) =>
      Object.freeze({ type, anchor })
    )),
    producers: Object.freeze([...producers]),
    blockers: Object.freeze(blockerEvidence.map((entry) => entry.reason)),
    blockerEvidence: Object.freeze(blockerEvidence),
  });
}

function append<T>(target: Set<T>, source: ReadonlySet<T>): void {
  for (const value of source) {
    target.add(value);
  }
}
