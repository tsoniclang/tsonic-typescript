import assert from "node:assert/strict";
import { test } from "node:test";

import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a result consumed through a private binding and await", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number> { return 42; }
const pending = leaf();
export const result = await pending;
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles a result consumed through an exact aggregate slot", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number> { return 42; }
const pending = [leaf()];
export const result = await pending[0];
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles a private reverse caller reached through an exact alias", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number> { return 42; }
function forward(): Promise<number> { return leaf(); }
const invoke = forward;
const pending = invoke();
export const result = await pending;
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("retains a result observed as a logical condition", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number | undefined> { return 42; }
const selected = leaf() ?? Promise.resolve(0);
export const result = await selected;
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    1,
  );
});

test("settles an uninitialized local and closed field as undefined", () => {
  const fixture = checkedEffectFixture(`
class Box { value: number | PromiseLike<number> | undefined; }
const box = new Box();
async function local(): Promise<number | undefined> {
  let value: number | PromiseLike<number> | undefined;
  return value;
}
async function field(): Promise<number | undefined> {
  return box.value;
}
export const result = [await local(), await field()];
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("retains a closed field after a thenable write", () => {
  const fixture = checkedEffectFixture(`
class Box { value: number | PromiseLike<number> | undefined; }
const box = new Box();
box.value = Promise.resolve(42);
async function field(): Promise<number | undefined> {
  return box.value;
}
export const result = await field();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});
