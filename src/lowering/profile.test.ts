import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalTypeScriptOptimizationProfile,
  createTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfileInput,
} from "./profile.js";

test("normalizes every optimization selection to one immutable identity", () => {
  const canonical = canonicalTypeScriptOptimizationProfile();
  assert.equal(canonical, canonicalTypeScriptOptimizationProfile());
  assert.equal(createTypeScriptOptimizationProfile(canonical), canonical);
  assert.deepEqual(canonical, {
    identity:
      "typescript-optimization-v1/pointer=location/scalar=preserve/effects=preserve",
    pointerFlows: "location",
    scalarProjections: "preserve",
    cooperativeEffects: "preserve",
  });
  assert.ok(Object.isFrozen(canonical));

  const optimized = createTypeScriptOptimizationProfile({
    pointerFlows: "closed-direct",
    scalarProjections: "closed-direct",
    cooperativeEffects: "closed-direct",
  });
  assert.equal(
    optimized.identity,
    "typescript-optimization-v1/pointer=closed-direct/scalar=closed-direct/effects=closed-direct",
  );
  assert.equal(
    createTypeScriptOptimizationProfile({
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    }),
    optimized,
  );
  assert.ok(Object.isFrozen(optimized));
});

test("rejects a fabricated optimization selection", () => {
  const fabricated = {
    pointerFlows: "automatic",
    scalarProjections: "preserve",
    cooperativeEffects: "preserve",
  } as unknown as TypeScriptOptimizationProfileInput;
  assert.throws(
    () => createTypeScriptOptimizationProfile(fabricated),
    /'pointerFlows' must be 'location' or 'closed-direct'/,
  );
});
