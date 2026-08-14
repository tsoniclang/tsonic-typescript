import assert from "node:assert/strict";
import { test } from "node:test";

import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
} from "../pointer/pointer.test-support.js";
import { createPointerResultContract } from "../pointer/result-contract.js";
import {
  countAsyncCallables,
} from "./effect.test-support.js";
import { createClosedCooperativeEffectPlan } from "./plan.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles a returned exact pointer after a synchronous project use", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
async function increment(pointer: Pointer<number>): Promise<void> {
  storePointer(pointer, loadPointer(pointer) + 1);
}
export async function create(): Promise<Pointer<number>> {
  const pointer = allocatePointer(40);
  await increment(pointer);
  return pointer;
}
export const result = loadPointer(await create());
`);
  const pointerPlan = createFixturePointerFlowPlan(fixture.source);
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    createPointerResultContract(fixture.source, pointerPlan),
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    2,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    2,
  );
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});
