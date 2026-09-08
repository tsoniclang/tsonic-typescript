import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { encodeTargetSourceFileForPrinting } from "@tsonic/tsts/target-ast";
import { encodePrinterRequest, decodePrinterResponse } from "../dist/print/ast-printer.js";
import { memoryFixture, memoryPrelude } from "../dist/lowering/pointer/memory/memory.test-support.js";
import { prepareTypeScriptLowering } from "../dist/lowering/transform.js";
import { canonicalTypeScriptOptimizationProfile } from "../dist/lowering/profile.js";
import { countCallsNamed } from "../dist/lowering/pointer/pointer.test-support.js";

const [printer, ...printerArguments] = process.argv.slice(2);
assert.ok(printer, "expected pinned printer and its arguments");
const root = resolve(".temp/reference-execution", `${Date.now()}-${process.pid}`);
const results = [];
for (const order of ["little", "big"]) for (const optimize of [false, true]) {
  const folder = resolve(root, `${order}-${optimize}`);
  mkdirSync(folder, { recursive: true });
  const fixture = memoryFixture(`
    import { otherLayout, ping } from "./other.js";
    const pointerMemoryLayout = 17;
    export const firstLayout = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
    export function alive() { return pointerMemoryLayout; }
    const first = allocatePointer<uint32>(3);
    const second = allocatePointer<uint32>(7);
    const slot = allocatePointer<Pointer<uint32> | undefined>(first);
    const view = reinterpretRawPointer(toRawPointer(slot, firstLayout), otherLayout);
    if (view === undefined) throw new Error("nil");
    const saved = loadPointer(view);
    storePointer(view, second);
    export const result = [equalPointer(saved, first), equalPointer(loadPointer(view), second), ping()];
  `, { byteOrder: order, addressWidth: 64 }, {
    "/src/other.ts": memoryPrelude + `
      import { alive } from "./index.js";
      type Word = Pointer<uint32> | undefined;
      export const otherLayout = memoryLayout<Word>(abi, 8, 8, 8);
      export function ping() { return alive(); }
    `,
  });
  const profile = canonicalTypeScriptOptimizationProfile();
  const sourceFiles = fixture.source.navigation.sourceFiles;
  const prepared = prepareTypeScriptLowering(fixture.source, sourceFiles,
    optimize ? { ...profile, pointerFlows: "closed-direct" } : profile,
    file => fixture.source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "ready", prepared.kind === "rejected" ? prepared.failures.map(failure => failure.message).join("\n") : "");
  const lowered = sourceFiles.map(file => prepared.transaction.lower(file));
  prepared.transaction.finish();
  assert.equal(lowered.reduce((sum, result) => sum + countCallsNamed(fixture.source, result.sourceFile, "referenceLayout"), 0), 1);
  const printed = spawnSync(printer, [...printerArguments, "-cwd", folder], {
    input: encodePrinterRequest(lowered.map(result => encodeTargetSourceFileForPrinting(result.sourceFile))),
    maxBuffer: 2 * 1024 * 1024, timeout: 30000,
  });
  assert.equal(printed.error, undefined);
  assert.equal(printed.status, 0, printed.stderr.toString());
  const outputs = decodePrinterResponse(printed.stdout, sourceFiles.length);
  const files = sourceFiles.map((file, index) => {
    const path = relative("/src", fixture.source.ast.getFileName(file));
    assert.ok(!path.startsWith(".."));
    const target = resolve(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, outputs[index]);
    return target;
  });
  const checked = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", ...files, "--strict", "--noUncheckedIndexedAccess",
    "--exactOptionalPropertyTypes", "--skipLibCheck", "false", "--target", "ES2022", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--outDir", resolve(folder, "js")], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  writeFileSync(resolve(folder, "strict.log"), checked.stdout + checked.stderr);
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const executed = await import(pathToFileURL(resolve(folder, "js/index.js")).href);
  assert.deepEqual(executed.result, [true, true, 17]);
  results.push({ order, optimize, bytes: outputs.reduce((sum, text) => sum + Buffer.byteLength(text), 0), result: executed.result });
}
writeFileSync(resolve(root, "evidence.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ root, results }));
