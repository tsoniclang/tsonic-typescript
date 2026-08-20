import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IsAwaitExpression,
} from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a closed callable array through direct pop", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<void> {}
async function owner(): Promise<void> {
  const callbacks: (() => Promise<void>)[] = [];
  callbacks.push(async (): Promise<void> => { await leaf(); });
  const callback = callbacks.pop()!;
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsAwaitExpression), 0);
});

test("settles a closed callable array through an exact generic extractor", () => {
  const fixture = checkedEffectFixture(`
function removeLast<T>(values: T[]): T {
  const value = values.pop();
  if (value === undefined) throw new Error("empty");
  return value;
}
async function leaf(): Promise<void> {}
async function owner(): Promise<void> {
  const callbacks: (() => Promise<void>)[] = [];
  callbacks.push(async (): Promise<void> => { await leaf(); });
  const callback = removeLast(callbacks);
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a closed callable array through an exact indirect extractor", () => {
  const fixture = checkedEffectFixture(`
function removeLast<T>(values: T[]): T {
  const value = values.pop();
  if (value === undefined) throw new Error("empty");
  return value;
}
const extract: typeof removeLast = removeLast;
async function leaf(): Promise<void> {}
async function owner(): Promise<void> {
  const callbacks: (() => Promise<void>)[] = [];
  callbacks.push(async (): Promise<void> => { await leaf(); });
  const callback = extract(callbacks);
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a closed callable array through an overloaded extractor", () => {
  const fixture = checkedEffectFixture(`
function removeLast<T>(values: T[]): T;
function removeLast<T>(values: T[]): T {
  const value = values.pop();
  if (value === undefined) throw new Error("empty");
  return value;
}
async function leaf(): Promise<void> {}
async function owner(): Promise<void> {
  const callbacks: (() => Promise<void>)[] = [];
  callbacks.push(async (): Promise<void> => { await leaf(); });
  const callback = removeLast(callbacks);
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves a callable array exposed to an unknown consumer", () => {
  const fixture = checkedEffectFixture(`
declare function expose(values: (() => Promise<void>)[]): void;
async function owner(): Promise<void> {
  const callbacks: (() => Promise<void>)[] = [];
  callbacks.push(async (): Promise<void> => {});
  expose(callbacks);
  const callback = callbacks.pop()!;
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps every producer of one callable contract atomic", () => {
  const fixture = checkedEffectFixture(`
declare function remote(): Promise<void>;
async function owner(): Promise<void> {
  const callbacks: (() => Promise<void>)[] = [];
  callbacks.push(async (): Promise<void> => {});
  callbacks.push(async (): Promise<void> => { await remote(); });
  const callback = callbacks.pop()!;
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 3);
});

test("does not classify same-spelled methods on a custom collection", () => {
  const fixture = checkedEffectFixture(`
class CallbackStack {
  private readonly values: (() => Promise<void>)[] = [];
  push(value: () => Promise<void>): void { this.values.push(value); }
  pop(): () => Promise<void> { return this.values.pop()!; }
}
async function owner(): Promise<void> {
  const callbacks = new CallbackStack();
  callbacks.push(async (): Promise<void> => {});
  const callback = callbacks.pop();
  await callback();
}
export const result = await owner();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});
