import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, createSourceSemanticsExtension } from "@tsonic/tsts";
import { createTsonicCoreSourceExtension, tsonicCoreSourceSemanticsModules } from "@tsonic/source-core";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { compileTypeScriptTarget } from "./typescript-backend.js";
import { compileInput, compiledArtifacts } from "./typescript-backend.test-support.js";
import { prepareTypeScriptLowering } from "../lowering/transform.js";
import { canonicalTypeScriptOptimizationProfile } from "../lowering/profile.js";
import { typeScriptLoweringSourceFiles } from "../lowering/source-membership.js";
import { typeScriptRuntimeReference } from "../runtime/package-contract.js";

function fixture() {
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: {
      "/project/index.ts": 'import { get } from "./provider.js"; import { ordinary } from "./ordinary.js"; export const result = [get(), ordinary()];',
      "/project/provider.d.ts": 'import type { RawPointer } from "@tsonic/core/types.js"; export declare function get(): RawPointer | undefined;',
      "/project/ordinary.d.ts": 'interface RawPointer { readonly value: number } export declare function ordinary(): RawPointer;',
    },
    rootFiles: ["/project/index.ts"],
    compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler" },
    extensionHostOptions: { extensions: [
      createSourceSemanticsExtension({ modules: tsonicCoreSourceSemanticsModules() }),
      createTsonicCoreSourceExtension(),
    ] },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  return createTargetSourceProgram(checked);
}

test("checked marker-bearing dependency declarations use the one lowering transaction", () => {
  const source = fixture();
  const files = typeScriptLoweringSourceFiles(source);
  assert.deepEqual(files.map(file => source.ast.getFileName(file)), ["/project/index.ts", "/project/provider.d.ts"]);
  let printedFiles = 0;
  const result = compileTypeScriptTarget(compileInput(source, [typeScriptRuntimeReference()]), {
    print(batch) {
      printedFiles += batch.encodedSourceFiles.length;
      return batch.encodedSourceFiles.map(() => "printed");
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedFiles, 2);
  const artifacts = compiledArtifacts(result);
  assert.deepEqual(artifacts.filter(artifact => artifact.kind === "source").map(artifact => artifact.path), ["index.ts", "provider.d.ts"]);
  const evidence = artifacts.find(artifact => artifact.path === "tsonic-typescript-optimization.json");
  assert.ok(evidence);
  assert.deepEqual(JSON.parse(evidence.text).sourceMembership, ["index.ts", "provider.d.ts"]);
});

test("omitting a selected provider declaration is a membership failure", () => {
  const source = fixture();
  assert.throws(() => prepareTypeScriptLowering(
    source,
    source.navigation.sourceFiles,
    canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity,
  ), /selected declaration once/u);
});
