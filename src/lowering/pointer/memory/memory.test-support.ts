import assert from "node:assert/strict";
import { createCompilerSessionFromFiles, createSourceSemanticsExtension, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createTsonicCoreSourceExtension, tsonicCoreSourceSemanticsModules } from "@tsonic/source-core";
import { createSourceSemanticsVirtualModuleProvider } from "@tsonic/source-core/extension";
import type { TsonicDataLayoutDescriptor } from "@tsonic/target-api/provider";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";

export const memoryPrelude = `
import { abi } from "test:memory";
import type { Pointer, RawPointer, MemoryLayout, int32, uint32, uint8, uint64, nativeUint } from "@tsonic/core/types.js";
import { memoryLayout, addressOf, allocatePointer, toRawPointer, reinterpretRawPointer, offsetRawPointer,
  loadPointer, storePointer, equalPointer, equalRawPointer, hashRawPointer, sizeOf, alignOf, strideOf,
  keepAlive, rawPointerToAddressInteger, addressIntegerToRawPointer } from "@tsonic/core/lang.js";
`;

export function memoryFixture(text: string, abi: Pick<TsonicDataLayoutDescriptor, "byteOrder" | "addressWidth"> = { byteOrder: "little", addressWidth: 64 }) {
  const provider = createSourceSemanticsVirtualModuleProvider({
    id: "test.memory", version: "1", displayName: "Test memory ABI", virtualDirectory: "test-memory",
    modules: [{ moduleSpecifier: "test:memory", exports: [] }], evidenceMessage: "Explicit test ABI",
    importsForModule: () => [{ moduleSpecifier: "@tsonic/core/types.js", namedImports: [{ exportedName: "DataLayout", kind: "type" }], typeOnly: true }],
    exportsForModule: () => [{ id: "abi", name: "abi", kind: "value",
      type: { kind: "provider-ref", moduleSpecifier: "@tsonic/core/types.js", exportName: "DataLayout" } }],
  });
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/src", files: { "/src/index.ts": memoryPrelude + text },
    compilerOptions: { module: "esnext", moduleResolution: "bundler", strict: true, target: "es2022" },
    extensionHostOptions: { extensions: [
      createSourceSemanticsExtension({ modules: tsonicCoreSourceSemanticsModules() }),
      createTsonicCoreSourceExtension({ dataLayouts: [{
        providerDeclaration: { providerId: "test.memory", providerVersion: "1", providerModuleId: "test:memory", moduleSpecifier: "test:memory", exportId: "abi" },
        descriptor: { fingerprint: `test-${abi.byteOrder}-${abi.addressWidth}`, ...abi },
      }] }),
      { identity: { id: "test.memory", version: "1" }, initialize(context) { context.registerSourceDeclarationProvider(provider); } },
    ] },
  }).checkSource();
  const diagnostics = checked.diagnostics.filter((diagnostic) => diagnostic !== undefined);
  assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics, "/src"));
  assert.equal(checked.extensionDiagnostics.length, 0, checked.extensionDiagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.sourceFiles.find((file) => source.ast.getFileName(file) === "/src/index.ts");
  assert.ok(sourceFile);
  return { source, sourceFile };
}

export function lowerMemoryFixture(fixture: ReturnType<typeof memoryFixture>, optimize = false) {
  const profile = canonicalTypeScriptOptimizationProfile();
  const prepared = prepareTypeScriptLowering(fixture.source, fixture.source.navigation.sourceFiles,
    optimize ? { ...profile, pointerFlows: "closed-direct" } : profile,
    (file) => fixture.source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "ready", prepared.kind === "rejected" ? prepared.failures.map((failure) => failure.message).join("\n") : "");
  if (prepared.kind !== "ready") throw new Error("memory preparation failed");
  const result = prepared.transaction.lower(fixture.sourceFile);
  prepared.transaction.finish();
  return result;
}
