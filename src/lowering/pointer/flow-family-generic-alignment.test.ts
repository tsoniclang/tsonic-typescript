import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";

test("aligns an outer generic pointer without capturing its nested pointer argument", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";

class Box { constructor(public value: number) {} }
function compareSlots<T>(
  compare: (
    left: Pointer<T> | undefined,
    right: Pointer<T> | undefined,
  ) => boolean,
): boolean {
  void compare;
  return false;
}

const pointer: Pointer<Box> = allocatePointer(new Box(42));
void compareSlots<Pointer<Box> | undefined>((left, right) => left === right);
export const result = loadPointer(pointer).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      const operation = fixture.source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }

  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(
    plan.familyFallbackReasons.some((entry) =>
      entry.reason === "generic-call"
    ),
    false,
  );
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), "direct-object");
  }
});
