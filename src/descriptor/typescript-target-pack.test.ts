import assert from "node:assert/strict";
import test from "node:test";

import { createTypeScriptTargetPack } from "./typescript-target-pack.js";
import {
  typeScriptRuntimeReturnExtensionId,
  typeScriptRuntimeReturnExtensionVersion,
} from "../runtime/return-fact.js";

test("owns one exact TypeScript compilation session", () => {
  const targetPack = createTypeScriptTargetPack();
  const target = {
    id: "typescript",
    options: {
      printer: {
        executable: process.execPath,
        arguments: [],
      },
    },
  };
  const session = targetPack.createCompilationSession({
    project: {
      entryPoint: "program.ts",
      targets: [target],
    },
    projectDirectory: "/project",
    target,
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/typescript",
    },
    selectedSurfaceIds: [],
    capabilities: [],
  });

  assert.deepEqual(targetPack.provider, {
    id: "typescript-provider",
    displayName: "TypeScript target provider",
    moduleOwnership: [{ specifierPrefix: "@tsonic/typescript-runtime" }],
  });
  assert.deepEqual(targetPack.surfaces, []);
  assert.deepEqual(session.sourceProfileContributions(), {
    declarationPolicy: {
      bundledLibraries: ["lib.es2024.d.ts"],
      installedDeclarations: "package-contract",
    },
  });
  const compiler = session.sourceCompilerContributions();
  assert.deepEqual(compiler.extensions?.map((extension) => extension.identity), [{
    id: typeScriptRuntimeReturnExtensionId,
    version: typeScriptRuntimeReturnExtensionVersion,
  }]);
  assert.equal(typeof compiler.extensions?.[0]?.analyzeSource, "function");
  assert.deepEqual(session.runtimeContributions(), {
    references: [{
      kind: "npm-package",
      include: "@tsonic/typescript-runtime",
      version: "0.0.1",
    }],
  });
  assert.throws(
    () => session.sourceProfileContributions(),
    /while in 'runtime-contributed' state; expected 'created'/u,
  );
  session.close();
});
