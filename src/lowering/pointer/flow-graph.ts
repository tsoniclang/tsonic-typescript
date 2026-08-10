import type {
  Node,
  PointerOperationFact,
  Type,
} from "@tsonic/tsts";

export type PointerFlowBlocker =
  | "addressed-storage-may-change"
  | "captured-parameter"
  | "external-boundary"
  | "identity-observed"
  | "indirect-call"
  | "nil-capable"
  | "open-call"
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
  readonly blockers: Set<PointerFlowBlocker>;
}

export interface PointerFlowComponent {
  readonly vertices: readonly PointerFlowVertex[];
  readonly operations: readonly Node[];
  readonly pointerTypes: readonly Node[];
  readonly pointees: readonly PointerPointeeEvidence[];
  readonly producers: readonly PointerOperationFact[];
  readonly blockers: readonly PointerFlowBlocker[];
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
      blockers: new Set(),
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
  ): void {
    vertex?.blockers.add(blocker);
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
  const blockers = new Set<PointerFlowBlocker>();
  for (const vertex of vertices) {
    append(operations, vertex.operations);
    append(pointerTypes, vertex.pointerTypes);
    for (const [type, anchor] of vertex.pointees) {
      pointees.set(type, anchor);
    }
    append(producers, vertex.producers);
    append(blockers, vertex.blockers);
  }
  return Object.freeze({
    vertices: Object.freeze([...vertices]),
    operations: Object.freeze([...operations]),
    pointerTypes: Object.freeze([...pointerTypes]),
    pointees: Object.freeze([...pointees].map(([type, anchor]) =>
      Object.freeze({ type, anchor })
    )),
    producers: Object.freeze([...producers]),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function append<T>(target: Set<T>, source: ReadonlySet<T>): void {
  for (const value of source) {
    target.add(value);
  }
}
