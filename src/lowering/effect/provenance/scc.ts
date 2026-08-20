import type {
  EffectProvenanceEdge,
  EffectProvenanceVertex,
} from "./model.js";

export interface EffectProvenanceComponents {
  readonly components: readonly (readonly EffectProvenanceVertex[])[];
  readonly componentForVertex: readonly number[];
  readonly work: number;
}

export function condenseEffectProvenance(
  vertices: readonly EffectProvenanceVertex[],
  edges: readonly EffectProvenanceEdge[],
): EffectProvenanceComponents {
  const dependencies = Array.from(
    { length: vertices.length },
    (): number[] => [],
  );
  const dependents = Array.from(
    { length: vertices.length },
    (): number[] => [],
  );
  for (const edge of edges) {
    dependencies[edge.destination.index]?.push(edge.source.index);
    dependents[edge.source.index]?.push(edge.destination.index);
  }
  const visited = new Uint8Array(vertices.length);
  const order: number[] = [];
  let work = 0;
  for (const vertex of vertices) {
    if (visited[vertex.index] === 1) {
      continue;
    }
    const stack: Array<{ readonly vertex: number; next: number }> = [
      { vertex: vertex.index, next: 0 },
    ];
    visited[vertex.index] = 1;
    while (stack.length !== 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) {
        throw new Error("effect provenance traversal lost its frame");
      }
      const next = dependencies[frame.vertex]?.[frame.next];
      if (next !== undefined) {
        stack[stack.length - 1] = {
          vertex: frame.vertex,
          next: frame.next + 1,
        };
        work += 1;
        if (visited[next] === 0) {
          visited[next] = 1;
          stack.push({ vertex: next, next: 0 });
        }
        continue;
      }
      order.push(frame.vertex);
      stack.pop();
    }
  }

  const assigned = new Uint8Array(vertices.length);
  const components: EffectProvenanceVertex[][] = [];
  for (let orderIndex = order.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const root = order[orderIndex];
    if (root === undefined || assigned[root] === 1) {
      continue;
    }
    const component: EffectProvenanceVertex[] = [];
    const pending = [root];
    assigned[root] = 1;
    while (pending.length !== 0) {
      const current = pending.pop();
      if (current === undefined) {
        continue;
      }
      const selected = vertices[current];
      if (selected === undefined) {
        throw new Error("effect provenance SCC lost a vertex");
      }
      component.push(selected);
      work += 1;
      for (const dependent of dependents[current] ?? []) {
        work += 1;
        if (assigned[dependent] === 0) {
          assigned[dependent] = 1;
          pending.push(dependent);
        }
      }
    }
    components.push(component);
  }
  const componentForVertex = new Array<number>(vertices.length);
  for (const [componentIndex, component] of components.entries()) {
    for (const vertex of component) {
      componentForVertex[vertex.index] = componentIndex;
    }
  }
  if (componentForVertex.some((component) => component === undefined)) {
    throw new Error("effect provenance SCC did not assign every vertex");
  }
  return Object.freeze({
    components: Object.freeze(
      components.map((component) => Object.freeze(component)),
    ),
    componentForVertex: Object.freeze(componentForVertex),
    work,
  });
}
