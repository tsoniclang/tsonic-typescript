import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCompilerSessionFromFiles,
  createSourceSemanticsExtension,
  type SourceSemanticsModule,
} from "@tsonic/tsts";
import {
  createTargetSourceProgram,
} from "@tsonic/target-api/source";
import type { TargetArtifact } from "@tsonic/target-api/artifacts";

import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { typeScriptRuntimeReference } from "../runtime/package-contract.js";
import {
  checkedSource,
  compiledArtifacts,
  compileInput,
  createTestTypeScriptCompiler,
} from "./typescript-backend.test-support.js";

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

  const result = createTestTypeScriptCompiler(printer).compile(
    compileInput(source),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.length, 2);
  assert.ok(batches[0]?.every((encoded) => encoded.byteLength > 0));
  assert.deepEqual(
    compiledArtifacts(result).map((artifact) => [artifact.kind, artifact.path]),
    [
      ["project", "package.json"],
      ["asset", "tsonic-typescript-optimization.json"],
      ["source", "a.ts"],
      ["source", "sub/b.ts"],
    ],
  );
  assert.deepEqual(
    compiledArtifacts(result).filter((artifact) => artifact.kind === "source").map((artifact) => artifact.text),
    ["// printed 0\n", "// printed 1\n"],
  );
  assert.deepEqual(projectDependencies(compiledArtifacts(result)), {});
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

  const result = createTestTypeScriptCompiler(printer).compile(
    compileInput(source),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    compiledArtifacts(result).map((artifact) => artifact.path),
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

  const result = createTestTypeScriptCompiler(printer, {
    pointerFlows: "closed-direct",
    scalarProjections: "closed-direct",
    representationProjections: "preserve",
  }).compile(compileInput(source));

  assert.deepEqual(result.diagnostics, []);
  const artifact = compiledArtifacts(result).find((candidate) =>
    candidate.path === "tsonic-typescript-optimization.json"
  );
  assert.ok(artifact !== undefined);
  assert.equal(artifact.kind, "asset");
  assert.deepEqual(JSON.parse(artifact.text), {
    schemaVersion: 29,
    sourceExecution: "unrestricted",
    profileIdentity:
      "typescript-optimization-v4/pointer=closed-direct/scalar=closed-direct/representations=preserve",
    sourceMembership: ["index.ts", "markers.ts"],
    programIndex: {
      nodeVisits: 82,
      childEdges: 80,
      kindEntries: 82,
      identifierEntries: 29,
      sourceReferenceIndex: source.navigation.referenceIndexStatistics,
      bindingCandidates: 0,
      bindingWrites: 0,
    },
    pointer: {
      profile: "closed-direct",
      analyzed: true,
      componentCount: 1,
      optimizedComponentCount: 1,
      optimizedFamilyCount: 0,
      retainedFamilyCount: 0,
      retainedFamilyHotspots: [],
      directObjectReplacementCount: 0,
      optimizedProjectionReadCount: 0,
      optimizedProjectionStoreCount: 0,
      optimizedProjectedPropertyLocationCount: 0,
      optimizedPointerKeyMapCount: 0,
      representations: [{ value: "direct-snapshot", count: 1 }],
      fallbackReasons: [],
      familyFallbackReasons: [],
      projectionCallables: {
        candidateCount: 0,
        optimizedCount: 0,
        retainedCount: 0,
        fallbackReasons: [],
      },
    },
    scalar: {
      profile: "closed-direct",
      syntacticProjectionCount: 0,
      optimizedProjectionCount: 0,
      retainedProjectionCount: 0,
      fallbackReasons: [],
      scalarClassCandidateCount: 0,
      loweredScalarClassCount: 0,
      retainedScalarClassCount: 0,
      scalarClassFallbackReasons: [],
    },
    representationProjections: {
      profile: "preserve",
      identityCandidateCount: 0,
      inverseCandidateCount: 0,
      optimizedCount: 0,
      retainedCount: 0,
      fallbackReasons: [],
      storedFlows: {
        flowCount: 0,
        constructionCount: 0,
        projectionCount: 0,
      },
      identityCallables: {
        candidateCount: 0,
        optimizedCount: 0,
        retainedCount: 0,
        fallbackReasons: [],
      },
    },
    representationTransports: {
      digest:
        "e0b8c30fa1ab2fb9d676b79532fb204339a6666ecb3f546a49d4c57a577fa909",
      contractCount: 0,
      selectedCallCount: 0,
    },
  });
});

