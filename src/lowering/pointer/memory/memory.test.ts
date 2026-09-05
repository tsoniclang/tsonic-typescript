import assert from "node:assert/strict";
import test from "node:test";
import { readTsonicRawMemoryOperation, tsonicRawMemoryOperationFactKey } from "@tsonic/source-core/facts";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { countCallsNamed, importModules, visit } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

const roundTrip = `
const word = memoryLayout<uint32>(abi, 4, 4, 4);
const byte = memoryLayout<uint8>(abi, 1, 1, 1);
let count: uint32 = 1;
const raw = toRawPointer(addressOf(count), word);
const alias = toRawPointer(addressOf(count), word);
const view = reinterpretRawPointer(offsetRawPointer(raw, 1, abi), byte);
if (view !== undefined) storePointer(view, 7);
keepAlive(count);
export const result = [count, equalRawPointer(raw, alias), hashRawPointer(raw) === hashRawPointer(alias), sizeOf(word)];
`;

for (const optimize of [false, true]) {
  test(`shared memory facts lower on the same tree with exact aliases, optimize=${optimize}`, () => {
    const fixture = memoryFixture(roundTrip);
    const lowered = lowerMemoryFixture(fixture, optimize);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "uint32Layout"), 1);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "uint8Layout"), 1);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "reinterpretRawPointer"), 1);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryLayout"), 0);
    assert.deepEqual(importModules(fixture.source, lowered.sourceFile), ["@tsonic/typescript-runtime"]);
  });
}

test("a selected memory operation without its shared fact fails during planning", () => {
  const fixture = memoryFixture(roundTrip);
  let calls = 0;
  visit(fixture.source, fixture.sourceFile, (node) => {
    if (readTsonicRawMemoryOperation(fixture.source.sourceFacts, node)?.call === node) calls++;
  });
  assert.ok(calls > 0);
  const facts = fixture.source.sourceFacts;
  const source = { ...fixture.source, sourceFacts: {
    ...facts,
    getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
      return Object.is(key, tsonicRawMemoryOperationFactKey) ? undefined : facts.getFact(subject, key);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    (file) => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
  if (prepared.kind === "rejected") assert.match(prepared.failures[0]?.message ?? "", /one exact shared fact/);
});

test("native physical addresses fail before any printer transaction", () => {
  const fixture = memoryFixture(`
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    let count: uint32 = 1;
    export const result = rawPointerToAddressInteger(toRawPointer(addressOf(count), word), abi);
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /physical native address/);
});

test("same-spelled local functions remain ordinary calls", () => {
  const fixture = memoryFixture(`
    function local(): number {
      function toRawPointer(value: number): number { return value + 1; }
      return toRawPointer(3);
    }
    export const result = local();
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "toRawPointer"), 1);
});

test("immutable ABI and layout aliases retain the selected facts", () => {
  const fixture = memoryFixture(`
    const chosen = abi;
    const copied = chosen;
    const word = memoryLayout<uint32>(copied, 4, 4, 4);
    const descriptor = word;
    let count: uint32 = 1;
    const raw = toRawPointer(addressOf(count), descriptor);
    export const result = hashRawPointer(raw);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.deepEqual(importModules(fixture.source, lowered.sourceFile), ["@tsonic/typescript-runtime"]);
});

test("observable ABI comparisons cannot be erased", () => {
  const fixture = memoryFixture(`
    const chosen = abi;
    const word = memoryLayout<uint32>(chosen, 4, 4, 4);
    export const result = chosen === abi;
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /ABI token has an observable use/);
});

test("scalar layouts follow finalized authored alias dependencies", () => {
  const fixture = memoryFixture(`
    type First = uint32;
    type Second = First;
    const word = memoryLayout<Second>(abi, 4, 4, 4);
    let count: Second = 1;
    export const raw = toRawPointer(addressOf(count), word);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "uint32Layout"), 1);
});

for (const [name, expression] of [
  ["unproven scalar domain", "memoryLayout<number>(abi, 4, 4, 4)"],
  ["mismatched size", "memoryLayout<uint32>(abi, 8, 8, 8)"],
  ["aggregate", "memoryLayout<{count:uint32}>(abi, 4, 4, 4)"],
  ["nested scalar in aggregate", "memoryLayout<readonly uint32[]>(abi, 4, 4, 4)"],
]) {
  test(`unsupported ${name} cannot acquire a scalar codec`, () => {
    const fixture = memoryFixture(`export const result = ${expression};`);
    assert.throws(() => lowerMemoryFixture(fixture), /memory layout/);
  });
}
