import assert from "node:assert/strict";

import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import {
  createTargetSourceProgram,
  type TargetCompileInput,
  type TargetRuntimeReference,
} from "@tsonic/target-api";

export function checkedSource(files: Readonly<Record<string, string>>) {
  const rootFiles = Object.keys(files).sort();
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files,
    rootFiles,
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  return createTargetSourceProgram(checked);
}

export function compileInput(
  source: ReturnType<typeof checkedSource>,
  runtimeReferences: readonly TargetRuntimeReference[] = [],
): TargetCompileInput {
  return {
    source,
    project: {
      entryPoint: "/project/a.ts",
      targets: [{ id: "typescript" }],
    },
    target: { id: "typescript" },
    runtimeReferences,
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/typescript",
    },
  };
}
