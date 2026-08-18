import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
} from "../../../pointer/pointer.test-support.js";
import { createPointerStorageOwnerTransport } from "../../../pointer/owner-transport.js";
import { createClosedCooperativeEffectPlan } from "../../planning/plan.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a generated-like public mutable callable field", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  declare private readonly brand: void;
  public constructor(public value: (() => Awaitable<number>) | undefined) {}
  static zero(): Slot { return new Slot(undefined); }
  static copy(source: Slot): Slot { return new Slot(source.value); }
}
async function base(): Promise<number> { return 40; }
const slot = Slot.zero();
slot.value = async (): Promise<number> => (await base()) + 1;
const copied = Slot.copy(slot);
export async function invoke(): Promise<number> {
  return (await copied.value!()) + 1;
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    3,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    3,
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

test("settles a generated-like callable owner through certified pointers", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, storePointer } from "./markers.js";
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  declare private readonly brand: void;
  public constructor(public value: (() => Awaitable<number>) | undefined) {}
  static zero(): Slot { return new Slot(undefined); }
}
async function base(): Promise<number> { return 40; }
let initial = Slot.zero();
const pointer: Pointer<Slot> = addressOf(initial);
storePointer(pointer, new Slot(async (): Promise<number> => (await base()) + 1));
async function invoke(): Promise<number> {
  return (await loadPointer(pointer).value!()) + 1;
}
export const result = await invoke();
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    undefined,
    createPointerStorageOwnerTransport(fixture.source, pointerPlan),
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    3,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    3,
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

test("retains public field flow across every open owner boundary", () => {
  const cases = [
    {
      name: "constructor alias",
      setup: "const Constructor = Slot; const slot = new Constructor(undefined);",
    },
    {
      name: "runtime inheritance",
      setup: "class Derived extends Slot {} const slot = new Slot(undefined);",
    },
    {
      name: "provider owner escape",
      prefix: "declare function expose(value: Slot): void;",
      setup: "const slot = new Slot(undefined); expose(slot);",
    },
    {
      name: "provider owner introduction",
      prefix: "declare function remote(): Slot;",
      setup: "const slot = remote();",
    },
    {
      name: "unselected pointer-like provider",
      prefix: "interface Box<T> { value: T } declare function addressOf<T>(value: T): Box<T>;",
      setup: "const slot = addressOf(new Slot(undefined)).value;",
    },
    {
      name: "owner widening",
      prefix: "declare function expose(value: unknown): void;",
      setup: "const slot = new Slot(undefined); const open: unknown = slot; expose(open);",
    },
    {
      name: "provider callable write",
      prefix: "declare function remote(): () => Awaitable<number>;",
      setup: "const slot = new Slot(undefined); slot.value = remote();",
    },
    {
      name: "field value escape",
      setup: "const slot = new Slot(async () => 42); export const escaped = slot.value;",
    },
  ];
  for (const selected of cases) {
    const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  declare private readonly brand: void;
  public constructor(public value: (() => Awaitable<number>) | undefined) {}
}
${selected.prefix ?? ""}
${selected.setup}
if (slot.value === undefined) slot.value = async (): Promise<number> => 42;
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);
    const originalAsyncCallables = countAsyncCallables(
      fixture.source,
      fixture.sourceFile,
    );
    const plan = createFixtureEffectPlan(fixture.source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();

    assert.equal(result.callableCount, 0, selected.name);
    assert.equal(
      countAsyncCallables(fixture.source, result.sourceFile),
      originalAsyncCallables,
      selected.name,
    );
  }
});
