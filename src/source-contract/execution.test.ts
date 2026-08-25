import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedPointerFixture,
} from "../lowering/pointer/pointer.test-support.js";
import { createTargetProgramIndex } from "../lowering/program-index.js";
import { sourceExecutionViolations } from "./execution.js";

test("rejects every authored suspension form under the synchronous contract", () => {
  const fixture = checkedPointerFixture(`
export async function value(): Promise<number> {
  return await Promise.resolve(1);
}
export async function consume(values: AsyncIterable<number>): Promise<void> {
  for await (const value of values) {
    void value;
  }
}
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
  });
  const violations = sourceExecutionViolations(
    fixture.source,
    program,
    "synchronous",
  );

  assert.ok(violations.some((violation) =>
    violation.message.includes("KindFunctionDeclaration")
  ));
  assert.ok(violations.some((violation) =>
    violation.message.includes("KindAwaitExpression")
  ));
  assert.ok(violations.some((violation) =>
    violation.message.includes("KindForOfStatement")
  ));
  assert.ok(violations.every((violation) =>
    violation.sourceFile === fixture.sourceFile
  ));
});

test("unrestricted execution performs no suspension analysis", () => {
  const fixture = checkedPointerFixture(`
export async function value(): Promise<number> {
  return await Promise.resolve(1);
}
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
  });

  assert.deepEqual(
    sourceExecutionViolations(fixture.source, program, "unrestricted"),
    [],
  );
});
