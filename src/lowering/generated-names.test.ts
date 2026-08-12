import assert from "node:assert/strict";
import { test } from "node:test";

import { checkedEffectFixture } from "./effect/effect.test-support.js";
import {
  createProgramGeneratedNames,
  type GeneratedBindingName,
} from "./generated-names.js";
import { createTargetProgramIndex } from "./program-index.js";

const rawStringIsNotGenerated:
  string extends GeneratedBindingName ? false : true = true;

test("reserves authored and sequential generated bindings deterministically", () => {
  assert.equal(rawStringIsNotGenerated, true);
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

  assert.equal(names.reserve("$pointer").text, "$pointer2");
  assert.equal(names.reserve("synthetic").text, "synthetic");
  assert.equal(names.reserve("synthetic").text, "synthetic2");
  assert.equal(names.reserve("synthetic").text, "synthetic3");
});

test("reserves imported parameter and nested authored bindings", () => {
  const fixture = checkedEffectFixture(`
import { source as imported } from "./provider.js";
export function run(parameter: number): number {
  {
    const nested = parameter;
    return imported + nested;
  }
}
`, {
    "/src/provider.ts": "export const source = 1;\n",
  });
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
  });
  const names = createProgramGeneratedNames(fixture.source, program)
    .forFile(fixture.sourceFile);

  assert.equal(names.reserve("imported").text, "imported2");
  assert.equal(names.reserve("parameter").text, "parameter2");
  assert.equal(names.reserve("nested").text, "nested2");
});
