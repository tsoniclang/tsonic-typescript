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
  const { awaitAttribution, ...summary } = plan.summary;

  assert.deepEqual(summary, {
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
      edges: 2,
      components: 5,
      work: 12,
    },
    resultConsumption: {
      callEntries: 4,
      referenceEntries: 21,
      ownerEvaluations: 0,
      consumerEdges: 0,
    },
    interfaceDispatch: {
      profile: "open-structural",
      analyzed: false,
    },
  });
  const boundaryDeclaration = authored(
    "async function boundary(): Promise<number> { return await remote(); }",
    0,
    "KindFunctionDeclaration",
  );
  const callerDeclaration = authored(
    "async function caller(): Promise<number> { return await boundary(); }",
    0,
    "KindFunctionDeclaration",
  );
  const boundaryAwait = authored(
    "await remote()",
    0,
    "KindAwaitExpression",
  );
  const callerAwait = authored(
    "await boundary()",
    0,
    "KindAwaitExpression",
  );
  const remoteCall = authored(
    "remote()",
    sourceText.indexOf("boundary"),
    "KindCallExpression",
  );
  const boundaryCall = authored(
    "boundary()",
    sourceText.indexOf("caller"),
    "KindCallExpression",
  );
  assert.deepEqual({
    total: awaitAttribution.totalAwaitCount,
    settled: awaitAttribution.settledAwaitCount,
    retained: awaitAttribution.retainedAwaitCount,
    outside: awaitAttribution.outsideCandidateAwaitCount,
    reasons: awaitAttribution.retainedReasons,
    edges: awaitAttribution.retentionEdges,
    owners: awaitAttribution.retainedOwners.map((owner) => ({
      owner: owner.owner,
      reason: owner.reason,
      edge: owner.retentionEdge,
      count: owner.awaitCount,
      awaits: owner.awaitExamples,
      root: owner.canonicalRoot.occurrence,
      path: owner.canonicalRoot.path,
      steps: owner.canonicalRoot.steps,
    })),
    outsideExamples: awaitAttribution.outsideCandidateExamples,
  }, {
    total: 3,
    settled: 1,
    retained: 2,
    outside: 0,
    reasons: [{
      reason: "unresolved-call",
      awaitCount: 2,
      rootCount: 1,
      awaitExamples: [boundaryAwait, callerAwait],
      rootExamples: [remoteCall],
    }],
    edges: [
      { edge: "direct", awaitCount: 1, awaitExamples: [boundaryAwait] },
      { edge: "return", awaitCount: 1, awaitExamples: [callerAwait] },
    ],
    owners: [
      {
        owner: boundaryDeclaration,
        reason: "unresolved-call",
        edge: "direct",
        count: 1,
        awaits: [boundaryAwait],
        root: remoteCall,
        path: [boundaryDeclaration],
        steps: [],
      },
      {
        owner: callerDeclaration,
        reason: "unresolved-call",
        edge: "return",
        count: 1,
        awaits: [callerAwait],
        root: remoteCall,
        path: [callerDeclaration, boundaryDeclaration],
        steps: [{
          from: callerDeclaration,
          to: boundaryDeclaration,
          edge: "return",
          occurrence: boundaryCall,
        }],
      },
    ],
    outsideExamples: [],
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
