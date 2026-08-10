import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type {
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { createClosedPointerFlowPlan } from "./flow-plan.js";
import {
  checkedPointerFixture,
  countCallsNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses one direct object representation across a closed class family", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder { pointer: Pointer<Box> | undefined = undefined; }
function read(pointer: Pointer<Box> | undefined): number {
  return pointer === undefined ? 0 : loadPointer(pointer).value;
}
function invoke(
  callback: (pointer: Pointer<Box> | undefined) => number,
  pointer: Pointer<Box> | undefined,
): number {
  return callback(pointer);
}
const holder = new Holder();
holder.pointer = allocatePointer(new Box());
export const result = invoke(read, holder.pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
  const lowered = lowerPointers(
    fixture.source,
    fixture.sourceFile,
    plan,
  );
  assert.equal(lowered.runtimeAlias, undefined);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("keeps a class family canonical when pointee storage is replaced", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer(new Box());
storePointer(pointer, new Box());
export const result = loadPointer(pointer).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps a class family canonical for an unstable addressed variable", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer } from "./markers.js";
class Box { value = 1; }
let box = new Box();
const pointer: Pointer<Box> = addressOf(box);
box = new Box();
export const result = loadPointer(pointer).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps a class family canonical across an ambient boundary", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
import { observe } from "./external.js";
export class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer(new Box());
observe(pointer);
export const result = loadPointer(pointer).value;
`, {
    "/src/external.d.ts": `import type { Pointer } from "./markers.js";
import type { Box } from "./index.js";
export declare function observe(pointer: Pointer<Box>): void;
`,
  });

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps a class family canonical across a representation-bearing generic call", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
function singleton<T>(value: Pointer<T>): Array<Pointer<T>> {
  return [value];
}
const pointer: Pointer<Box> = allocatePointer(new Box());
export const result = loadPointer(singleton(pointer)[0]!).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("blocks a generic pointer call reached through concrete family storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder { pointer: Pointer<Box> | undefined = undefined; }
function singleton<T>(value: Pointer<T>): Array<Pointer<T>> {
  return [value];
}
const holder = new Holder();
holder.pointer = allocatePointer(new Box());
export const values = singleton(holder.pointer);
export const result = loadPointer(holder.pointer).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("allows a class family through a representation-neutral generic call", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
function identity<T>(value: T): T {
  return value;
}
const pointer: Pointer<Box> = allocatePointer(new Box());
export const result = loadPointer(identity(pointer)).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
});

test("keeps a class family canonical through generic pointer storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder<T> { pointer: Pointer<T> | undefined = undefined; }
const holder = new Holder<Box>();
holder.pointer = allocatePointer(new Box());
export const result = loadPointer(holder.pointer!).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps distinct pointer identity when one object is allocated twice", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, loadPointer } from "./markers.js";
class Box { value = 1; }
const box = new Box();
const left: Pointer<Box> = allocatePointer(box);
const right: Pointer<Box> = allocatePointer(box);
export const same = equalPointer(left, right);
export const result = loadPointer(left).value + loadPointer(right).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

function assertAllOperations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createClosedPointerFlowPlan>,
  expected: "direct-object" | "location",
): void {
  const operations = pointerOperations(source);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), expected);
  }
}

function pointerOperations(
  source: TargetSourceProgram,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(
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
