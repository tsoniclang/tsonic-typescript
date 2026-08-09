import assert from "node:assert/strict";
import test from "node:test";

import { createTypeScriptTargetPack } from "./typescript-target-pack.js";

test("selects the exact TypeScript source declaration profile", () => {
  const targetPack = createTypeScriptTargetPack();
  const target = { id: "typescript" };
  const contribution = targetPack.provider?.sourceProfileContributions?.({
    project: {
      entryPoint: "program.ts",
      targets: [target],
    },
    target,
    targetPack,
    selectedCapabilities: [],
    selectedSurfaces: [],
  });

  assert.deepEqual(contribution, {
    declarationPolicy: {
      bundledLibraries: ["lib.es2024.d.ts"],
      installedDeclarations: "package-contract",
    },
  });
});
