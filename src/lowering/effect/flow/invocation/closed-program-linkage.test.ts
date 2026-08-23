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

test("settles an exported callback through exact import and re-export linkage", () => {
  const fixture = linkedCallbackFixture();
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  let asyncCallables = 0;
  let awaits = 0;

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const lowered = lowerCooperativeEffects(sourceFile, plan).sourceFile;
    asyncCallables += countAsyncCallables(fixture.source, lowered);
    awaits += countNodes(fixture.source, lowered, IsAwaitExpression);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(plan.summary.retainedCallableCount, 0);
  assert.equal(asyncCallables, 0);
  assert.equal(awaits, 0);
});

test("retains exported callback linkage under library-safe closure", () => {
  const fixture = linkedCallbackFixture();
  const plan = createFixtureEffectPlan(fixture.source);

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 2);
});

test("retains the same callback when an ambient consumer can invoke it", () => {
  const fixture = checkedEffectFixture(`
import { getText } from "./bridge.js";
declare function install(callback: () => string | PromiseLike<string>): void;
install(getText);
export const result = await getText();
`, callbackFiles);
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.ok(plan.summary.fallbackReasons.some((entry) =>
    entry.reason === "escaping-callable" && entry.retainedCallableCount === 1
  ));
});

const callbackFiles = Object.freeze({
  "/src/bridge.ts": `export { getText } from "./utilities.js";`,
  "/src/utilities.ts": `
export async function getText(): Promise<string> {
  return "value";
}
`,
});

function linkedCallbackFixture() {
  return checkedEffectFixture(`
import { format } from "./format.js";
import { getText } from "./bridge.js";
export const result = await format(getText);
`, {
    ...callbackFiles,
    "/src/format.ts": `
export async function format(
  getText: () => string | PromiseLike<string>,
): Promise<string> {
  return "<" + await getText() + ">";
}
`,
  });
}
