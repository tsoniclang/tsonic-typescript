import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  checkedPointerFixtureWithValueSemantics,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses exact value-field objects as stable pointer identities", () => {
  const fixture = checkedPointerFixtureWithValueSemantics(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, loadPointer, storePointer } from "./markers.js";
class Box {
  constructor(public value: number) {}
  static copy(source: Box): Box { return new Box(source.value); }
}
class Owner { constructor(public box: Box) {} }
const first = new Owner(new Box(1));
const second = new Owner(Box.copy(first.box));
const left: Pointer<Box> = addressOf(first.box);
const alias: Pointer<Box> = addressOf(first.box);
const right: Pointer<Box> = addressOf(second.box);
storePointer(left, new Box(3));
export const result = [
  loadPointer(alias).value,
  equalPointer(left, alias),
  equalPointer(left, right),
];
`, ["Box", "Owner"]);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(plan.retainedFamilyCount, 0);
  assert.equal(plan.directObjectReplacementCount, 1);

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  for (const marker of [
    "addressOf",
    "equalPointer",
    "loadPointer",
    "storePointer",
  ]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, marker), 0);
  }
});

test("retains value-field addresses without exact owner value semantics", () => {
  const fixture = checkedPointerFixtureWithValueSemantics(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class Owner { constructor(public box: Box) {} }
const first = new Owner(new Box(1));
const second = new Owner(first.box);
const left: Pointer<Box> = addressOf(first.box);
const right: Pointer<Box> = addressOf(second.box);
export const same = equalPointer(left, right);
`, "Box");

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

test("retains an exact value field when the owner binding can change", () => {
  const fixture = checkedPointerFixtureWithValueSemantics(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class Owner { constructor(public box: Box) {} }
let owner = new Owner(new Box(1));
const left: Pointer<Box> = addressOf(owner.box);
owner = new Owner(new Box(2));
const right: Pointer<Box> = addressOf(owner.box);
export const same = equalPointer(left, right);
`, ["Box", "Owner"]);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
});

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
