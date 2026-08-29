import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pointerOperationFactKey,
  type PointerOperationFact,
} from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses a direct object for stable addressed property storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class Owner { constructor(public box: Box) {} }
const owner = new Owner(new Box(1));
const pointer: Pointer<Box> = addressOf(owner.box);
export const result = loadPointer(pointer).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assertRepresentations(fixture, plan, "direct-object");
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "propertyLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("keeps addressed property storage live when that property is written", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class Owner {
  constructor(public box: Box) {}
  replace(value: Box): void { this.box = value; }
}
const owner = new Owner(new Box(1));
const pointer: Pointer<Box> = addressOf(owner.box);
owner.replace(new Box(2));
export const result = loadPointer(pointer).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assertRepresentations(fixture, plan, "location");
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "propertyLocation"), 1);
});

test("keeps addressed property storage live when its root is replaced", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class Owner { constructor(public box: Box) {} }
let owner = new Owner(new Box(1));
const pointer: Pointer<Box> = addressOf(owner.box);
owner = new Owner(new Box(2));
export const result = loadPointer(pointer).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assertRepresentations(fixture, plan, "location");
  assert.equal(
    countCallsNamed(fixture.source, lowered.sourceFile, "nestedPropertyLocation"),
    1,
  );
});

function assertRepresentations(
  fixture: ReturnType<typeof checkedPointerFixture>,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  expected: ReturnType<typeof plan.representationFor>,
): void {
  const operations: PointerOperationFact[] = [];
  visit(fixture.source, fixture.sourceFile, (node) => {
    const operation = fixture.source.sourceFacts.getFact(
      node,
      pointerOperationFactKey,
    );
    if (operation !== undefined && operation.call === node) {
      operations.push(operation);
    }
  });
  assert.equal(operations.length, 2);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), expected);
  }
}
