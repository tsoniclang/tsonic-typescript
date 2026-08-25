import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalTypeScriptOptimizationProfile,
  createTypeScriptOptimizationProfile,
} from "./profile.js";

test("interns one immutable identity for each exact profile", () => {
  const canonical = canonicalTypeScriptOptimizationProfile();
  assert.equal(
    canonical,
    createTypeScriptOptimizationProfile({
      pointerFlows: "location",
      scalarProjections: "preserve",
      representationProjections: "preserve",
    }),
  );
  assert.ok(Object.isFrozen(canonical));
  assert.equal(
    canonical.identity,
    "typescript-optimization-v4/pointer=location/scalar=preserve/representations=preserve",
  );
});

test("rejects values outside each closed profile domain", () => {
  for (const input of [
    {
      pointerFlows: "automatic",
      scalarProjections: "preserve",
      representationProjections: "preserve",
    },
    {
      pointerFlows: "location",
      scalarProjections: "automatic",
      representationProjections: "preserve",
    },
    {
      pointerFlows: "location",
      scalarProjections: "preserve",
      representationProjections: "automatic",
    },
  ]) {
    assert.throws(
      () => createTypeScriptOptimizationProfile(
        input as Parameters<typeof createTypeScriptOptimizationProfile>[0],
      ),
      /must be/u,
    );
  }
});
