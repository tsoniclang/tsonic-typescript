import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../../rewrite/transform.js";

test("retains an inherited implementation with a Promise-only overload", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Base {
  Read(): Promise<number>;
  async Read(): Promise<number> { return 42; }
}
class Derived extends Base implements Reader {}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return await read(new Derived());
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 3);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 3);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.admittedFamilyCount, 1);
  assert.equal(evidence.implementationCount, 1);
  assert.equal(evidence.candidateImplementationCount, 1);
});

test("rewrites every inherited overload that admits direct values", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Base {
  Read(): Awaitable<number>;
  async Read(): Promise<number> { return 42; }
}
class Derived extends Base implements Reader {}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return await read(new Derived());
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 3);
  assert.equal(plan.summary.settledCallableCount, 3);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});
