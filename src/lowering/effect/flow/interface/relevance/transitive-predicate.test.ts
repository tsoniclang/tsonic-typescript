import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTransitivePredicateIndex,
  type TransitivePredicateExpansion,
} from "./transitive-predicate.js";

interface Key {
  readonly name: string;
}

function key(name: string): Key {
  return { name };
}

test("settles shared recursive tails once with exact membership", () => {
  const left = key("left");
  const right = key("right");
  const cycleA = key("cycle-a");
  const cycleB = key("cycle-b");
  const shared = key("shared");
  const expansions = new Map<Key, TransitivePredicateExpansion<Key>>([
    [left, { matches: false, dependencies: [cycleA, shared] }],
    [right, { matches: false, dependencies: [cycleB, shared] }],
    [cycleA, { matches: false, dependencies: [cycleB] }],
    [cycleB, { matches: false, dependencies: [cycleA] }],
    [shared, { matches: true, dependencies: [] }],
  ]);
  const expansionCounts = new Map<Key, number>();
  const index = createTransitivePredicateIndex<Key>((selected) => {
    expansionCounts.set(selected, (expansionCounts.get(selected) ?? 0) + 1);
    const expansion = expansions.get(selected);
    if (expansion === undefined) {
      throw new Error(`missing expansion for ${selected.name}`);
    }
    return expansion;
  });

  assert.equal(index.matches(left), true);
  assert.equal(index.matches(right), true);
  assert.deepEqual([...expansionCounts.values()], [1, 1, 1, 1, 1]);
});

test("reuses settled positive and negative dependencies", () => {
  const positive = key("positive");
  const positiveRoot = key("positive-root");
  const negativeA = key("negative-a");
  const negativeB = key("negative-b");
  const negativeRoot = key("negative-root");
  const expansions = new Map<Key, TransitivePredicateExpansion<Key>>([
    [positive, { matches: true, dependencies: [] }],
    [positiveRoot, { matches: false, dependencies: [positive] }],
    [negativeA, { matches: false, dependencies: [negativeB] }],
    [negativeB, { matches: false, dependencies: [negativeA] }],
    [negativeRoot, { matches: false, dependencies: [negativeA] }],
  ]);
  let expansionCount = 0;
  const index = createTransitivePredicateIndex<Key>((selected) => {
    expansionCount += 1;
    const expansion = expansions.get(selected);
    if (expansion === undefined) {
      throw new Error(`missing expansion for ${selected.name}`);
    }
    return expansion;
  });

  assert.equal(index.matches(positive), true);
  assert.equal(index.matches(positiveRoot), true);
  assert.equal(index.matches(negativeA), false);
  assert.equal(index.matches(negativeRoot), false);
  assert.equal(expansionCount, 5);
});
