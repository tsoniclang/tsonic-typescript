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

test("settles through function-object observations preserved by rewriting", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number> { return 42; }
void leaf;
typeof leaf;
if (leaf) { leaf === leaf; }
leaf != null;
const selected = leaf || leaf;
export const result = await selected();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("retains a function whose runtime properties are observed", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number> { return 42; }
export const constructor = leaf.constructor;
export const result = await leaf();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});
