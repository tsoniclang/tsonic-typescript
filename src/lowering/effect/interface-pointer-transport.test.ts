import assert from "node:assert/strict";
import { test } from "node:test";

import { createTargetProgramIndex } from "../program-index.js";
import { createPointerStorageOwnerTransport } from "../pointer/owner-transport.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
} from "../pointer/pointer.test-support.js";
import { createPointerResultContract } from "../pointer/result-contract.js";
import { countAsyncCallables } from "./effect.test-support.js";
import { createClosedCooperativeEffectPlan } from "./plan.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles interface dispatch transported through an exact pointer load", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class DirectReader implements Reader {
  async Read(): Promise<number> { return 41; }
}
class Holder {
  constructor(public reader: Reader) {}
}
async function read(holder: Pointer<Holder>): Promise<number> {
  return (await loadPointer(holder).reader.Read()) + 1;
}
const holder = allocatePointer(new Holder(new DirectReader()));
export const result = await read(holder);
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: true,
  });
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    program,
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
    createPointerStorageOwnerTransport(fixture.source, pointerPlan),
    "declared-closed",
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 1);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(plan.summary.settledAwaitCount, 2);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("retains the same interface dispatch without exact transport evidence", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class DirectReader implements Reader {
  async Read(): Promise<number> { return 41; }
}
class Holder {
  constructor(public reader: Reader) {}
}
async function read(holder: Pointer<Holder>): Promise<number> {
  return (await loadPointer(holder).reader.Read()) + 1;
}
const holder = allocatePointer(new Holder(new DirectReader()));
export const result = await read(holder);
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
    undefined,
    "declared-closed",
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 0);
  assert.ok(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ) > 0,
  );
});
