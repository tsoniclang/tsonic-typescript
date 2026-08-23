import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countNodes,
} from "../../test-support/fixture.test-support.js";
import { collectCallableStorageInputs } from "./inputs.js";

test("indexes callable parameter uses with bounded whole-program traversals", () => {
  const families = Array.from({ length: 32 }, (_, index) => `
class Slot${index} {
  private constructor(public value: (() => number | PromiseLike<number>) | undefined) {}
  static make(value: (() => number | PromiseLike<number>) | undefined): Slot${index} {
    return new Slot${index}(value);
  }
}
const slot${index} = Slot${index}.make(() => ${index});
const result${index} = slot${index}.value!();
`).join("\n");
  const fixture = checkedEffectFixture(families);
  const nodeCount = countNodes(
    fixture.source,
    fixture.sourceFile,
    () => true,
  );
  let childQueries = 0;
  const source = Object.freeze({
    ...fixture.source,
    ast: Object.freeze({
      ...fixture.source.ast,
      children(node: Node | undefined) {
        childQueries += 1;
        return fixture.source.ast.children(node);
      },
    }),
  });

  collectCallableStorageInputs(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    new Set(),
  );

  assert.ok(
    childQueries < nodeCount * 8,
    `expected bounded traversals, got ${childQueries} child queries for ${nodeCount} nodes`,
  );
});
