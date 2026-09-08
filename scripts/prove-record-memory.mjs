import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { encodeTargetSourceFileForPrinting } from "@tsonic/tsts/target-ast";
import { encodePrinterRequest, decodePrinterResponse } from "../dist/print/ast-printer.js";
import { memoryFixture, lowerMemoryFixture } from "../dist/lowering/pointer/memory/memory.test-support.js";

const [printer, ...printerArguments] = process.argv.slice(2);
assert.ok(printer, "usage: node --preserve-symlinks scripts/prove-record-memory.mjs /absolute/path/to/pinned-printer [printer arguments]");
const root = resolve(".temp/record-execution", `${Date.now()}-${process.pid}`);
mkdirSync(root, { recursive: true });
const sourceText = `
import { memoryField } from "@tsonic/core/lang.js";
const Pair: {First: uint32; Second: uint32} = struct({ First: field<uint32>(), Second: field<uint32>() });
type Pair = typeof Pair;
const word = memoryLayout<uint32>(abi, 4, 4, 4);
const byte = memoryLayout<uint8>(abi, 1, 1, 1);
const layout = memoryLayout<Pair>(abi, 12, 4, 12,
  memoryField((pair: Pair) => pair.First, 0, 4, word),
  memoryField((pair: Pair) => pair.Second, 8, 4, word));
const memoryAccess = 101;
const fieldLayout = 103;
const fieldValue = 107;
const pair = allocatePointer<Pair>({ First: 1, Second: 2 });
const original = loadPointer(pair);
const first = addressOf(original.First);
const saved = addressOf(original.Second);
const raw = toRawPointer(pair, layout);
const second = reinterpretRawPointer(offsetRawPointer(raw, 8, abi), word);
if (second !== undefined) storePointer(second, 9);
const view = reinterpretRawPointer(raw, layout);
if (view !== undefined) loadPointer(view).Second = 17;
const padding = reinterpretRawPointer(offsetRawPointer(raw, 5, abi), byte);
if (padding !== undefined) storePointer(padding, 79);
storePointer(saved, 23);
export const result = [loadPointer(saved), view === undefined ? 0 : loadPointer(view).Second,
  equalPointer(second, saved), equalPointer(view, pair), equalRawPointer(raw, toRawPointer(first, word)),
  padding === undefined ? 0 : loadPointer(padding), memoryAccess, fieldLayout, fieldValue];
`;
const results = [];
for (const order of ["little", "big"]) {
  for (const optimize of [false, true]) {
    const fixture = memoryFixture(sourceText, { byteOrder: order, addressWidth: 64 });
    const lowered = lowerMemoryFixture(fixture, optimize);
    const encoded = encodeTargetSourceFileForPrinting(lowered.sourceFile);
    const printed = spawnSync(printer, [...printerArguments, "-cwd", root], {
      input: encodePrinterRequest([encoded]), maxBuffer: 2 * 1024 * 1024, timeout: 30_000,
    });
    assert.equal(printed.error, undefined);
    assert.equal(printed.status, 0, printed.stderr.toString());
    const outputs = decodePrinterResponse(printed.stdout, 1);
    const text = outputs[0];
    assert.equal(typeof text, "string");
    const name = `record-${order}-${optimize}`;
    const file = resolve(root, `${name}.ts`);
    writeFileSync(file, text);
    const checked = spawnSync(process.execPath, [
      "node_modules/typescript/bin/tsc", file, "--strict", "--noUncheckedIndexedAccess",
      "--exactOptionalPropertyTypes", "--skipLibCheck", "false", "--target", "ES2022",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--outDir", resolve(root, "js"),
    ], { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
    writeFileSync(resolve(root, `${name}.check.log`), checked.stdout + checked.stderr);
    assert.equal(checked.error, undefined);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const executed = await import(pathToFileURL(resolve(root, "js", `${name}.js`)).href);
    assert.deepEqual(executed.result, [23, 23, true, true, true, 79, 101, 103, 107]);
    results.push({ order, optimize, bytes: Buffer.byteLength(text), result: executed.result });
  }
}
writeFileSync(resolve(root, "evidence.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ root, results }, null, 2));
