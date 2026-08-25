import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceBoundary,
  EffectProvenanceEdge,
  EffectProvenanceEdgeKind,
  EffectProvenanceGraph,
  EffectProvenanceOrigin,
  EffectProvenanceVertex,
  EffectProvenanceVertexKind,
} from "./model.js";
import { exactObjectIdentity } from "./identity.js";

export interface EffectProvenanceGraphBuilder<Reason extends string> {
  vertex(
    kind: EffectProvenanceVertexKind,
    occurrence: Node,
  ): EffectProvenanceVertex;
  addDependency(
    destination: EffectProvenanceVertex,
    source: EffectProvenanceVertex,
    kind: EffectProvenanceEdgeKind,
    occurrence: Node,
  ): void;
  addOrigin(vertex: EffectProvenanceVertex, occurrence: Node): void;
  addBoundary(
    vertex: EffectProvenanceVertex,
    reason: Reason,
    occurrence: Node,
  ): void;
  seal(): EffectProvenanceGraph<Reason>;
}

export function createEffectProvenanceGraphBuilder<Reason extends string>():
  EffectProvenanceGraphBuilder<Reason> {
  const vertices: EffectProvenanceVertex[] = [];
  const edges: EffectProvenanceEdge[] = [];
  const origins: EffectProvenanceOrigin[] = [];
  const boundaries: EffectProvenanceBoundary<Reason>[] = [];
  const edgeKeys = new Set<string>();
  const originKeys = new Set<string>();
  const boundaryKeys = new Set<string>();
  let sealed = false;
  const assertMutable = (): void => {
    if (sealed) {
      throw new Error("effect provenance graph is already sealed");
    }
  };
  const assertVertex = (vertex: EffectProvenanceVertex): void => {
    if (vertices[vertex.index] !== vertex) {
      throw new Error("effect provenance vertex belongs to another graph");
    }
  };
  return Object.freeze({
    vertex(
      kind: EffectProvenanceVertexKind,
      occurrence: Node,
    ): EffectProvenanceVertex {
      assertMutable();
      const vertex = Object.freeze({
        index: vertices.length,
        kind,
        occurrence,
      });
      vertices.push(vertex);
      return vertex;
    },
    addDependency(
      destination: EffectProvenanceVertex,
      source: EffectProvenanceVertex,
      kind: EffectProvenanceEdgeKind,
      occurrence: Node,
    ): void {
      assertMutable();
      assertVertex(destination);
      assertVertex(source);
      const key = `${destination.index}:${source.index}:${kind}:${exactObjectIdentity(occurrence as object)}`;
      if (edgeKeys.has(key)) {
        return;
      }
      edgeKeys.add(key);
      edges.push(Object.freeze({ source, destination, kind, occurrence }));
    },
    addOrigin(vertex: EffectProvenanceVertex, occurrence: Node): void {
      assertMutable();
      assertVertex(vertex);
      const key = `${vertex.index}:${exactObjectIdentity(occurrence as object)}`;
      if (originKeys.has(key)) {
        return;
      }
      originKeys.add(key);
      origins.push(Object.freeze({ vertex, occurrence }));
    },
    addBoundary(
      vertex: EffectProvenanceVertex,
      reason: Reason,
      occurrence: Node,
    ): void {
      assertMutable();
      assertVertex(vertex);
      const key = `${vertex.index}:${reason}:${exactObjectIdentity(occurrence as object)}`;
      if (boundaryKeys.has(key)) {
        return;
      }
      boundaryKeys.add(key);
      boundaries.push(Object.freeze({ vertex, reason, occurrence }));
    },
    seal(): EffectProvenanceGraph<Reason> {
      assertMutable();
      sealed = true;
      const graph = Object.freeze({
        vertices: Object.freeze([...vertices]),
        edges: Object.freeze([...edges]),
        origins: Object.freeze([...origins]),
        boundaries: Object.freeze([...boundaries]),
      });
      vertices.length = 0;
      edges.length = 0;
      origins.length = 0;
      boundaries.length = 0;
      edgeKeys.clear();
      originKeys.clear();
      boundaryKeys.clear();
      return graph;
    },
  });
}
