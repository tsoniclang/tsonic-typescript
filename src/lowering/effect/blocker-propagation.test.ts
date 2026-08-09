import assert from "node:assert/strict";
import { test } from "node:test";

import {
  propagateEffectBlockers,
  type EffectDependencyVertex,
} from "./blocker-propagation.js";

test("propagates blockers with one bounded reverse-edge worklist", () => {
  const vertices = Array.from({ length: 4_096 }, () => ({
    dependencies: new Set<EffectDependencyVertex>(),
    blocked: false,
  }));
  for (let index = 0; index < vertices.length - 1; index += 1) {
    vertices[index]?.dependencies.add(vertices[index + 1]!);
  }
  vertices.at(-1)!.blocked = true;

  const evidence = propagateEffectBlockers(vertices);

  assert.ok(vertices.every((vertex) => vertex.blocked));
  assert.deepEqual(evidence, {
    vertices: 4_096,
    edges: 4_095,
    work: 12_286,
  });
});
