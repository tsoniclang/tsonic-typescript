import assert from "node:assert/strict";
import { test } from "node:test";

import { createTypeScriptOptimizationEvidence } from "../evidence.js";
import { createTypeScriptOptimizationProfile } from "../profile.js";
import { createTargetProgramIndex } from "../program-index.js";
import { createScalarRepresentationPlan } from "./plan.js";
import { createRepresentationProjectionPlan } from "../representation/plan.js";
import {
  checkedScalarFixture,
  fixtureSourceIdentityFor,
} from "./scalar.test-support.js";

test("reports exact scalar retention evidence without machine paths", () => {
  const sourceText = `class Scalar {
  constructor(readonly value: { amount: number }) {}
}
export const result = new Scalar({ amount: 1 }).value;
`;
  const fixture = checkedScalarFixture(sourceText);
  const profile = createTypeScriptOptimizationProfile({
    pointerFlows: "location",
    scalarProjections: "closed-direct",
    representationProjections: "preserve",
  });
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
  });
  const plan = createScalarRepresentationPlan(
    fixture.source,
    program,
    profile.scalarProjections,
    fixtureSourceIdentityFor(fixture.source),
  );
  const representationPlan = createRepresentationProjectionPlan(
    fixture.source,
    program,
    profile.representationProjections,
    fixtureSourceIdentityFor(fixture.source),
  );
  const evidence = createTypeScriptOptimizationEvidence(
    "unrestricted",
    profile,
    ["index.ts"],
    program.operations,
    undefined,
    plan,
    representationPlan,
  );

  const retained = evidence.scalar.fallbackReasons.find((entry) =>
    entry.reason === "non-scalar-value"
  );
  assert.equal(retained?.count, 1);
  assert.ok(retained?.examples.some((example) =>
    example.kind === "authored" &&
    example.documentIdentity === "index.ts" &&
    example.start === sourceText.indexOf("new Scalar") &&
    example.syntaxKind === "KindPropertyAccessExpression"
  ));
  assert.doesNotMatch(JSON.stringify(evidence), /\/src|\.temp/u);
});
