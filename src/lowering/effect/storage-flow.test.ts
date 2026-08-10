import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import {
  countAsyncCallables,
  countNodes,
  checkedEffectFixture,
  createFixtureEffectPlan,
} from "./effect.test-support.js";
import { collectCallableStorageInputs } from "./storage-inputs.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles a closed callable storage field through an exact factory", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
  static zero(): Slot { return Slot.make(undefined); }
  static copy(source: Slot): Slot { return Slot.make(source.value); }
}
async function base(): Promise<number> { return 40; }
const slot = Slot.zero();
slot.value = async (): Promise<number> => (await base()) + 1;
async function invoke(): Promise<number> { return (await slot.value!()) + 1; }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      fixture.source.ast.is.IsAwaitExpression,
    ),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, (node) => {
      const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
      return reference !== undefined &&
        fixture.source.ast.text(reference.TypeName) === "Awaitable";
    }),
    0,
  );
});

test("settles a closed callable field through a mutable local", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
  static zero(): Slot { return Slot.make(undefined); }
}
const slot = Slot.zero();
slot.value = async (): Promise<number> => 41;
async function invoke(selected: boolean): Promise<number> {
  let callback: (() => Awaitable<number>) | undefined = slot.value;
  if (selected) callback = slot.value;
  return (await callback!()) + 1;
}
export const result = await invoke(true);
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      fixture.source.ast.is.IsAwaitExpression,
    ),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, (node) => {
      const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
      return reference !== undefined &&
        fixture.source.ast.text(reference.TypeName) === "Awaitable";
    }),
    0,
  );
});

test("keeps a mutable callable local canonical when it escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function expose(value: (() => Awaitable<number>) | undefined): void;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static zero(): Slot { return new Slot(undefined); }
}
const slot = Slot.zero();
slot.value = async (): Promise<number> => 42;
let callback: (() => Awaitable<number>) | undefined = slot.value;
expose(callback);
async function invoke(): Promise<number> { return await callback!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps a callable field open when its factory escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const factory = Slot.make;
const slot = factory(async (): Promise<number> => 42);
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps a callable field open when its value escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function expose(value: () => Awaitable<number>): void;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const slot = Slot.make(async (): Promise<number> => 42);
expose(slot.value!);
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("does not narrow a promise-only callable field", () => {
  const fixture = checkedEffectFixture(`
class Slot {
  private constructor(public value: (() => Promise<number>) | undefined) {}
  static make(value: (() => Promise<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const slot = Slot.make(async (): Promise<number> => 42);
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps a suspending producer and its field caller canonical", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const slot = Slot.make(async (): Promise<number> => await remote());
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("indexes callable parameter uses with bounded whole-program traversals", () => {
  const families = Array.from({ length: 32 }, (_, index) => `
class Slot${index} {
  private constructor(public value: (() => number | PromiseLike<number>) | undefined) {}
  static make(value: (() => number | PromiseLike<number>) | undefined): Slot${index} {
    return new Slot${index}(value);
  }
}
const slot${index} = Slot${index}.make(() => ${index});
const result${index} = slot${index}.value!();
`).join("\n");
  const fixture = checkedEffectFixture(families);
  const nodeCount = countNodes(
    fixture.source,
    fixture.sourceFile,
    () => true,
  );
  let childQueries = 0;
  const source = Object.freeze({
    ...fixture.source,
    ast: Object.freeze({
      ...fixture.source.ast,
      children(node: Node | undefined) {
        childQueries += 1;
        return fixture.source.ast.children(node);
      },
    }),
  });

  collectCallableStorageInputs(source, new Set());

  assert.ok(
    childQueries < nodeCount * 8,
    `expected bounded traversals, got ${childQueries} child queries for ${nodeCount} nodes`,
  );
});
