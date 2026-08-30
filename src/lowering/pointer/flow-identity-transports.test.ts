import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("transports a pointer through an exact private static identity method", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, loadPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class PointerMap {
  private static copy(value: Pointer<Box> | undefined): Pointer<Box> | undefined {
    return value;
  }
  static pass(value: Pointer<Box> | undefined): Pointer<Box> | undefined {
    return PointerMap.copy(value);
  }
}
const pointer = allocatePointer(new Box(1));
const copied = PointerMap.pass(pointer)!;
export const result = [loadPointer(copied).value, equalPointer(pointer, copied)];
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.identityTransportCallCount, 1);
  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(plan.retainedFamilyCount, 0);

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "equalPointer"), 0);
});

test("rejects a private static method that does not return its parameter", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
class Box { constructor(public value: number) {} }
class PointerMap {
  private static shared = allocatePointer(new Box(1));
  private static copy(value: Pointer<Box> | undefined): Pointer<Box> | undefined {
    void value;
    return PointerMap.shared;
  }
  static pass(value: Pointer<Box> | undefined): Pointer<Box> | undefined {
    return PointerMap.copy(value);
  }
}
export const result = PointerMap.pass(allocatePointer(new Box(2)));
`);

  assert.equal(
    createFixturePointerFlowPlan(fixture.source).identityTransportCallCount,
    0,
  );
});

test("rejects public generic and inexact-result identity methods", () => {
  const publicFixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
class Box { value = 1; }
class PointerMap {
  static copy(value: Pointer<Box>): Pointer<Box> { return value; }
  static pass(value: Pointer<Box>): Pointer<Box> { return PointerMap.copy(value); }
}
export const pass = PointerMap.pass;
`);
  const genericFixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
class Box { value = 1; }
class PointerMap {
  private static copy<T>(value: Pointer<T>): Pointer<T> { return value; }
  static pass(value: Pointer<Box>): Pointer<Box> { return PointerMap.copy(value); }
}
export const pass = PointerMap.pass;
`);
  const inexactFixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
class Box { value = 1; }
class PointerMap {
  private static copy(value: Pointer<Box>): Pointer<Box> | undefined { return value; }
  static pass(value: Pointer<Box>): Pointer<Box> | undefined { return PointerMap.copy(value); }
}
export const pass = PointerMap.pass;
`);

  for (const fixture of [publicFixture, genericFixture, inexactFixture]) {
    assert.equal(
      createFixturePointerFlowPlan(fixture.source).identityTransportCallCount,
      0,
    );
  }
});
