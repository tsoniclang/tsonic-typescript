import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../program-index.js";
import { lowerCooperativeEffects } from "../rewrite/transform.js";
import { checkedEffectFixture } from "../test-support/fixture.test-support.js";
import { createClosedCooperativeEffectPlan } from "./plan.js";

test("consumes one canonical source-reference census", () => {
  const unrelated = Array.from(
    { length: 256 },
    (_, index) => `const unrelated${index} = ${index};`,
  ).join("\n");
  const fixture = checkedEffectFixture(`
${unrelated}
async function value(): Promise<number> { return 1; }
export const result = await value();
`);
  let queries = 0;
  const source = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      sourceReferenceFor(node: Node | undefined) {
        queries += 1;
        return fixture.source.navigation.sourceReferenceFor(node);
      },
    }),
  });

  const program = createTargetProgramIndex(source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
  assert.equal(
    queries,
    program.operations.referenceCandidates,
    "the canonical reference census must query each candidate exactly once",
  );
  queries = 0;
  const plan = createClosedCooperativeEffectPlan(
    source,
    program,
    (sourceFile) => source.documents.forFile(sourceFile).identity,
  );
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(
    queries,
    0,
    "effect planning must consume the canonical reference index",
  );
});
