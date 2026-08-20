import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceGraph } from "../../../provenance/model.js";
import { collectClosedIndirectCallableReferences } from "./reference-closure.js";

test("indexes provenance edges once for every closed indirect root", () => {
  const builder = createEffectProvenanceGraphBuilder<never>();
  const origin = builder.vertex("callable", node());
  const roots = Array.from({ length: 32 }, () => {
    const root = builder.vertex("expression", node());
    builder.addDependency(root, origin, "alias", node());
    return root;
  });
  const graph = builder.seal();
  let edgeVisits = 0;
  const measuredEdges = new Proxy(graph.edges, {
    get(target, property, receiver) {
      if (property !== Symbol.iterator) {
        return Reflect.get(target, property, receiver);
      }
      return function* () {
        for (const edge of target) {
          edgeVisits += 1;
          yield edge;
        }
      };
    },
  });
  const measuredGraph: EffectProvenanceGraph<never> = Object.freeze({
    ...graph,
    edges: measuredEdges,
  });
  const references = new Set<Node>();

  collectClosedIndirectCallableReferences(roots, measuredGraph, references);

  assert.equal(edgeVisits, graph.edges.length);
  assert.equal(references.size, roots.length * 2 + 1);
});

function node(): Node {
  return Object.freeze({}) as Node;
}
