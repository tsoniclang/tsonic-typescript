import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "./effect.test-support.js";

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
        directExamples: [authored("escaped")],
      },
      {
        reason: "promise-producing-return",
        directCallableCount: 1,
        retainedCallableCount: 1,
        directExamples: [authored("promiseValue")],
      },
      {
        reason: "unresolved-call",
        directCallableCount: 1,
        retainedCallableCount: 2,
        directExamples: [authored("boundary")],
      },
    ],
    propagation: {
      vertices: 5,
      edges: 1,
      work: 7,
    },
  });

  function authored(name: string) {
    const declaration = [...fixture.source.navigation.sourceFiles]
      .flatMap((sourceFile) => fixture.source.ast.children(sourceFile))
      .find((node) => fixture.source.ast.text(fixture.source.ast.name(node)) === name);
    assert.ok(declaration !== undefined);
    const occurrence = fixture.source.documents.occurrenceFor(declaration);
    assert.equal(occurrence.kind, "authored");
    if (occurrence.kind !== "authored") {
      assert.fail("effect fixture declaration must be authored");
    }
    return {
      kind: "authored" as const,
      documentIdentity: occurrence.document.identity,
      start: occurrence.start,
      end: occurrence.end,
      syntaxKind: occurrence.syntaxKind,
    };
  }
});
