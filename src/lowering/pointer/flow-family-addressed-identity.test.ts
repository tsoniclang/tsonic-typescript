import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses fresh addressed factory values for pointer identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, hashPointer, loadPointer, storePointer } from "./markers.js";
class Box {
  declare private readonly $goType: void;
  constructor(public value: number) {}
  declare private readonly then?: never;
}
function fresh(value: number): Box { return new Box(value); }
function reset(pointer: Pointer<Box>, value: number): void {
  storePointer(pointer, fresh(value));
}
let first = fresh(1);
let second = fresh(2);
const left: Pointer<Box> = addressOf(first);
const alias = left;
const right: Pointer<Box> = addressOf(second);
reset(alias, 3);
export const result = [
  loadPointer(left).value,
  equalPointer(left, alias),
  equalPointer(left, right),
  hashPointer(left) === hashPointer(alias),
];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(plan.directObjectReplacementCount, 1);
  assert.equal(plan.retainedFamilyCount, 0);
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      const operation = fixture.source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (operation !== undefined) {
        assert.equal(plan.representationFor(operation.call), "direct-object");
      }
    });
  }

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  for (const marker of [
    "addressOf",
    "equalPointer",
    "hashPointer",
    "loadPointer",
    "storePointer",
  ]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, marker), 0);
  }
  assert.equal(countCallsNamed(
    fixture.source,
    lowered.sourceFile,
    "$tsonicReplace",
  ), 1);
});

test("retains addressed aliases that share one object identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const shared = new Box(1);
let first = shared;
let second = shared;
const left: Pointer<Box> = addressOf(first);
const right: Pointer<Box> = addressOf(second);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});

test("rejects a free factory that returns shared state", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const shared = new Box(1);
function sharedBox(): Box { return shared; }
let first = sharedBox();
let second = sharedBox();
const left: Pointer<Box> = addressOf(first);
const right: Pointer<Box> = addressOf(second);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});
