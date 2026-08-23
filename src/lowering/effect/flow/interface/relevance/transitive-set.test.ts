import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTransitiveSetIndex,
  type TransitiveSetExpansion,
} from "./transitive-set.js";

interface Key {
  readonly name: string;
}

function key(name: string): Key {
  return { name };
}

test("settles shared recursive tails once with exact values", () => {
  const left = key("left");
  const right = key("right");
  const cycleA = key("cycle-a");
  const cycleB = key("cycle-b");
  const shared = key("shared");
  const expansions = new Map<Key, TransitiveSetExpansion<Key, string>>([
    [left, { values: ["left"], dependencies: [cycleA, shared] }],
    [right, { values: ["right"], dependencies: [cycleB, shared] }],
    [cycleA, { values: ["a"], dependencies: [cycleB] }],
    [cycleB, { values: ["b"], dependencies: [cycleA, shared] }],
    [shared, { values: ["shared"], dependencies: [] }],
  ]);
  const expansionCounts = new Map<Key, number>();
  const index = createTransitiveSetIndex<Key, string>((selected) => {
    expansionCounts.set(selected, (expansionCounts.get(selected) ?? 0) + 1);
    const expansion = expansions.get(selected);
    if (expansion === undefined) {
      throw new Error(`missing expansion for ${selected.name}`);
    }
    return expansion;
  });

  assert.deepEqual(
    new Set(index.valuesFor(left)),
    new Set(["left", "a", "b", "shared"]),
  );
  assert.deepEqual(
    new Set(index.valuesFor(right)),
    new Set(["right", "a", "b", "shared"]),
  );
  assert.deepEqual(
    [...expansionCounts.values()],
    [1, 1, 1, 1, 1],
  );
});

test("reuses a previously settled dependency for a later root", () => {
  const first = key("first");
  const second = key("second");
  const shared = key("shared");
  const expansions = new Map<Key, TransitiveSetExpansion<Key, string>>([
    [first, { values: ["first"], dependencies: [shared] }],
    [second, { values: ["second"], dependencies: [shared] }],
    [shared, { values: ["shared"], dependencies: [] }],
  ]);
  let expansionsCount = 0;
  const index = createTransitiveSetIndex<Key, string>((selected) => {
    expansionsCount += 1;
    const expansion = expansions.get(selected);
    if (expansion === undefined) {
      throw new Error(`missing expansion for ${selected.name}`);
    }
    return expansion;
  });

  assert.deepEqual(index.valuesFor(first), ["first", "shared"]);
  assert.equal(expansionsCount, 2);
  assert.deepEqual(index.valuesFor(second), ["second", "shared"]);
  assert.equal(expansionsCount, 3);
});
