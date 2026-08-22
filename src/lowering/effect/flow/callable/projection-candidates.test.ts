import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../../program-index.js";
import { checkedEffectFixture } from "../../test-support/fixture.test-support.js";
import { collectCallableProjectionCandidates } from "./projection-candidates.js";

const callableSource = `
type Awaitable<T> = T | PromiseLike<T>;
declare const opaque: any;
function direct(): number { return 1; }
class Worker {
  run(): number { return 2; }
}
const worker = new Worker();
const directMethodResult = worker.run();
const methodValue = worker.run;
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
    paddedCandidates.some((node) =>
      identifierText(padded.source, node) === "opaque"
    ),
    "an invoked open target must remain in the exact candidate domain",
  );
  assert.equal(
    paddedCandidates.some((node) =>
      identifierText(padded.source, node) === "direct"
    ),
    false,
    "a direct checked invocation must not enter callable projection flow",
  );
  assert.equal(
    paddedCandidates.filter((node) => isWorkerRun(padded.source, node)).length,
    1,
    "a direct checked method target must be excluded while its method-value sibling remains",
  );
  assert.ok(
    paddedCandidates.some((node) =>
      identifierText(padded.source, node) === "selected"
    ),
    "a narrowed callable union must remain in the exact candidate domain",
  );
  assert.equal(
    paddedCandidates.some((node) =>
      identifierText(padded.source, node)?.startsWith("scalar") === true
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

function identifierText(
  source: ReturnType<typeof checkedEffectFixture>["source"],
  node: Node | undefined,
): string | undefined {
  return node !== undefined && source.ast.is.IsIdentifier(node)
    ? source.ast.text(node)
    : undefined;
}

function isWorkerRun(
  source: ReturnType<typeof checkedEffectFixture>["source"],
  node: Node,
): boolean {
  const access = source.ast.as.AsPropertyAccessExpression(node);
  return access !== undefined &&
    identifierText(source, access.Expression) === "worker" &&
    identifierText(source, access.name) === "run";
}
