import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../program-index.js";
import { callableReturnRewrite } from "./callable-contract.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
  visit,
} from "../test-support/fixture.test-support.js";
import { collectCallableStorageInputs } from "../flow/storage/inputs.js";
import { lowerCooperativeEffects } from "../rewrite/transform.js";

test("rejects an inexact awaitable union at the contract owner", () => {
  const fixture = inexactAwaitableFixture();
  let inexactContract: Node | undefined;
  visit(fixture.source, fixture.sourceFile, (node) => {
    const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
    if (
      reference !== undefined &&
      fixture.source.ast.text(reference.TypeName) === "Inexact"
    ) {
      inexactContract = node;
    }
  });
  assert.ok(inexactContract !== undefined);
  assert.ok(
    callableReturnRewrite(fixture.source, inexactContract) === undefined,
  );
});

test("retains a flow whose awaitable wrapper changes a direct member", () => {
  const fixture = inexactAwaitableFixture();
  const storage = collectCallableStorageInputs(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
      declarationReferences: true,
    }),
    new Set(),
  );
  const closedNames = [...storage.closed].map((node) => fixture.source.ast.text(
    fixture.source.ast.name(node),
  ));
  assert.ok(!closedNames.includes("callback"));

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

function inexactAwaitableFixture() {
  return checkedEffectFixture(`
type Inexact<T> = T | Promise<number | undefined>;
class State {
  declare callback: (() => Inexact<string | undefined>) | undefined;
}
const state = new State();
const callee = state.callback;
export async function invoke(): Promise<string | number | undefined> {
  return await callee!();
}
export const result = await invoke();
`);
}
