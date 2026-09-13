import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@tsonic/tsts";
import { readTsonicMemoryLayout, tsonicMemoryLayoutFactKey } from "@tsonic/source-core/facts";
import { countCallsNamed, importModules, visit } from "../pointer.test-support.js";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";
import { metadataOnlyTypeImports } from "./metadata-imports.js";
import type { MemoryRewrite } from "./plan.js";

for (const count of ["0", "2", "9007199254740993n"]) {
  test(`zero-sized fixed-array observation retains exact extent ${count} without a codec`, () => {
    const fixture = memoryFixture(`
      import { memoryArrayLayout } from "@tsonic/core/lang.js";
      interface Empty {}
      const empty = memoryLayout<Empty>(abi, 0, 1, 0);
      const array = memoryArrayLayout(abi, 0, 1, 0, empty, ${count});
      const alias = array;
      export const size = sizeOf(alias);
      export const alignment = alignOf(alias);
    `);
    let arrays = 0;
    visit(fixture.source, fixture.sourceFile, node => {
      const layout = readTsonicMemoryLayout(fixture.source.sourceFacts, node);
      if (layout?.call !== node || layout.kind !== "array") return;
      arrays++;
      assert.equal(layout.fixedArray.length, BigInt(count.replace(/n$/, "")));
      assert.equal(layout.fixedArray.lengthRuntimeBase, count.endsWith("n") ? "bigint" : "number");
      assert.equal(layout.elementLayout.byteSize, 0);
    });
    assert.equal(arrays, 1);
    const lowered = lowerMemoryFixture(fixture);
    for (const name of ["memoryArrayLayout", "memoryLayout", "sizeOf", "alignOf", "identityLayout"]) {
      assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, name), 0);
    }
    assert.deepEqual(importModules(fixture.source, lowered.sourceFile), []);
  });
}

test("nested array and record metadata does not demand an executable record codec", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout, memoryField } from "@tsonic/core/lang.js";
    import type { FixedArray } from "@tsonic/core/types.js";
    interface Entry { flag: uint8; count: uint32 }
    const byte = memoryLayout<uint8>(abi, 1, 1, 1);
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const entry = memoryLayout<Entry>(abi, 8, 4, 8,
      memoryField((value: Entry) => value.flag, 0, 1, byte),
      memoryField((value: Entry) => value.count, 4, 4, word));
    const entries: MemoryLayout<FixedArray<Entry, 2>> = memoryArrayLayout(abi, 16, 4, 16, entry, 2);
    const matrix = memoryArrayLayout(abi, 48, 4, 48, entries, 3);
    export const size = sizeOf(matrix);
    export const stride = strideOf(matrix);
  `);
  const lowered = lowerMemoryFixture(fixture);
  for (const name of ["recordLayout", "recordField", "memoryArrayLayout", "sizeOf", "strideOf"]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, name), 0);
  }
  assert.deepEqual(importModules(fixture.source, lowered.sourceFile), []);
});

test("physical raw arrays retain an address descriptor rather than selecting a scalar codec", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout } from "@tsonic/core/lang.js";
    import type { FixedArray } from "@tsonic/core/types.js";
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const layout = memoryArrayLayout(abi, 8, 4, 8, word, 2);
    const tuple: [uint32, uint32] = [1, 2];
    let values: FixedArray<uint32, 2> = tuple;
    export const raw = toRawPointer(addressOf(values), layout);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "arrayAddressLayout"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "uint32Layout"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "toRawPointer"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryArrayLayout"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "identityLayout"), 0);
});

test("nested address descriptors retain each exact array layer", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout } from "@tsonic/core/lang.js";
    import type { FixedArray } from "@tsonic/core/types.js";
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const pair = memoryArrayLayout(abi, 8, 4, 8, word, 2);
    const matrix = memoryArrayLayout(abi, 24, 4, 24, pair, 3);
    export function retain(value: FixedArray<FixedArray<uint32, 2>, 3>) {
      return toRawPointer(addressOf(value), matrix);
    }
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "arrayAddressLayout"), 2);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "uint32Layout"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "identityLayout"), 0);
});

test("huge zero-sized address descriptors preserve bigint counts without allocating arrays", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout } from "@tsonic/core/lang.js";
    import type { FixedArray } from "@tsonic/core/types.js";
    interface Empty {}
    const empty = memoryLayout<Empty>(abi, 0, 1, 0);
    const values = memoryArrayLayout(abi, 0, 1, 0, empty, 9007199254740993n);
    export function retain(value: FixedArray<Empty, 9007199254740993n>) {
      return toRawPointer(addressOf(value), values);
    }
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "arrayAddressLayout"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "identityLayout"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "defaultValue"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "Array"), 0);
});

test("renamed fixed-array imports erase through exact bindings, not marker spelling", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout as inlineLayout } from "@tsonic/core/lang.js";
    import type { FixedArray as Inline } from "@tsonic/core/types.js";
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const values: MemoryLayout<Inline<uint32, 2>> = inlineLayout(abi, 8, 4, 8, word, 2);
    export const result = sizeOf(values);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.deepEqual(importModules(fixture.source, lowered.sourceFile), []);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "inlineLayout"), 0);
});

test("dropping an array child fact fails the real finalized observation join", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout } from "@tsonic/core/lang.js";
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const values = memoryArrayLayout(abi, 8, 4, 8, word, 2);
    export const result = sizeOf(values);
  `);
  const facts = fixture.source.sourceFacts;
  const source = { ...fixture.source, sourceFacts: {
    ...facts,
    getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
      if (Object.is(key, tsonicMemoryLayoutFactKey) && readTsonicMemoryLayout(facts, subject)?.kind === "value") return undefined;
      return facts.getFact(subject, key);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
});

