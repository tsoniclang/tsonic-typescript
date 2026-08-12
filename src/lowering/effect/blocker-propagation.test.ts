import assert from "node:assert/strict";
import { test } from "node:test";

import {
  propagateEffectBlockers,
  type EffectDependencyVertex,
} from "./blocker-propagation.js";
import type { CooperativeEffectFallbackReason } from "./fallback.js";

test("propagates blockers with one bounded reverse-edge worklist", () => {
  const vertices = Array.from({ length: 4_096 }, () => ({
    dependencies: new Set<EffectDependencyVertex>(),
    blockers: new Set<CooperativeEffectFallbackReason>(),
  }));
  for (let index = 0; index < vertices.length - 1; index += 1) {
    vertices[index]?.dependencies.add(vertices[index + 1]!);
  }
  vertices.at(-1)!.blockers.add("unresolved-call");

  const evidence = propagateEffectBlockers(vertices);

  assert.ok(vertices.every((vertex) =>
    vertex.blockers.size === 1 && vertex.blockers.has("unresolved-call")
  ));
  assert.deepEqual(evidence, {
    vertices: 4_096,
    edges: 4_095,
    work: 12_286,
  });
});
