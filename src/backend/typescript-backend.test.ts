import assert from "node:assert/strict";
import { test } from "node:test";

import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import {
  createTargetSourceProgram,
  type TargetCompileInput,
} from "@tsonic/target-api";

import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { createTypeScriptBackend } from "./typescript-backend.js";

test("lowers and prints every checked source file in one batch", () => {
  const source = checkedSource({
    "/project/a.ts": "export const a = 1;\n",
    "/project/sub/b.ts": "export const b = 2;\n",
  });
  const batches: Uint8Array[][] = [];
  const printer: TypeScriptAstPrinter = {
    print(files) {
      batches.push([...files]);
      return files.map((_, index) => `// printed ${index}\n`);
    },
  };

  const result = createTypeScriptBackend(printer).compile(
    compileInput(source),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.length, 2);
  assert.ok(batches[0]?.every((encoded) => encoded.byteLength > 0));
  assert.deepEqual(
    result.artifacts.map((artifact) => [artifact.kind, artifact.path]),
    [
      ["source", "a.ts"],
      ["source", "sub/b.ts"],
    ],
  );
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.text),
    ["// printed 0\n", "// printed 1\n"],
  );
});

test("fails the compilation when the printer omits a source file", () => {
  const source = checkedSource({
    "/project/index.ts": "export const value = 1;\n",
  });
  const printer: TypeScriptAstPrinter = {
    print() {
      return [];
    },
  };

  const result = createTypeScriptBackend(printer).compile(
    compileInput(source),
  );

  assert.deepEqual(result.artifacts, []);
  assert.equal(result.diagnostics.length, 1);
  assert.match(
    result.diagnostics[0]?.message ?? "",
    /returned 0 files, expected 1/,
  );
});

function checkedSource(files: Readonly<Record<string, string>>) {
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

function compileInput(
  source: ReturnType<typeof checkedSource>,
): TargetCompileInput {
  return {
    source,
    project: {
      entryPoint: "/project/a.ts",
      targets: [{ id: "typescript" }],
    },
    target: { id: "typescript" },
    runtimeReferences: [],
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/typescript",
    },
  };
}
