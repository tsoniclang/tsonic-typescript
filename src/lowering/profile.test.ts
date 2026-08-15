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
      "typescript-optimization-v2/pointer=location/scalar=preserve/effects=preserve/interfaces=open-structural",
    pointerFlows: "location",
    scalarProjections: "preserve",
    cooperativeEffects: "preserve",
    interfaceDispatch: "open-structural",
  });
  assert.ok(Object.isFrozen(canonical));

  const optimized = createTypeScriptOptimizationProfile({
    pointerFlows: "closed-direct",
    scalarProjections: "closed-direct",
    cooperativeEffects: "closed-direct",
    interfaceDispatch: "declared-closed",
  });
  assert.equal(
    optimized.identity,
    "typescript-optimization-v2/pointer=closed-direct/scalar=closed-direct/effects=closed-direct/interfaces=declared-closed",
  );
  assert.equal(
    createTypeScriptOptimizationProfile({
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
      interfaceDispatch: "declared-closed",
    }),
    optimized,
  );
  assert.ok(Object.isFrozen(optimized));
});

test("does not infer a closed interface world from effect selection", () => {
  const profile = createTypeScriptOptimizationProfile({
    pointerFlows: "location",
    scalarProjections: "preserve",
    cooperativeEffects: "closed-direct",
  });

  assert.equal(profile.interfaceDispatch, "open-structural");
  assert.match(profile.identity, /interfaces=open-structural/u);
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

  const fabricatedInterface = {
    pointerFlows: "location",
    scalarProjections: "preserve",
    cooperativeEffects: "preserve",
    interfaceDispatch: "structural-inferred",
  } as unknown as TypeScriptOptimizationProfileInput;
  assert.throws(
    () => createTypeScriptOptimizationProfile(fabricatedInterface),
    /'interfaceDispatch' must be 'open-structural' or 'declared-closed'/,
  );
});
