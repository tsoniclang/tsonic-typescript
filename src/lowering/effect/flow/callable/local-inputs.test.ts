import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a closed mutable local with a synchronous callable contract", () => {
  const fixture = checkedEffectFixture(`
export async function combine(selected: boolean): Promise<string> {
  let result: (() => string) | undefined = (): string => "first";
  if (selected) result = (): string => "second";
  return await result!();
}
export const result = await combine(true);
`);

  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
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
});

test("settles a closed generic callback with a type-parameter result", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
async function select<T>(
  value: T,
  project: (value: T) => Awaitable<T>,
): Promise<T> {
  return await project(value);
}
async function increment(value: number): Promise<number> {
  return value + 1;
}
export const result = await select(41, increment);
`);

  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
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
});
