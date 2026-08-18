import assert from "node:assert/strict";
import { test } from "node:test";
import { KindReturnStatement } from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
} from "../pointer/pointer.test-support.js";
import { createPointerResultContract } from "../pointer/result-contract.js";
import {
  countAsyncCallables,
} from "./effect.test-support.js";
import { createClosedCooperativeEffectPlan } from "./plan.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles a returned exact pointer after a synchronous project use", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
async function increment(pointer: Pointer<number>): Promise<void> {
  storePointer(pointer, loadPointer(pointer) + 1);
}
export async function create(): Promise<Pointer<number>> {
  const pointer = allocatePointer(40);
  await increment(pointer);
  return pointer;
}
export const result = loadPointer(await create());
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
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    2,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    2,
  );
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("settles an exact pointer-valued field projection", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Item {
  declare private readonly then?: never;
  value = 41;
}
class Slot {
  constructor(public item: Pointer<Item> | undefined) {}
}
async function selected(slot: Slot): Promise<Pointer<Item> | undefined> {
  return slot.item;
}
export const result = loadPointer((await selected(
  new Slot(allocatePointer(new Item())),
))!).value;
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: true,
  });
  const returnedField = program.nodesOfKind(KindReturnStatement)
    .map((statement) =>
      fixture.source.ast.as.AsReturnStatement(statement)?.Expression
    )
    .find((expression) =>
      expression !== undefined &&
      fixture.source.ast.is.IsPropertyAccessExpression(expression)
    );
  assert.ok(returnedField !== undefined);
  assert.equal(
    pointerPlan.valueRepresentationFor(returnedField),
    "direct-object",
  );
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    program,
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 1);
  assert.equal(plan.summary.settledAwaitCount, 1);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("settles an inferred canonical pointer result from a generic runtime contract", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
class Item {
  declare private readonly then?: never;
}
declare class RuntimeSlice<T> {
  get(index: number): T;
}
export async function selected(
  values: RuntimeSlice<Pointer<Item> | undefined>,
): Promise<Pointer<Item> | undefined> {
  return values.get(0);
}
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
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 1);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("does not infer pointer behavior from a structurally identical runtime result", () => {
  const fixture = checkedPointerFixture(`
interface OrdinaryPointer<T> { value: T }
class Item {
  declare private readonly then?: never;
}
declare class RuntimeSlice<T> {
  get(index: number): T;
}
export async function selected(
  values: RuntimeSlice<OrdinaryPointer<Item> | undefined>,
): Promise<OrdinaryPointer<Item> | undefined> {
  return values.get(0);
}
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
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    1,
  );
});

test("does not infer pointer behavior from an ordinary field shape", () => {
  const fixture = checkedPointerFixture(`
interface Thenable {
  then(resolve: (value: number) => void): void;
}
class Slot {
  constructor(public item: Thenable | undefined) {}
}
export async function selected(slot: Slot): Promise<Thenable | undefined> {
  return slot.item;
}
`);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(
      fixture.source,
      createFixturePointerFlowPlan(fixture.source),
    ),
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    1,
  );
});

test("retains a direct pointer projection whose pointee can assimilate", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
class ThenableItem {
  then(resolve: (value: number) => void): void { resolve(41); }
}
class Slot {
  constructor(public item: Pointer<ThenableItem>) {}
}
export async function selected(slot: Slot): Promise<Pointer<ThenableItem>> {
  return slot.item;
}
selected(new Slot(allocatePointer(new ThenableItem())));
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: true,
  });
  const returnedField = program.nodesOfKind(KindReturnStatement)
    .map((statement) =>
      fixture.source.ast.as.AsReturnStatement(statement)?.Expression
    )
    .find((expression) =>
      expression !== undefined &&
      fixture.source.ast.is.IsPropertyAccessExpression(expression)
    );
  assert.ok(returnedField !== undefined);
  assert.equal(
    pointerPlan.valueRepresentationFor(returnedField),
    "direct-object",
  );
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    program,
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    1,
  );
});

test("retains an owner with conflicting pointer-value contracts", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
class Item {
  declare private readonly then?: never;
}
class OtherItem {
  declare private readonly then?: never;
}
class Slot {
  constructor(public item: Pointer<Item> | Pointer<OtherItem>) {}
}
export async function selected(
  slot: Slot,
): Promise<Pointer<Item> | Pointer<OtherItem>> {
  return slot.item;
}
selected(new Slot(allocatePointer(new Item())));
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: true,
  });
  const returnedField = program.nodesOfKind(KindReturnStatement)
    .map((statement) =>
      fixture.source.ast.as.AsReturnStatement(statement)?.Expression
    )
    .find((expression) =>
      expression !== undefined &&
      fixture.source.ast.is.IsPropertyAccessExpression(expression)
    );
  assert.ok(returnedField !== undefined);
  assert.equal(pointerPlan.valueRepresentationFor(returnedField), undefined);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    program,
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    1,
  );
});
