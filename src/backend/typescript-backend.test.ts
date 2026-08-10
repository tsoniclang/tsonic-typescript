import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCompilerSessionFromFiles,
  createSourceSemanticsExtension,
} from "@tsonic/tsts";
import type { SourceSemanticsModule } from "@tsonic/tsts";
import {
  createTargetSourceProgram,
  type TargetArtifact,
  type TargetCompileInput,
  type TargetRuntimeReference,
} from "@tsonic/target-api";

import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { typeScriptRuntimeReference } from "../runtime/package-contract.js";
import { createTypeScriptBackend } from "./typescript-backend.js";

const runtimeReference = typeScriptRuntimeReference();

test("lowers and prints every checked source file in one batch", () => {
  const source = checkedSource({
    "/project/a.ts": "export const a = 1;\n",
    "/project/sub/b.ts": "export const b = 2;\n",
  });
  const batches: Uint8Array[][] = [];
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      const files = batch.encodedSourceFiles;
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
      ["project", "package.json"],
      ["asset", "tsonic-typescript-optimization.json"],
      ["source", "a.ts"],
      ["source", "sub/b.ts"],
    ],
  );
  assert.deepEqual(
    result.artifacts.filter((artifact) => artifact.kind === "source").map((artifact) => artifact.text),
    ["// printed 0\n", "// printed 1\n"],
  );
  assert.deepEqual(projectDependencies(result.artifacts), {});
});

test("orders source artifacts by locale-independent UTF-16 code units", () => {
  const source = checkedSource({
    "/project/z.ts": "export const z = 1;\n",
    "/project/ä.ts": "export const umlaut = 2;\n",
  });
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      const files = batch.encodedSourceFiles;
      return files.map((_, index) => `// printed ${index}\n`);
    },
  };

  const result = createTypeScriptBackend(printer).compile(
    compileInput(source),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.path),
    ["package.json", "tsonic-typescript-optimization.json", "z.ts", "ä.ts"],
  );
});

test("emits deterministic immutable optimization evidence", () => {
  const source = checkedPointerSource();
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      return batch.encodedSourceFiles.map(() => "// printed\n");
    },
  };

  const result = createTypeScriptBackend(printer, {
    pointerFlows: "closed-direct",
    scalarProjections: "closed-direct",
    cooperativeEffects: "closed-direct",
  }).compile(compileInput(source));

  assert.deepEqual(result.diagnostics, []);
  const artifact = result.artifacts.find((candidate) =>
    candidate.path === "tsonic-typescript-optimization.json"
  );
  assert.ok(artifact !== undefined);
  assert.equal(artifact.kind, "asset");
  assert.deepEqual(JSON.parse(artifact.text), {
    schemaVersion: 1,
    pointer: {
      profile: "closed-direct",
      analyzed: true,
      componentCount: 1,
      optimizedComponentCount: 1,
      optimizedFamilyCount: 0,
      representations: [{ value: "direct-snapshot", count: 1 }],
      fallbackReasons: [],
    },
    scalar: {
      profile: "closed-direct",
      syntacticProjectionCount: 0,
      optimizedProjectionCount: 0,
      retainedProjectionCount: 0,
    },
    cooperativeEffects: {
      profile: "closed-direct",
      analyzed: true,
      candidateCount: 0,
      settledCallableCount: 0,
      retainedCallableCount: 0,
      settledAwaitCount: 0,
      fallbackReasons: [],
      propagation: { vertexCount: 0, edgeCount: 0, workCount: 0 },
    },
  });
});

test("reports fallback examples with stable target-relative source identities", () => {
  const source = checkedSource({
    "/project/index.ts": `declare function remote(): Promise<number>;
export async function value(): Promise<number> { return await remote(); }
`,
  });
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      return batch.encodedSourceFiles.map(() => "// printed\n");
    },
  };

  const result = createTypeScriptBackend(printer, {
    pointerFlows: "location",
    scalarProjections: "preserve",
    cooperativeEffects: "closed-direct",
  }).compile(compileInput(source));

  assert.deepEqual(result.diagnostics, []);
  const artifact = result.artifacts.find((candidate) =>
    candidate.path === "tsonic-typescript-optimization.json"
  );
  assert.ok(artifact !== undefined);
  const evidence = JSON.parse(artifact.text) as {
    cooperativeEffects?: {
      fallbackReasons?: Array<{
        directExamples?: Array<{ documentIdentity?: string }>;
      }>;
    };
  };
  const identity = evidence.cooperativeEffects
    ?.fallbackReasons?.[0]
    ?.directExamples?.[0]
    ?.documentIdentity;
  assert.equal(identity, "index.ts");
  assert.doesNotMatch(artifact.text, /\/project|\.temp/u);
});

test("declares the exact runtime package only when pointer lowering demands it", () => {
  const source = checkedPointerSource();
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      const files = batch.encodedSourceFiles;
      return files.map((_, index) => `// printed ${index}\n`);
    },
  };

  const result = createTypeScriptBackend(printer).compile(
    compileInput(source, [runtimeReference]),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(projectDependencies(result.artifacts), {
    "@tsonic/typescript-runtime": "0.0.1",
  });
});

