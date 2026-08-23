import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEffectProvenanceComponentAdjacency,
} from "./component-adjacency.js";

test("stores one compact edge for each exact component dependency", () => {
  const pairs = [
    [1, 0],
    [1, 0],
    [2, 0],
    [2, 1],
  ] as const;
  const adjacency = createEffectProvenanceComponentAdjacency(3, (consume) => {
    for (const [destination, source] of pairs) {
      consume(destination, source);
    }
  });

  assert.deepEqual([...adjacency.dependencyOffsets], [0, 0, 1, 3]);
  assert.deepEqual([...adjacency.dependencies], [0, 0, 1]);
  assert.deepEqual([...adjacency.dependentOffsets], [0, 2, 3, 3]);
  assert.deepEqual([...adjacency.dependents], [1, 2, 2]);
});

test("fails closed when the edge source changes between passes", () => {
  let pass = 0;
  assert.throws(
    () => createEffectProvenanceComponentAdjacency(2, (consume) => {
      pass += 1;
      consume(1, 0);
      if (pass === 2) {
        consume(1, 0);
      }
    }),
    /edge source changed/u,
  );
});

test("rejects a component outside the selected graph", () => {
  assert.throws(
    () => createEffectProvenanceComponentAdjacency(1, (consume) => {
      consume(1, 0);
    }),
    /outside its graph/u,
  );
});