test("dropping an array child fact also blocks address-only raw transport", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout } from "@tsonic/core/lang.js";
    import type { FixedArray } from "@tsonic/core/types.js";
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const values = memoryArrayLayout(abi, 8, 4, 8, word, 2);
    export function retain(value: FixedArray<uint32, 2>) {
      return toRawPointer(addressOf(value), values);
    }
  `);
  const facts = fixture.source.sourceFacts;
  const source = { ...fixture.source, sourceFacts: {
    ...facts,
    getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
      if (Object.is(key, tsonicMemoryLayoutFactKey) && readTsonicMemoryLayout(facts, subject)?.kind === "value") return undefined;
      return facts.getFact(subject, key);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
});

test("metadata erasure rejects runtime escapes instead of returning undefined", () => {
  const fixture = memoryFixture(`
    import { memoryArrayLayout } from "@tsonic/core/lang.js";
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const values = memoryArrayLayout(abi, 8, 4, 8, word, 2);
    export function escaped() { return values; }
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /runtime value|compile-time metadata/);
});

test("metadata erasure retains a type import used by an ordinary public signature", () => {
  const fixture = memoryFixture(`
    import type { Result } from "./result.js";
    const unused = memoryLayout<Result>(abi, 0, 1, 0);
    export function retain(value: Result): Result { return value; }
  `, undefined, { "/src/result.ts": "export interface Result {}" });
  const lowered = lowerMemoryFixture(fixture);
  assert.deepEqual(importModules(fixture.source, lowered.sourceFile), ["./result.js"]);
});

test("metadata import closure examines local nodes instead of rescanning global symbol uses", () => {
  const fixture = memoryFixture(`
    import type { Result } from "./result.js";
    const layout = memoryLayout<Result>(abi, 0, 1, 0);
    export const size = sizeOf(layout);
  `, undefined, { "/src/result.ts": "export interface Result {}" });
  const nodes: Node[] = [];
  const rewrites = new Map<Node, MemoryRewrite>();
  visit(fixture.source, fixture.sourceFile, node => {
    nodes.push(node);
    if (readTsonicMemoryLayout(fixture.source.sourceFacts, node)?.call === node) rewrites.set(node, { kind: "metadata-value" });
  });
  let queries = 0;
  const source = { ...fixture.source, navigation: {
    ...fixture.source.navigation,
    sourceReferenceFor(node: Node | undefined) {
      queries++;
      return fixture.source.navigation.sourceReferenceFor(node);
    },
    referencesWithin(): readonly Node[] { throw new Error("global symbol rescan"); },
  } };
  const removed = metadataOnlyTypeImports(source, nodes, rewrites);
  assert.equal(removed.length, 1);
  assert.equal(source.ast.text(source.ast.name(removed[0])), "Result");
  assert.ok(queries <= 2 * nodes.length);
});

test("an independently used array child retains its cross-file executable codec", () => {
  const fixture = memoryFixture(`
    import { word, values } from "./layouts.js";
    let value: uint32 = 7;
    export const raw = toRawPointer(addressOf(value), word);
    export const size = sizeOf(values);
  `, undefined, {
    "/src/layouts.ts": `
      import { abi } from "test:memory";
      import type { uint32 } from "@tsonic/core/types.js";
      import { memoryLayout, memoryArrayLayout } from "@tsonic/core/lang.js";
      export const word = memoryLayout<uint32>(abi, 4, 4, 4);
      export const values = memoryArrayLayout(abi, 8, 4, 8, word, 2);
    `,
  });
  const prepared = prepareTypeScriptLowering(fixture.source, fixture.source.navigation.sourceFiles,
    canonicalTypeScriptOptimizationProfile(), file => fixture.source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "ready", prepared.kind === "rejected" ? prepared.failures.map(failure => failure.message).join("\n") : "");
  if (prepared.kind !== "ready") return;
  let codecs = 0;
  for (const file of fixture.source.navigation.sourceFiles) {
    const lowered = prepared.transaction.lower(file);
    codecs += countCallsNamed(fixture.source, lowered.sourceFile, "uint32Layout");
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryArrayLayout"), 0);
  }
  prepared.transaction.finish();
  assert.equal(codecs, 1);
});
