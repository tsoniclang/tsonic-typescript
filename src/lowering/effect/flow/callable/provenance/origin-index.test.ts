import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import { createCallableOriginIndex } from "./origin-index.js";

test("indexes exact callable origin classes without flattening intermediates", () => {
  const candidate = node();
  const synchronous = node();
  const terminal = node();
  const builder = createEffectProvenanceGraphBuilder<never>();
  const candidateVertex = builder.vertex("callable", node());
  const synchronousVertex = builder.vertex("callable", node());
  const terminalVertex = builder.vertex("expression", node());
  const result = builder.vertex("expression", node());
  builder.addOrigin(candidateVertex, candidate);
  builder.addOrigin(synchronousVertex, synchronous);
  builder.addOrigin(terminalVertex, terminal);
  builder.addDependency(result, candidateVertex, "callable-invocation", node());
  builder.addDependency(result, synchronousVertex, "callable-invocation", node());
  builder.addDependency(result, terminalVertex, "conditional", node());
  const graph = builder.seal();
  const index = createCallableOriginIndex(
    graph,
    resolveEffectProvenance(graph),
    new Set([candidate]),
    new Set([synchronous]),
  );

  const selected = index.selectionFor(result);

  assert.equal(selected.candidates.count, 1);
  assert.deepEqual([...selected.candidates.nodes()], [candidate]);
  assert.equal(selected.synchronous.count, 1);
  assert.deepEqual([...selected.synchronous.nodes()], [synchronous]);
  assert.throws(
    () => index.selectionFor({ index: result.index } as never),
    /foreign vertex/u,
  );
});

test("keeps accumulating callable-origin construction near linear", () => {
  const measurements = [128, 256, 512].map(measureAccumulatingOrigins);
  for (let index = 1; index < measurements.length; index += 1) {
    const previous = measurements[index - 1];
    const current = measurements[index];
    assert.ok(previous !== undefined && current !== undefined);
    assert.ok(
      current.work < previous.work * 2.6,
      `origin-index work grew ${previous.work} -> ${current.work}`,
    );
  }
});

function measureAccumulatingOrigins(originCount: number): {
  readonly work: number;
} {
  const origins = Array.from({ length: originCount }, node);
  const builder = createEffectProvenanceGraphBuilder<never>();
  const first = builder.vertex("callable", node());
  const firstOrigin = origins[0];
  assert.ok(firstOrigin !== undefined);
  builder.addOrigin(first, firstOrigin);
  let accumulated = first;
  for (let index = 1; index < origins.length; index += 1) {
    const origin = origins[index];
    assert.ok(origin !== undefined);
    const originVertex = builder.vertex("callable", node());
    builder.addOrigin(originVertex, origin);
    const next = builder.vertex("expression", node());
    builder.addDependency(next, accumulated, "conditional", node());
    builder.addDependency(next, originVertex, "conditional", node());
    accumulated = next;
  }
  const graph = builder.seal();
  const index = createCallableOriginIndex(
    graph,
    resolveEffectProvenance(graph),
    new Set(origins),
    new Set(),
  );
  const selected = index.selectionFor(accumulated);

  assert.equal(selected.candidates.count, originCount);
  assert.deepEqual(new Set(selected.candidates.nodes()), new Set(origins));
  return { work: index.work };
}

function node(): Node {
  return Object.freeze({}) as Node;
}