test("reports exact pointer fallback examples without machine-local paths", () => {
  const sourceText = `import { allocatePointer, loadPointer } from "./markers.js";
const pointer = allocatePointer(1);
export const escaped = { pointer };
export const value = loadPointer(pointer);
`;
  const source = checkedPointerSource(sourceText);
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      return batch.encodedSourceFiles.map(() => "// printed\n");
    },
  };

  const result = createTestTypeScriptCompiler(printer, {
    pointerFlows: "closed-direct",
    scalarProjections: "preserve",
    representationProjections: "preserve",
  }).compile(compileInput(source, [runtimeReference]));

  assert.deepEqual(result.diagnostics, []);
  const artifact = compiledArtifacts(result).find((candidate) =>
    candidate.path === "tsonic-typescript-optimization.json"
  );
  assert.ok(artifact !== undefined);
  const evidence = JSON.parse(artifact.text) as {
    pointer?: {
      fallbackReasons?: Array<{
        reason?: string;
        examples?: Array<{
          kind?: string;
          documentIdentity?: string;
          start?: number;
          syntaxKind?: string;
        }>;
      }>;
    };
  };
  const examples = evidence.pointer?.fallbackReasons?.flatMap((reason) =>
    reason.examples ?? []
  ) ?? [];
  assert.ok(examples.length > 0);
  assert.ok(examples.every((example) => example.kind === "authored"));
  assert.ok(examples.every((example) => example.documentIdentity === "index.ts"));
  const unsupported = evidence.pointer?.fallbackReasons?.find((reason) =>
    reason.reason === "unsupported-flow"
  );
  const escapedPointer = sourceText.indexOf(
    "pointer",
    sourceText.indexOf("escaped"),
  );
  assert.ok(escapedPointer >= 0);
  assert.ok(unsupported?.examples?.some((example) =>
    example.start === escapedPointer && example.syntaxKind === "KindIdentifier"
  ));
  assert.doesNotMatch(artifact.text, /\/project|\.temp/u);
});

test("reports exact direct-reference family retention evidence", () => {
  const sourceText = `import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box { value = 1; }
const box = new Box();
const left: Pointer<Box> = allocatePointer(box);
const right: Pointer<Box> = allocatePointer(box);
export const same = equalPointer(left, right);
`;
  const source = checkedPointerSource(sourceText);
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      return batch.encodedSourceFiles.map(() => "// printed\n");
    },
  };

  const result = createTestTypeScriptCompiler(printer, {
    pointerFlows: "closed-direct",
    scalarProjections: "preserve",
    representationProjections: "preserve",
  }).compile(compileInput(source, [runtimeReference]));

  assert.deepEqual(result.diagnostics, []);
  const artifact = compiledArtifacts(result).find((candidate) =>
    candidate.path === "tsonic-typescript-optimization.json"
  );
  assert.ok(artifact !== undefined);
  const evidence = JSON.parse(artifact.text) as {
    pointer?: {
      familyFallbackReasons?: Array<{
        reason?: string;
        count?: number;
        examples?: Array<{
          documentIdentity?: string;
          start?: number;
          syntaxKind?: string;
        }>;
      }>;
      retainedFamilyCount?: number;
      retainedFamilyHotspots?: Array<{
        identity?: { documentIdentity?: string; syntaxKind?: string };
        pointerTypeCount?: number;
        operationCount?: number;
        reasons?: Array<{
          reason?: string;
          occurrenceCount?: number;
          examples?: unknown[];
        }>;
      }>;
    };
  };
  const identity = evidence.pointer?.familyFallbackReasons?.find((reason) =>
    reason.reason === "non-bijective-identity"
  );
  assert.equal(identity?.count, 1);
  assert.equal(evidence.pointer?.retainedFamilyCount, 1);
  const hotspot = evidence.pointer?.retainedFamilyHotspots?.[0];
  assert.equal(hotspot?.identity?.documentIdentity, "index.ts");
  assert.equal(hotspot?.identity?.syntaxKind, "KindClassDeclaration");
  assert.equal(hotspot?.pointerTypeCount, 2);
  assert.equal(hotspot?.operationCount, 3);
  assert.deepEqual(
    hotspot?.reasons?.map(({ reason, occurrenceCount }) => ({
      reason,
      occurrenceCount,
    })),
    [{ reason: "non-bijective-identity", occurrenceCount: 2 }],
  );
  const firstAllocation = sourceText.indexOf("allocatePointer(box)");
  assert.ok(identity?.examples?.some((example) =>
    example.documentIdentity === "index.ts" &&
    example.start === firstAllocation + "allocatePointer(".length &&
    example.syntaxKind === "KindIdentifier"
  ));
  assert.doesNotMatch(artifact.text, /\/project|\.temp/u);
});

