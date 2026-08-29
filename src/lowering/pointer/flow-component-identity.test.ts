import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("settles fresh identity beside a disjoint generic contract", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, loadPointer, storePointer } from "./markers.js";
import { GenericInvoker } from "./generic.js";
class Box { constructor(public value: number) {} }
const replace = (value: Pointer<Box>): void => storePointer(value, new Box(3));
GenericInvoker.invoke<Box>(replace);
const left: Pointer<Box> = allocatePointer(new Box(1));
const right: Pointer<Box> = allocatePointer(new Box(2));
export const same = equalPointer(left, right);
export const result = loadPointer(left).value;
`, {
    "/src/generic.ts": `import type { Pointer } from "./markers.js";
export class GenericInvoker {
  static invoke<T>(callback: (pointer: Pointer<T>) => void): void {
    void callback;
  }
}
`,
  });
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations = pointerOperations(fixture);
  const identityComponent = operations.filter((operation) =>
    operation.operation === "allocate" ||
    operation.operation === "equal-pointer" ||
    operation.operation === "load"
  );
  const store = operations.find((operation) => operation.operation === "store");

  assert.ok(identityComponent.length > 0);
  assert.ok(store !== undefined);
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "generic-call"
  ));
  assert.deepEqual(
    new Set(identityComponent.map((operation) =>
      plan.representationFor(operation.call)
    )),
    new Set(["direct-object"]),
  );
  assert.equal(plan.representationFor(store.call), "location");
  assert.equal(plan.settledLocalIdentityComponentCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  for (const marker of ["allocatePointer", "equalPointer", "loadPointer"]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, marker), 0);
  }
  assert.ok(lowered.runtimeAlias !== undefined);
});

test("settles fresh identity beside a disjoint unreplaceable store", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, allocatePointer, equalPointer, loadPointer, storePointer } from "./markers.js";
class Box {
  constructor(public value: number) {}
  get doubled(): number { return this.value * 2; }
}
let storage = new Box(1);
const stored: Pointer<Box> = addressOf(storage);
storePointer(stored, new Box(2));
const left: Pointer<Box> = allocatePointer(new Box(3));
const right: Pointer<Box> = allocatePointer(new Box(4));
export const same = equalPointer(left, right);
export const result = loadPointer(left).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations = pointerOperations(fixture);
  const identityComponent = operations.filter((operation) =>
    operation.operation === "allocate" ||
    operation.operation === "equal-pointer" ||
    operation.operation === "load"
  );
  const storedComponent = operations.filter((operation) =>
    operation.operation === "address-of" || operation.operation === "store"
  );

  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "pointee-replacement"
  ));
  assert.deepEqual(
    new Set(identityComponent.map((operation) =>
      plan.representationFor(operation.call)
    )),
    new Set(["direct-object"]),
  );
  assert.deepEqual(
    new Set(storedComponent.map((operation) =>
      plan.representationFor(operation.call)
    )),
    new Set(["location"]),
  );
  assert.equal(plan.settledLocalIdentityComponentCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  for (const marker of ["allocatePointer", "equalPointer", "loadPointer"]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, marker), 0);
  }
  assert.ok(lowered.runtimeAlias !== undefined);
});

test("retains a locally non-bijective identity component", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const shared = new Box(1);
const left: Pointer<Box> = allocatePointer(shared);
const right: Pointer<Box> = allocatePointer(shared);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.deepEqual(
    new Set(pointerOperations(fixture).map((operation) =>
      plan.representationFor(operation.call)
    )),
    new Set(["location"]),
  );
  assert.equal(plan.settledLocalIdentityComponentCount, 0);
});

function pointerOperations(
  fixture: ReturnType<typeof checkedPointerFixture>,
): readonly PointerOperationFact[] {
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
  return operations;
}
