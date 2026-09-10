import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeTargetSourceFileForPrinting } from "@tsonic/tsts/target-ast";
import { encodePrinterRequest, decodePrinterResponse } from "../dist/print/ast-printer.js";
import { checkedPointerFixture } from "../dist/lowering/pointer/pointer.test-support.js";
import { prepareTypeScriptLowering } from "../dist/lowering/transform.js";

const [printer, ...printerArguments] = process.argv.slice(2);
assert.ok(printer, "a pinned printer executable is required");
const root = resolve(".temp/nil-check-order", `${Date.now()}-${process.pid}`);
mkdirSync(root, { recursive: true });
const sourceText = `
interface Box { value: number }
let trace = 0;
function effect(): number { trace = trace * 10 + 1; return 1; }
function panic(): never { trace = trace * 10 + 9; throw new Error("nil"); }
function callable(): (value: number) => number { effect(); return value => value; }
function read(box: Box | undefined): number {
  let value: number = (box ?? panic()).value;
  return value + (box ?? panic()).value;
}
function first(box: Box | undefined): number {
  const value = (box ?? panic()).value, other = effect();
  return value + other + (box ?? panic()).value;
}
function later(box: Box | undefined): number {
  const other = effect(), value = (box ?? panic()).value;
  return other + value + (box ?? panic()).value;
}
function conditional(box: Box | undefined, enabled: boolean): number {
  const value = enabled ? (box ?? panic()).value : 0;
  effect();
  return value + (box ?? panic()).value;
}
function argument(box: Box | undefined): number {
  const value = callable()((box ?? panic()).value);
  return value + (box ?? panic()).value;
}
function run(action: () => number): [number, number] {
  trace = 0;
  try { return [action(), trace]; }
  catch { return [-1, trace]; }
}
export const result = [
  run(() => read(undefined)), run(() => read({value: 2})),
  run(() => first(undefined)), run(() => first({value: 2})),
  run(() => later(undefined)), run(() => later({value: 2})),
  run(() => conditional(undefined, false)), run(() => conditional({value: 2}, false)),
  run(() => argument(undefined)), run(() => argument({value: 2})),
];
`;
const fixture = checkedPointerFixture(sourceText);
const preparation = prepareTypeScriptLowering(
  fixture.source, [...fixture.source.navigation.sourceFiles],
  { pointerFlows: "closed-direct", scalarProjections: "closed-direct", representationProjections: "closed-direct" },
  sourceFile => fixture.source.ast.getFileName(sourceFile),
);
assert.equal(preparation.kind, "ready");
let lowered;
for (const sourceFile of fixture.source.navigation.sourceFiles) {
  const result = preparation.transaction.lower(sourceFile);
  if (sourceFile === fixture.sourceFile) lowered = result.sourceFile;
}
preparation.transaction.finish();
assert.ok(lowered);
const printed = spawnSync(printer, [...printerArguments, "-cwd", root], {
  input: encodePrinterRequest([encodeTargetSourceFileForPrinting(lowered)]),
  maxBuffer: 1024 * 1024, timeout: 30_000,
});
assert.equal(printed.error, undefined);
assert.equal(printed.signal, null);
assert.equal(printed.status, 0, printed.stderr.toString());
const [loweredText] = decodePrinterResponse(printed.stdout, 1);
assert.equal(typeof loweredText, "string");
writeFileSync(resolve(root, "original.ts"), sourceText);
writeFileSync(resolve(root, "lowered.ts"), loweredText);
const checked = spawnSync(process.execPath, [
  "node_modules/typescript/bin/tsc", resolve(root, "original.ts"), resolve(root, "lowered.ts"),
  "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--skipLibCheck", "false",
  "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
  "--outDir", resolve(root, "js"),
], { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
writeFileSync(resolve(root, "check.log"), (checked.stdout ?? "") + (checked.stderr ?? ""));
assert.equal(checked.error, undefined);
assert.equal(checked.signal, null);
assert.equal(checked.status, 0, checked.stdout + checked.stderr);
const original = await import(pathToFileURL(resolve(root, "js/original.js")).href);
const translated = await import(pathToFileURL(resolve(root, "js/lowered.js")).href);
assert.deepEqual(original.result, [[-1, 9], [4, 0], [-1, 9], [5, 1], [-1, 19], [5, 1], [-1, 19], [2, 1], [-1, 19], [4, 1]]);
assert.deepEqual(translated.result, original.result);
const nilChecks = preparation.transaction.evidence.pointer.dominatingNilChecks;
assert.equal(nilChecks.eliminatedGuardCount, 2);
writeFileSync(resolve(root, "evidence.json"), JSON.stringify({
  cases: translated.result.length, result: translated.result,
  eliminatedGuardCount: nilChecks.eliminatedGuardCount,
}, null, 2) + "\n");
console.log(`nil-check execution order: ${translated.result.length} original/lowered cases match; evidence=${root}`);
