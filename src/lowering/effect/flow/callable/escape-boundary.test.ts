import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IsArrowFunction,
  IsAwaitExpression,
  IsCallExpression,
  IsThrowStatement,
} from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("retains a synchronous-looking producer at an open consumer", () => {
  const result = lower(`
type Awaitable<T> = T | PromiseLike<T>;
declare function install(callback: () => Awaitable<number>): void;
install(async (): Promise<number> => 41);
`);

  assert.deepEqual(result, {
    candidates: 1,
    settled: 0,
    retained: 1,
    settledAwaits: 0,
    asyncCallables: 1,
    awaits: 0,
    arrows: 1,
    calls: 1,
    throws: 0,
    reasons: [{ reason: "escaping-callable", direct: 1, retained: 1 }],
  });
});

test("retains rejected-Promise timing for a throwing escaped producer", () => {
  const result = lower(`
type Awaitable<T> = T | PromiseLike<T>;
class Failure extends Error {}
declare function install(callback: () => Awaitable<number>): void;
install(async (): Promise<number> => { throw new Failure("boom"); });
`);

  assert.deepEqual(result, {
    candidates: 1,
    settled: 0,
    retained: 1,
    settledAwaits: 0,
    asyncCallables: 1,
    awaits: 0,
    arrows: 1,
    calls: 1,
    throws: 1,
    reasons: [{ reason: "escaping-callable", direct: 1, retained: 1 }],
  });
});

test("consumer closure, not the Awaitable spelling, selects direct transport", () => {
  const open = lower(`
type Awaitable<T> = T | PromiseLike<T>;
declare function install(callback: () => Awaitable<number>): void;
install(async (): Promise<number> => 41);
`);
  const closed = lower(`
type Awaitable<T> = T | PromiseLike<T>;
const callback: () => Awaitable<number> = async (): Promise<number> => 41;
async function invoke(): Promise<number> { return await callback(); }
export const result = await invoke();
`);

  assert.equal(open.settled, 0);
  assert.equal(open.retained, 1);
  assert.equal(closed.settled, 2);
  assert.equal(closed.retained, 0);
  assert.deepEqual(closed.reasons, []);
  assert.equal(closed.asyncCallables, 0);
  assert.equal(closed.awaits, 0);
});

test("audits independent open producers with bounded propagation work", () => {
  const count = 128;
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function install(callback: () => Awaitable<number>): void;
${Array.from(
    { length: count },
    (_, index) => `install(async (): Promise<number> => ${index});`,
  ).join("\n")}
`);
  const plan = createFixtureEffectPlan(fixture.source);

  assert.equal(plan.summary.candidateCount, count);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, count);
  assert.deepEqual(reasonCounts(plan), [
    { reason: "escaping-callable", direct: count, retained: count },
  ]);
  assert.deepEqual(plan.summary.propagation, {
    vertices: count,
    edges: 0,
    work: count,
  });
});

function lower(sourceText: string) {
  const fixture = checkedEffectFixture(sourceText);
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  return {
    candidates: plan.summary.candidateCount,
    settled: plan.summary.settledCallableCount,
    retained: plan.summary.retainedCallableCount,
    settledAwaits: plan.summary.settledAwaitCount,
    asyncCallables: countAsyncCallables(fixture.source, result.sourceFile),
    awaits: countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    arrows: countNodes(fixture.source, result.sourceFile, IsArrowFunction),
    calls: countNodes(fixture.source, result.sourceFile, IsCallExpression),
    throws: countNodes(fixture.source, result.sourceFile, IsThrowStatement),
    reasons: reasonCounts(plan),
  };
}

function reasonCounts(plan: ReturnType<typeof createFixtureEffectPlan>) {
  return plan.summary.fallbackReasons.map((reason) => ({
    reason: reason.reason,
    direct: reason.directCallableCount,
    retained: reason.retainedCallableCount,
  }));
}
