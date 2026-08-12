import assert from "node:assert/strict";
import { test } from "node:test";

import { checkedEffectFixture } from "./effect/effect.test-support.js";
import { createProgramGeneratedNames } from "./generated-names.js";
import { createTargetProgramIndex } from "./program-index.js";

test("reserves authored and sequential generated bindings deterministically", () => {
  const fixture = checkedEffectFixture(`
const $pointer = 1;
export const result = $pointer;
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
  });
  const names = createProgramGeneratedNames(fixture.source, program)
    .forFile(fixture.sourceFile);

  assert.equal(names.reserve("$pointer"), "$pointer2");
  assert.equal(names.reserve("synthetic"), "synthetic");
  assert.equal(names.reserve("synthetic"), "synthetic2");
  assert.equal(names.reserve("synthetic"), "synthetic3");
});
