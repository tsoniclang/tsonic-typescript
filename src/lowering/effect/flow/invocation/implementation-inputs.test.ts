import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../../program-index.js";
import { checkedEffectFixture } from "../../test-support/fixture.test-support.js";
import { extendExactInvocationInputIndex } from "./implementation-inputs.js";
import {
  createExactInvocationInputIndex,
  sameExactInvocationInputIndexes,
  type ExactInvocationInputIndex,
} from "./inputs.js";

test("extended invocation inputs sever their predecessor index", () => {
  const fixture = checkedEffectFixture(`
function sum(first: number, ...rest: number[]): number {
  return first + rest.length;
}
export const result = sum(1, 2, 3);
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
  });
  const direct = createExactInvocationInputIndex(fixture.source, program);
  let predecessorIsLive = true;
  const predecessor: ExactInvocationInputIndex = Object.freeze({
    parameters() {
      assert.equal(predecessorIsLive, true);
      return direct.parameters();
    },
    inputsFor(parameter: Node) {
      assert.equal(predecessorIsLive, true);
      return direct.inputsFor(parameter);
    },
    inputGroupsFor(parameter: Node) {
      assert.equal(predecessorIsLive, true);
      return direct.inputGroupsFor(parameter);
    },
    restElementInputsFor(parameter: Node, index: number) {
      assert.equal(predecessorIsLive, true);
      return direct.restElementInputsFor(parameter, index);
    },
    parametersFor(input: Node) {
      assert.equal(predecessorIsLive, true);
      return direct.parametersFor(input);
    },
    isInvalid(parameter: Node) {
      assert.equal(predecessorIsLive, true);
      return direct.isInvalid(parameter);
    },
    isClosed(parameter: Node) {
      assert.equal(predecessorIsLive, true);
      return direct.isClosed(parameter);
    },
  });

  const extended = extendExactInvocationInputIndex(
    fixture.source,
    predecessor,
    [],
  );
  predecessorIsLive = false;

  assert.equal(sameExactInvocationInputIndexes(direct, extended), true);
  for (const parameter of direct.parameters()) {
    assert.deepEqual(
      extended.restElementInputsFor(parameter, 0),
      direct.restElementInputsFor(parameter, 0),
    );
    for (const input of direct.inputsFor(parameter) ?? []) {
      assert.deepEqual(
        extended.parametersFor(input),
        direct.parametersFor(input),
      );
    }
  }
});
