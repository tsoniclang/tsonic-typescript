import assert from "node:assert/strict";
import { test } from "node:test";

import type { PointerFlowRepresentation } from "../flow-representation.js";
import { pointerKeyMapStorageKind } from "./storage-kind.js";

const representations: readonly PointerFlowRepresentation[] = [
  "location",
  "direct-snapshot",
  "mutable-cell",
  "direct-object",
];

test("admits only equal identity-preserving pointer-key representations", () => {
  for (const left of representations) {
    for (const right of representations) {
      const expected = left === right &&
          (left === "location" || left === "direct-object")
        ? left
        : undefined;
      assert.equal(pointerKeyMapStorageKind(left, right), expected);
    }
  }
});
