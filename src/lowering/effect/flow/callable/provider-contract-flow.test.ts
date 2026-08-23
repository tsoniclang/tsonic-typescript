import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("retains a provider call whose contract is not project-rewritable", () => {
  const fixture = checkedEffectFixture(`
async function invoke(): Promise<number> {
  return await Promise.resolve(42);
}
export const result = await invoke();
`);
  const originalAsync = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const originalAwaits = countNodes(
    fixture.source,
    fixture.sourceFile,
    fixture.source.ast.is.IsAwaitExpression,
  );

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsync,
  );
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      fixture.source.ast.is.IsAwaitExpression,
    ),
    originalAwaits,
  );
});