test("declares the exact runtime package only when pointer lowering demands it", () => {
  const source = checkedRuntimePointerSource();
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      const files = batch.encodedSourceFiles;
      return files.map((_, index) => `// printed ${index}\n`);
    },
  };

  const result = createTestTypeScriptCompiler(printer).compile(
    compileInput(source, [runtimeReference]),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(projectDependencies(compiledArtifacts(result)), {
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

  const result = createTestTypeScriptCompiler(printer, {
    pointerFlows: "closed-direct",
    scalarProjections: "preserve",
    representationProjections: "preserve",
  }).compile(compileInput(source));

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(projectDependencies(compiledArtifacts(result)), {});
});

test("rejects pointer lowering when the target runtime reference is absent or mismatched", () => {
  const source = checkedRuntimePointerSource();
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
    const result = createTestTypeScriptCompiler(printer).compile(
      compileInput(source, references),
    );

    assert.equal(result.kind, "rejected");
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

  const result = createTestTypeScriptCompiler(printer).compile(
    compileInput(source),
  );

  assert.equal(result.kind, "rejected");
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

  const result = createTestTypeScriptCompiler(printer, {
    pointerFlows: "location",
    scalarProjections: "preserve",
    representationProjections: "preserve",
  }).compile(
    compileInput(source),
  );

  assert.equal(printCalls, 0);
  assert.equal(result.kind, "rejected");
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.message),
    [
      "/project/a.ts: selected pointer marker at KindIdentifier is used as a runtime value without an exact lowering operation",
      "/project/b.ts: selected pointer marker at KindPropertyAccessExpression is used as a runtime value without an exact lowering operation",
      "/project/c.ts: address-of does not support private field storage",
    ],
  );
});

test("rejects authored suspension before invoking the printer", () => {
  const source = checkedSource({
    "/project/a.ts": `export async function value(): Promise<number> {
  return await Promise.resolve(1);
}
`,
  });
  let printCalls = 0;
  const printer: TypeScriptAstPrinter = {
    print() {
      printCalls += 1;
      return [];
    },
  };

  const result = createTestTypeScriptCompiler(
    printer,
    undefined,
    "synchronous",
  ).compile(compileInput(source));

  assert.equal(result.kind, "rejected");
  assert.equal(printCalls, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes(
      "synchronous source contract rejects KindFunctionDeclaration",
    )
  ));
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes(
      "synchronous source contract rejects KindAwaitExpression",
    )
  ));
});

function checkedPointerSource(
  sourceText = `import { allocatePointer, loadPointer } from "./markers.js";
export const value = loadPointer(allocatePointer(1));
`,
) {
  const markerModule = "./markers.js";
  const markerSemantics = [{
    moduleSpecifier: markerModule,
    capabilities: ["type-marker", "call-marker"],
    exports: [
      { kind: "type-marker", exportName: "Pointer", marker: "pointer" },
      { kind: "call-marker", exportName: "allocatePointer", marker: "allocate" },
      { kind: "call-marker", exportName: "loadPointer", marker: "load" },
      { kind: "call-marker", exportName: "equalPointer", marker: "equal-pointer" },
    ],
  }] satisfies readonly SourceSemanticsModule[];
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: {
      "/project/index.ts": sourceText,
      "/project/markers.ts": `export interface Pointer<T> { value: T }
export declare function allocatePointer<T>(initial: T): Pointer<T>;
export declare function loadPointer<T>(pointer: Pointer<T>): T;
export declare function equalPointer<T>(left: Pointer<T> | undefined, right: Pointer<T> | undefined): boolean;
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

function checkedRuntimePointerSource() {
  return checkedPointerSource(`import { allocatePointer, equalPointer } from "./markers.js";
const left = allocatePointer(1);
const right = allocatePointer(2);
export const value = equalPointer(left, right);
`);
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
