import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses a property object directly for one closed synchronous call", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder { box = new Box(); }
class Increment { constructor(readonly amount: number) {} }
class BoxOps {
  static apply(box: Pointer<Box>, change: Increment): void {
    loadPointer(box).value += change.amount;
  }
}
const holder = new Holder();
BoxOps.apply(addressOf(holder.box), new Increment(1));
export const result = holder.box.value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    "address-of": "direct-object",
    load: "direct-object",
  });
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(lowered.runtimeAlias, undefined);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "addressOf"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "propertyLocation"), 0);
});

test("keeps non-ephemeral property addresses in exact locations", () => {
  const sources = [
    `function keep(pointer: Pointer<Box>): Pointer<Box> { return pointer; }
const escaped = keep(addressOf(holder.box));`,
    `async function readLater(pointer: Pointer<Box>): Promise<number> {
  await Promise.resolve();
  return loadPointer(pointer).value;
}
export const pending = readLater(addressOf(holder.box));`,
    `function readAfterUnknown(pointer: Pointer<Box>): number {
  unknown();
  return loadPointer(pointer).value;
}
export const observed = readAfterUnknown(addressOf(holder.box));`,
    `function replace(pointer: Pointer<Box>): void {
  storePointer(pointer, new Box());
}
replace(addressOf(holder.box));`,
    `function inspect(pointer: Pointer<Box>, action: () => void): number {
  action();
  return loadPointer(pointer).value;
}
export const observed = inspect(addressOf(holder.box), unknown);`,
    `function replaceDuringRead(pointer: Pointer<Box>): number {
  holder.box = new Box();
  return loadPointer(pointer).value;
}
export const observed = replaceDuringRead(addressOf(holder.box));`,
    `function consume(pointer: Pointer<Box>, ignored: number): number {
  return loadPointer(pointer).value + ignored;
}
function replaceField(): number { holder.box = new Box(); return 0; }
export const observed = consume(addressOf(holder.box), replaceField());`,
  ];
  for (const [index, sourceText] of sources.entries()) {
    const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, storePointer } from "./markers.js";
class Box { value = 1; }
class Holder { box = new Box(); }
declare function unknown(): void;
const holder = new Holder();
${sourceText}
`);
    const plan = createFixturePointerFlowPlan(fixture.source);
    const address = pointerOperations(fixture.source).find((operation) =>
      operation.operation === "address-of"
    );
    assert.ok(address !== undefined, `fixture ${index} has no address operation`);
    assert.equal(
      plan.representationFor(address.call),
      "location",
      `unsafe property-address fixture ${index}`,
    );
  }
});

function assertRepresentations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  expected: Readonly<Record<string, string>>,
): void {
  const actual: Record<string, string> = {};
  for (const operation of pointerOperations(source)) {
    actual[operation.operation] = plan.representationFor(operation.call);
  }
  assert.deepEqual(actual, expected);
}

function pointerOperations(
  source: TargetSourceProgram,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }
  return operations;
}
