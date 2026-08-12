import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IsAwaitExpression,
  IsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "./effect.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles a direct callable copied through one immutable alias", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
const alias = value;
export const result = await alias();
`);

  assert.deepEqual(result.counts, {
    candidates: 1,
    settled: 1,
    retained: 0,
    callables: 1,
    awaits: 1,
    remainingAsync: 0,
    remainingAwait: 0,
    remainingPromiseTypes: 0,
    reasons: [],
  });
});

test("settles an exact instance method copied as a method value", () => {
  const result = lower(`
class Counter {
  async next(value: number): Promise<number> { return value + 1; }
}
const counter = new Counter();
const next = counter.next;
export const result = await next(41);
`);

  assert.deepEqual(result.counts, {
    candidates: 1,
    settled: 1,
    retained: 0,
    callables: 1,
    awaits: 1,
    remainingAsync: 0,
    remainingAwait: 0,
    remainingPromiseTypes: 0,
    reasons: [],
  });
});

test("settles a nonescaping callback parameter and its complete signature", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
function invoke(callback: () => number | PromiseLike<number>) {
  return callback();
}
export const result = await invoke(value);
`);

  assert.deepEqual(result.counts, {
    candidates: 1,
    settled: 1,
    retained: 0,
    callables: 1,
    awaits: 1,
    remainingAsync: 0,
    remainingAwait: 0,
    remainingPromiseTypes: 0,
    reasons: [],
  });
});

test("settles a callback parameter fed through an immutable alias", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
const alias = value;
function invoke(callback: () => number | PromiseLike<number>) {
  return callback();
}
export const result = await invoke(alias);
`);

  assert.deepEqual(result.counts, {
    candidates: 1,
    settled: 1,
    retained: 0,
    callables: 1,
    awaits: 1,
    remainingAsync: 0,
    remainingAwait: 0,
    remainingPromiseTypes: 0,
    reasons: [],
  });
});

test("settles an async caller with its synchronous callback forwarder", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
const alias = value;
function invoke(callback: () => number | PromiseLike<number>) {
  return callback();
}
async function outer(): Promise<number> { return await invoke(alias); }
export const result = await outer();
`);

  assert.deepEqual(result.counts, {
    candidates: 2,
    settled: 2,
    retained: 0,
    callables: 2,
    awaits: 2,
    remainingAsync: 0,
    remainingAwait: 0,
    remainingPromiseTypes: 0,
    reasons: [],
  });
});

test("retains a callback when its forwarding result is observed", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
function invoke(callback: () => number | PromiseLike<number>) {
  return callback();
}
export const result = invoke(value);
`);

  assert.equal(result.counts.candidates, 1);
  assert.equal(result.counts.settled, 0);
  assert.equal(result.counts.retained, 1);
  assert.deepEqual(result.counts.reasons, ["promise-observed"]);
});

test("retains a callback when its synchronous forwarding contract is exported", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
export function invoke(callback: () => number | PromiseLike<number>) {
  return callback();
}
export const result = await invoke(value);
`);

  assert.equal(result.counts.candidates, 1);
  assert.equal(result.counts.settled, 0);
  assert.equal(result.counts.retained, 1);
  assert.deepEqual(result.counts.reasons, ["promise-observed"]);
});

test("retains a callback when the forwarding callable escapes through an alias", () => {
  const result = lower(`
async function value(): Promise<number> { return 42; }
function invoke(callback: () => number | PromiseLike<number>) {
  return callback();
}
const alias = invoke;
export const result = await alias(value);
`);

  assert.equal(result.counts.candidates, 1);
  assert.equal(result.counts.settled, 0);
  assert.equal(result.counts.retained, 1);
  assert.deepEqual(result.counts.reasons, ["escaping-callable"]);
});

test("inventories every async callable before selecting its disposition", () => {
  const result = lower(`
async function inferred() { return 1; }
async function* generated(): AsyncGenerator<number, void, unknown> { yield 1; }
class Base {
  async value(): Promise<number> { return 1; }
}
class Derived extends Base {
  override async value(): Promise<number> { return 2; }
}
async function settled(): Promise<number> { return 3; }
export const result = await settled();
`);

  assert.equal(result.counts.candidates, 5);
  assert.equal(result.counts.settled, 1);
  assert.equal(result.counts.retained, 4);
  assert.deepEqual(result.counts.reasons, [
    "incompatible-return",
    "open-dispatch",
  ]);
});

test("indexes synchronous result forwarding with proportional work", () => {
  const small = forwardingEvidence(16);
  const large = forwardingEvidence(32);

  assert.deepEqual(small, {
    callEntries: 32,
    referenceEntries: 144,
    ownerEvaluations: 16,
    consumerEdges: 16,
  });
  assert.deepEqual(large, {
    callEntries: small.callEntries * 2,
    referenceEntries: small.referenceEntries * 2,
    ownerEvaluations: small.ownerEvaluations * 2,
    consumerEdges: small.consumerEdges * 2,
  });
});

function forwardingEvidence(count: number) {
  const fixture = checkedEffectFixture(Array.from(
    { length: count },
    (_, index) => `
async function value${index}(): Promise<number> { return ${index}; }
function invoke${index}(callback: () => number | PromiseLike<number>) {
  return callback();
}
export const result${index} = await invoke${index}(value${index});`,
  ).join("\n"));
  const plan = createFixtureEffectPlan(fixture.source);
  assert.equal(plan.summary.candidateCount, count);
  assert.equal(plan.summary.settledCallableCount, count);
  return plan.summary.resultConsumption;
}

function lower(sourceText: string) {
  const fixture = checkedEffectFixture(sourceText);
  const plan = createFixtureEffectPlan(fixture.source);
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  return {
    plan,
    rewritten,
    counts: {
      candidates: plan.summary.candidateCount,
      settled: plan.summary.settledCallableCount,
      retained: plan.summary.retainedCallableCount,
      callables: rewritten.callableCount,
      awaits: rewritten.awaitCount,
      remainingAsync: countAsyncCallables(
        fixture.source,
        rewritten.sourceFile,
      ),
      remainingAwait: countNodes(
        fixture.source,
        rewritten.sourceFile,
        IsAwaitExpression,
      ),
      remainingPromiseTypes: countNodes(
        fixture.source,
        rewritten.sourceFile,
        (node) =>
          IsTypeReferenceNode(node) &&
          ["Promise", "PromiseLike"].includes(
            fixture.source.ast.text(fixture.source.ast.name(node)),
          ),
      ),
      reasons: plan.summary.fallbackReasons.map((entry) => entry.reason),
    },
  };
}
