import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IsCatchClause,
  IsTryStatement,
} from "@tsonic/tsts/target-ast";

import {
  countAsyncCallables,
  countNodes,
  checkedEffectFixture,
  createFixtureEffectPlan,
  visit,
} from "../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

test("keeps a callable producer used by a discarded indirect call", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => void | Promise<void>) | undefined) {}
}
const callback = new Callback(async (): Promise<void> => { throw new Error("boom"); });
export function discard(): void { callback.value!(); }
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("keeps a direct producer used by a discarded call", () => {
  const fixture = checkedEffectFixture(`
async function fail(): Promise<void> { throw new Error("boom"); }
export function discard(): void { fail(); }
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a discarded call Promise boundary under closed program", () => {
  const fixture = checkedEffectFixture(`
async function fail(): Promise<void> { throw new Error("boom"); }
export function discard(): void { fail(); }
`);

  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  const propertyNames: string[] = [];
  visit(fixture.source, result.sourceFile, (node) => {
    if (fixture.source.ast.is.IsPropertyAccessExpression(node)) {
      propertyNames.push(fixture.source.ast.text(fixture.source.ast.name(node)));
    }
  });

  assert.equal(result.callableCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsTryStatement), 1);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsCatchClause), 1);
  assert.deepEqual(propertyNames, ["resolve", "Promise", "reject", "Promise"]);
});

test("retains a Promise-observed producer when globalThis is shadowed", () => {
  const fixture = checkedEffectFixture(`
const globalThis = { marker: true };
async function fail(): Promise<void> { throw new Error("boom"); }
export function discard(): void { fail(); void globalThis.marker; }
`);

  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsTryStatement), 0);
});
