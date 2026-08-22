import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createEffectProvenanceGraphBuilder } from "./graph.js";
import { createEffectProvenanceOriginIndex } from "./origin-index.js";
import { resolveEffectProvenance } from "./resolution.js";

test("indexes exact origin classes without flattening intermediates", () => {
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
  const index = createEffectProvenanceOriginIndex(
    graph,
    resolveEffectProvenance(graph),
    [new Set([candidate]), new Set([synchronous])],
  );

  const candidates = index.selectionFor(result, 0);
  const synchronousDeclarations = index.selectionFor(result, 1);

  assert.equal(candidates.count, 1);
  assert.deepEqual([...candidates.nodes()], [candidate]);
  assert.equal(synchronousDeclarations.count, 1);
  assert.deepEqual([...synchronousDeclarations.nodes()], [synchronous]);
  assert.throws(
    () => index.selectionFor({ index: result.index } as never, 0),
    /foreign vertex/u,
  );
  assert.throws(() => index.selectionFor(result, 2), /class is invalid/u);
});

test("keeps accumulating origin construction near linear", () => {
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
  const index = createEffectProvenanceOriginIndex(
    graph,
    resolveEffectProvenance(graph),
    [new Set(origins)],
  );
  const selected = index.selectionFor(accumulated, 0);

  assert.equal(selected.count, originCount);
  assert.deepEqual(new Set(selected.nodes()), new Set(origins));
  return { work: index.work };
}

function node(): Node {
  return Object.freeze({}) as Node;
}
