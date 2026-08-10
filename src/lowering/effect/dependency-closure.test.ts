import assert from "node:assert/strict";
import { test } from "node:test";

import { closeDependencyCandidates } from "./dependency-closure.js";

test("removes every transitive predecessor of an open destination", () => {
  const declarations = Array.from({ length: 4_096 }, (_, index) => index);
  const dependencies = new Map<number, ReadonlySet<number>>();
  for (let index = 0; index < declarations.length; index += 1) {
    dependencies.set(index, new Set([index + 1]));
  }

  const closed = closeDependencyCandidates(
    new Set(declarations),
    [dependencies],
  );

  assert.deepEqual([...closed], []);
});

test("ignores dependency domains owned by a later closure", () => {
  const dependencies = new Map([[1, new Set([2, 3])]]);

  const closed = closeDependencyCandidates(
    new Set([1, 2]),
    [dependencies],
    (destination) => destination !== 3,
  );

  assert.deepEqual([...closed], [1, 2]);
});
