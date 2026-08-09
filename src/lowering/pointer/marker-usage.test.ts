import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedPointerFixture,
  moduleSpecifiers,
  sourceFileNamed,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("lowers exact pointer markers through a named re-export closure", () => {
  const fixture = checkedPointerFixture(`import type { Ptr } from "./barrel.js";
import { address, load } from "./barrel.js";

let value = 1;
const pointer: Ptr<number> = address(value);
export const result = load(pointer);
`, {
    "/src/barrel.ts": `export type { Pointer as Ptr } from "./markers.js";
export { addressOf as address, loadPointer as load } from "./markers.js";
`,
  });

  const index = lowerPointers(fixture.source, fixture.sourceFile);
  const barrel = lowerPointers(
    fixture.source,
    sourceFileNamed(fixture.source, "/src/barrel.ts"),
  );

  assert.equal(index.operationCount, 2);
  assert.equal(index.pointerTypeCount, 1);
  assert.deepEqual(moduleSpecifiers(fixture.source, index.sourceFile), [
    "@tsonic/typescript-runtime",
  ]);
  assert.deepEqual(moduleSpecifiers(fixture.source, barrel.sourceFile), []);
});

test("rejects first-class pointer marker values without an exact operation", () => {
  const fixtures = [
    checkedPointerFixture(`import { loadPointer } from "./markers.js";
export const marker = loadPointer;
`),
    checkedPointerFixture(`import * as markers from "./markers.js";
export const marker = markers.loadPointer;
`),
  ];

  for (const fixture of fixtures) {
    assert.throws(
      () => lowerPointers(fixture.source, fixture.sourceFile),
      /pointer marker .* is used as a runtime value without an exact lowering operation/u,
    );
  }
});
