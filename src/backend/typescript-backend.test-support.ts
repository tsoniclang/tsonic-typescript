import assert from "node:assert/strict";

import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import type {
  TargetCompileInput,
  TargetSourcePackageGraph,
} from "@tsonic/target-api";
import {
  createTargetSourceProgram,
} from "@tsonic/target-api/source";
import type {
  TargetArtifact,
  TargetCompileResult,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";

import type { TypeScriptOptimizationProfileInput } from "../lowering/profile.js";
import type {
  TypeScriptSourceExecutionProfile,
} from "../source-contract/execution.js";
import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { compileTypeScriptTarget } from "./typescript-backend.js";

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
    sourcePackages: testSourcePackages(source),
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

export function createTestTypeScriptCompiler(
  printer: TypeScriptAstPrinter,
  profile?: TypeScriptOptimizationProfileInput,
  execution: TypeScriptSourceExecutionProfile = "unrestricted",
): { compile(input: TargetCompileInput): TargetCompileResult } {
  return Object.freeze({
    compile(input: TargetCompileInput): TargetCompileResult {
      return compileTypeScriptTarget(input, printer, profile, execution);
    },
  });
}

export function compiledArtifacts(
  result: TargetCompileResult,
): readonly TargetArtifact[] {
  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") {
    throw new Error("TypeScript test compilation was rejected");
  }
  return result.value.artifacts;
}

function testSourcePackages(
  source: ReturnType<typeof checkedSource>,
): TargetSourcePackageGraph {
  const packageId = "test-project";
  const componentId = "test-component";
  const sourceFiles = Object.freeze(source.navigation.sourceFiles.map(
    (sourceFile) => source.documents.forFile(sourceFile).fileName,
  ).sort());
  return Object.freeze({
    fingerprint: "test-source-package-graph-v1",
    rootPackageId: packageId,
    packages: Object.freeze([Object.freeze({
      id: packageId,
      name: "test-project",
      packageRoot: "/project",
      sourceRoot: "/project",
      sourceFiles,
      dependencies: Object.freeze([]),
      exports: Object.freeze([]),
      componentId,
    })]),
    components: Object.freeze([Object.freeze({
      id: componentId,
      packages: Object.freeze([packageId]),
      dependencies: Object.freeze([]),
    })]),
  });
}
