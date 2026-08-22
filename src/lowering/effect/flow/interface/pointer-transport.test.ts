import assert from "node:assert/strict";
import { test } from "node:test";

import { createTargetProgramIndex } from "../../../program-index.js";
import { createPointerInvocationTransport } from "../../../pointer/invocation-transport.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
} from "../../../pointer/pointer.test-support.js";
import { createPointerResultContract } from "../../../pointer/result-contract.js";
import { countAsyncCallables } from "../../test-support/fixture.test-support.js";
import { createClosedCooperativeEffectPlan } from "../../planning/plan.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

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
    createPointerInvocationTransport(fixture.source, pointerPlan),
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

test("does not treat exact pointer projection callbacks as opaque escapes", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, projectPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class DirectReader implements Reader {
  async Read(): Promise<number> { return 41; }
}
class Holder {
  constructor(public reader: Reader) {}
}
const source: Pointer<Holder> = allocatePointer(new Holder(new DirectReader()));
projectPointer<Holder, Holder>(source, value => value, value => value);
async function read(reader: Reader): Promise<number> {
  return (await reader.Read()) + 1;
}
export const result = await read(new DirectReader());
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
    createPointerInvocationTransport(fixture.source, pointerPlan),
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
  assert.equal(evidence.settledFamilyCount, 1, JSON.stringify(evidence));
  assert.equal(evidence.retainedFamilyCount, 0);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("does not invent a value origin for a pointer projection result", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, projectPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
declare const external: Reader;
const source: Pointer<number> = allocatePointer(1);
const projected = projectPointer<number, Reader>(
  source,
  () => external,
  () => 0,
);
async function read(): Promise<number> {
  return await loadPointer(projected!).Read();
}
export const result = await read();
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
    createPointerInvocationTransport(fixture.source, pointerPlan),
    "declared-closed",
  );
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.retainedFamilyCount, 1);
  assert.ok(evidence.boundaryCauses.some((cause) =>
    cause.reason === "unproven-value-origin"
  ));
});

test("does not treat exact pointer binding callbacks as opaque escapes", () => {
  const fixture = checkedPointerFixture(`
import { bindPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class DirectReader implements Reader {
  async Read(): Promise<number> { return 41; }
}
let holder = new DirectReader() as Reader;
bindPointer<Reader>({}, () => holder, value => { holder = value; });
async function read(reader: Reader): Promise<number> {
  return (await reader.Read()) + 1;
}
export const result = await read(new DirectReader());
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
    createPointerInvocationTransport(fixture.source, pointerPlan),
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
  assert.equal(evidence.settledFamilyCount, 1, JSON.stringify(evidence));
  assert.equal(evidence.retainedFamilyCount, 0);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("settles optional interface storage behind an exact nil guard", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface TypeData { AsStructuredType(): Awaitable<number | undefined>; }
class Adapter implements TypeData {
  async AsStructuredType(): Promise<number | undefined> { return 42; }
}
class Type {
  constructor(public data: TypeData | undefined) {}
  static zero(): Pointer<Type> { return allocatePointer(new Type(void 0)); }
  static async AsStructuredType(
    value: Pointer<Type> | undefined,
  ): Promise<number | undefined> {
    const receiver = loadPointer(value ?? fail()).data;
    return await receiver!.AsStructuredType();
  }
}
function fail(): never { throw new Error("nil"); }
async function create(): Promise<number | undefined> {
  let data: TypeData | undefined = void 0;
  data = new Adapter();
  const value = allocatePointer(new Type(data));
  return await Type.AsStructuredType(value);
}
Type.zero();
export const result = await create();
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
    createPointerInvocationTransport(fixture.source, pointerPlan),
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
  assert.equal(
    evidence.settledFamilyCount,
    1,
    JSON.stringify(evidence),
  );
  assert.equal(evidence.retainedFamilyCount, 0);
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("retains interface storage behind an open pointer fallback", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
class Holder { constructor(public reader: Reader) {} }
declare const external: Pointer<Holder>;
async function read(value: Pointer<Holder> | undefined): Promise<number> {
  return await loadPointer(value ?? external).reader.Read();
}
const local = allocatePointer(new Holder(new Pair()));
export const result = await read(local);
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
    createPointerInvocationTransport(fixture.source, pointerPlan),
    "declared-closed",
  );
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.retainedFamilyCount, 1);
});
