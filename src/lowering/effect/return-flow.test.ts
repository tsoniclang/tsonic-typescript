import assert from "node:assert/strict";
import { test } from "node:test";

import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "./effect.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles a return value carried only through awaited replacement aliases", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
async function normalize(_value: Failure | undefined): Promise<Failure | undefined> {
  return undefined;
}
async function value(): Promise<Failure | undefined> {
  let result: Failure | undefined = undefined;
  const first = result;
  const second = first;
  result = await normalize(second);
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("preserves a return alias exposed outside its awaited replacement", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
function expose(_value: Failure | undefined): void {}
async function normalize(_value: Failure | undefined): Promise<Failure | undefined> {
  return undefined;
}
async function value(): Promise<Failure | undefined> {
  let result: Failure | undefined = undefined;
  const alias = result;
  expose(alias);
  result = await normalize(alias);
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a return alias captured by a nested callable", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
async function normalize(_value: Failure | undefined): Promise<Failure | undefined> {
  return undefined;
}
async function value(): Promise<Failure | undefined> {
  let result: Failure | undefined = undefined;
  const alias = result;
  const read = (): Failure | undefined => alias;
  result = await normalize(result);
  read();
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("settles a fresh exact project-class return", () => {
  const fixture = checkedEffectFixture(`
class Result {
  constructor(readonly value: number) {}
}
async function value(): Promise<Result> { return new Result(42); }
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves a fresh project class with callable then", () => {
  const fixture = checkedEffectFixture(`
class Thenable {
  constructor(readonly value: number) {}
  then(resolve: (value: number) => void): void { resolve(this.value); }
}
async function value(): Promise<unknown> { return new Thenable(42); }
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});
