import assert from "node:assert/strict";
import { test } from "node:test";

import { createTargetProgramIndex } from "../../../program-index.js";
import { checkedEffectFixture } from "../../test-support/fixture.test-support.js";
import { collectCallableProjectionCandidates } from "./projection-candidates.js";

const callableSource = `
type Awaitable<T> = T | PromiseLike<T>;
declare const opaque: any;
function direct(): number { return 1; }
const selected: (() => Awaitable<number>) | undefined =
  async (): Promise<number> => 42;
export const result = direct() +
  (selected === undefined ? opaque() : await selected());
`;

test("indexes only callable projection candidates", () => {
  const baseline = checkedEffectFixture(callableSource);
  const padded = checkedEffectFixture(`
${Array.from({ length: 512 }, (_, index) =>
    `const scalar${index}: number = ${index};`).join("\n")}
${callableSource}
`);

  const baselineCandidates = candidatesFor(baseline.source);
  const paddedCandidates = candidatesFor(padded.source);

  assert.equal(paddedCandidates.length, baselineCandidates.length);
  assert.ok(
    paddedCandidates.some((node) => padded.source.ast.text(node) === "opaque"),
    "an invoked open target must remain in the exact candidate domain",
  );
  assert.equal(
    paddedCandidates.some((node) => padded.source.ast.text(node) === "direct"),
    false,
    "a direct checked invocation must not enter callable projection flow",
  );
  assert.ok(
    paddedCandidates.some((node) => padded.source.ast.text(node) === "selected"),
    "a narrowed callable union must remain in the exact candidate domain",
  );
  assert.equal(
    paddedCandidates.some((node) =>
      padded.source.ast.text(node).startsWith("scalar")
    ),
    false,
  );
});

function candidatesFor(
  source: ReturnType<typeof checkedEffectFixture>["source"],
) {
  return collectCallableProjectionCandidates(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: true,
      memberDispatch: true,
    }),
  );
}