test("omits the pointer runtime after an exact closed-flow contraction", () => {
  const source = checkedPointerSource();
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      return batch.encodedSourceFiles.map((_, index) => `// printed ${index}\n`);
    },
  };

  const result = createTypeScriptBackend(printer, {
    pointerFlows: "closed-direct",
    scalarProjections: "preserve",
    cooperativeEffects: "preserve",
  }).compile(compileInput(source));

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(projectDependencies(result.artifacts), {});
});

test("rejects pointer lowering when the target runtime reference is absent or mismatched", () => {
  const source = checkedPointerSource();
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      const files = batch.encodedSourceFiles;
      return files.map((_, index) => `// printed ${index}\n`);
    },
  };

  for (const references of [
    [],
    [{ ...runtimeReference, version: `${runtimeReference.version}-wrong` }],
  ]) {
    const result = createTypeScriptBackend(printer).compile(
      compileInput(source, references),
    );

    assert.deepEqual(result.artifacts, []);
    assert.match(
      result.diagnostics[0]?.message ?? "",
      /TypeScript lowering requires npm-package reference '@tsonic\/typescript-runtime@0\.0\.1'/,
    );
  }
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

test("prepares every source and reports independent lowering failures before invoking the printer", () => {
  const source = checkedRejectedPointerSources();
  let printCalls = 0;
  const printer: TypeScriptAstPrinter = {
    print() {
      printCalls += 1;
      return [];
    },
  };

  const result = createTypeScriptBackend(printer).compile(
    compileInput(source),
  );

  assert.equal(printCalls, 0);
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.message),
    [
      "/project/a.ts: selected pointer marker at KindIdentifier is used as a runtime value without an exact lowering operation",
      "/project/b.ts: selected pointer marker at KindPropertyAccessExpression is used as a runtime value without an exact lowering operation",
      "/project/c.ts: address-of does not support private field storage",
    ],
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

function checkedPointerSource() {
  const markerModule = "./markers.js";
  const markerSemantics = [{
    moduleSpecifier: markerModule,
    capabilities: ["type-marker", "call-marker"],
    exports: [
      { kind: "type-marker", exportName: "Pointer", marker: "pointer" },
      { kind: "call-marker", exportName: "allocatePointer", marker: "allocate" },
      { kind: "call-marker", exportName: "loadPointer", marker: "load" },
    ],
  }] satisfies readonly SourceSemanticsModule[];
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: {
      "/project/index.ts": `import { allocatePointer, loadPointer } from "./markers.js";
export const value = loadPointer(allocatePointer(1));
`,
      "/project/markers.ts": `export interface Pointer<T> { value: T }
export declare function allocatePointer<T>(initial: T): Pointer<T>;
export declare function loadPointer<T>(pointer: Pointer<T>): T;
`,
    },
    rootFiles: ["/project/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: [createSourceSemanticsExtension({ modules: markerSemantics })],
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  return createTargetSourceProgram(checked);
}

function checkedRejectedPointerSources() {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: {
      "/project/0-valid.ts": "export const valid = 1;\n",
      "/project/a.ts": `import { loadPointer } from "./markers.js";
export const marker = loadPointer;
`,
      "/project/b.ts": `import * as markers from "./markers.js";
export const marker = markers.loadPointer;
`,
      "/project/c.ts": `import { addressOf } from "./markers.js";
class Box {
  #value = 1;
  pointer() { return addressOf(this.#value); }
}
export const box = new Box();
`,
      "/project/markers.ts": `export interface Pointer<T> { value: T }
export declare function addressOf<T>(storage: T): Pointer<T>;
export declare function loadPointer<T>(pointer: Pointer<T>): T;
`,
    },
    rootFiles: [
      "/project/0-valid.ts",
      "/project/a.ts",
      "/project/b.ts",
      "/project/c.ts",
    ],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: [createSourceSemanticsExtension({
        modules: [{
          moduleSpecifier: "./markers.js",
          capabilities: ["call-marker"],
          exports: [{
            kind: "call-marker",
            exportName: "loadPointer",
            marker: "load",
          }, {
            kind: "call-marker",
            exportName: "addressOf",
            marker: "address-of",
          }],
        }],
      })],
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  return createTargetSourceProgram(checked);
}

function compileInput(
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

function projectDependencies(
  artifacts: readonly TargetArtifact[],
): Readonly<Record<string, string>> {
  const project = artifacts.find((artifact) => artifact.path === "package.json");
  assert.ok(project !== undefined);
  const document: unknown = JSON.parse(project.text);
  assert.ok(isRecord(document));
  const dependencies = document["dependencies"];
  assert.ok(isRecord(dependencies));
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(dependencies)) {
    assert.equal(typeof version, "string");
    if (typeof version === "string") {
      result[name] = version;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
