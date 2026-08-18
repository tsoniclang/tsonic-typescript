import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "../test-support/fixture.test-support.js";

test("reports every retained cooperative candidate by closed reason", () => {
  const sourceText = `
declare function remote(): Promise<number>;
async function boundary(): Promise<number> { return await remote(); }
async function caller(): Promise<number> { return await boundary(); }
async function escaped(): Promise<number> { return 1; }
export const callable: () => Promise<number> = escaped;
async function promiseValue(): Promise<number> { return Promise.resolve(2); }
async function settled(): Promise<number> { return 3; }
export const result = await settled();
`;
  const fixture = checkedEffectFixture(sourceText);

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
        directExamples: [authored(
          "escaped",
          sourceText.indexOf("export const callable"),
          "KindIdentifier",
        )],
      },
      {
        reason: "promise-producing-return",
        directCallableCount: 1,
        retainedCallableCount: 1,
        directExamples: [authored(
          "Promise.resolve(2)",
          0,
          "KindCallExpression",
        )],
      },
      {
        reason: "unresolved-call",
        directCallableCount: 1,
        retainedCallableCount: 2,
        directExamples: [authored(
          "remote()",
          sourceText.indexOf("boundary"),
          "KindCallExpression",
        )],
      },
    ],
    propagation: {
      vertices: 5,
      edges: 1,
      work: 7,
    },
    resultConsumption: {
      callEntries: 0,
      referenceEntries: 0,
      ownerEvaluations: 0,
      consumerEdges: 0,
    },
    interfaceDispatch: {
      profile: "open-structural",
      analyzed: false,
    },
  });

  function authored(
    spelling: string,
    from: number,
    syntaxKind: string,
  ) {
    const start = sourceText.indexOf(spelling, from);
    assert.ok(start >= 0);
    const sourceFile = fixture.source.navigation.sourceFiles.find((candidate) =>
      fixture.source.documents.forFile(candidate).identity === "/src/index.ts"
    );
    assert.ok(sourceFile !== undefined);
    return {
      kind: "authored" as const,
      documentIdentity: fixture.source.documents.forFile(sourceFile).identity,
      start,
      end: start + spelling.length,
      syntaxKind,
    };
  }
});

test("assigns one canonical reason to an overlapping retained candidate", () => {
  const fixture = checkedEffectFixture(`
async function selected(): Promise<number> { return Promise.resolve(1); }
export const callable = selected;
export const observed = selected();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);

  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(
    plan.summary.fallbackReasons.reduce(
      (total, reason) => total + reason.retainedCallableCount,
      0,
    ),
    1,
  );
  assert.deepEqual(
    plan.summary.fallbackReasons
      .filter((reason) => reason.retainedCallableCount !== 0)
      .map((reason) => reason.reason),
    ["escaping-callable"],
  );
  assert.deepEqual(
    plan.summary.fallbackReasons
      .filter((reason) => reason.directCallableCount !== 0)
      .map((reason) => reason.reason),
    ["escaping-callable", "promise-observed", "promise-producing-return"],
  );
});
