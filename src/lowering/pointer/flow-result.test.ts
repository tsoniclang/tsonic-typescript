import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { createClosedPointerFlowPlan } from "./flow-plan.js";
import {
  checkedPointerFixture,
  countCallsNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("carries a direct object through an exact function result", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
function make(): Pointer<Box> { return allocatePointer(new Box()); }
const pointer: Pointer<Box> = make();
export const result = loadPointer(pointer).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-object",
    load: "direct-object",
  });
  const result = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(result.runtimeAlias, undefined);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "loadPointer"), 0);
});

test("carries a direct object through an exact awaited function result", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
async function make(): Promise<Pointer<Box>> {
  await Promise.resolve();
  return allocatePointer(new Box());
}
export async function run(): Promise<number> {
  const pointer: Pointer<Box> = await make();
  return loadPointer(pointer).value;
}
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-object",
    load: "direct-object",
  });
});

test("keeps a pointer result canonical when its callable escapes", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function make(): Pointer<number> { return allocatePointer(1); }
const selected = make;
const pointer = selected();
export const result = loadPointer(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components.some((component) =>
    component.blockers.includes("indirect-call")
  ));
});

test("keeps cross-file callback parameters and results canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
import { copy } from "./provider.js";
function apply(
  callback: (pointer: Pointer<number>) => Pointer<number>,
  pointer: Pointer<number>,
): Pointer<number> {
  return callback(pointer);
}
const pointer = allocatePointer(1);
export const result = loadPointer(apply(copy, pointer));
`, {
    "/src/provider.ts": `import type { Pointer } from "./markers.js";
import { loadPointer, allocatePointer } from "./markers.js";
export function copy(pointer: Pointer<number>): Pointer<number> {
  return allocatePointer(loadPointer(pointer));
}
`,
  });
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components.some((component) =>
    component.blockers.includes("indirect-call")
  ));
});

test("closes a direct function result across an exact module import", () => {
  const fixture = checkedPointerFixture(`import { loadPointer } from "./markers.js";
import { make } from "./provider.js";
export const result = loadPointer(make());
`, {
    "/src/provider.ts": `import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
class Box { value = 1; }
export function make(): Pointer<Box> { return allocatePointer(new Box()); }
`,
  });
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-object",
    load: "direct-object",
  });
});

test("does not mistake a nested pointer type for a pointer result", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function makeFactory(): () => Pointer<number> {
  return () => allocatePointer(1);
}
const pointer = makeFactory()();
export const result = loadPointer(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
});

test("keeps an unawaited asynchronous pointer result canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
async function make(): Promise<Pointer<number>> {
  return allocatePointer(1);
}
export const result = make();
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
});

test("closes an exact pointer parameter flow across async suspension", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
async function read(pointer: Pointer<number>): Promise<number> {
  await Promise.resolve();
  return loadPointer(pointer);
}
const pointer = allocatePointer(1);
export const result = read(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-snapshot",
    load: "direct-snapshot",
  });
});

function pointerOperations(
  source: TargetSourceProgram,
): readonly PointerOperationFact[] {
  const result: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        result.push(operation);
      }
    });
  }
  return result;
}

function assertRepresentations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createClosedPointerFlowPlan>,
  expected: Readonly<Record<string, string>>,
): void {
  const actual = Object.fromEntries(pointerOperations(source).map((operation) => [
    operation.operation,
    plan.representationFor(operation.call),
  ]));
  assert.deepEqual(actual, expected);
}
