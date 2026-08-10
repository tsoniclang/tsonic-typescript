import assert from "node:assert/strict";
import { test } from "node:test";

import { checkedEffectFixture } from "./effect.test-support.js";
import { createClosedCooperativeEffectPlan } from "./plan.js";

test("reports every retained cooperative candidate by closed reason", () => {
  const fixture = checkedEffectFixture(`
declare function remote(): Promise<number>;
async function boundary(): Promise<number> { return await remote(); }
async function caller(): Promise<number> { return await boundary(); }
async function escaped(): Promise<number> { return 1; }
export const callable: () => Promise<number> = escaped;
async function promiseValue(): Promise<number> { return Promise.resolve(2); }
async function settled(): Promise<number> { return 3; }
export const result = await settled();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);

  assert.deepEqual(plan.summary, {
    candidateCount: 5,
    settledCallableCount: 1,
    retainedCallableCount: 4,
    settledAwaitCount: 1,
    fallbackReasons: [
      {
        reason: "escaping-callable",
        directCallableCount: 1,
        retainedCallableCount: 1,
      },
      {
        reason: "promise-producing-return",
        directCallableCount: 1,
        retainedCallableCount: 1,
      },
      {
        reason: "unresolved-call",
        directCallableCount: 1,
        retainedCallableCount: 2,
      },
    ],
    propagation: {
      vertices: 5,
      edges: 1,
      work: 7,
    },
  });
});
