import assert from "node:assert/strict";
import test from "node:test";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { countCallsNamed, importModules, visit } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

test("ordinary nested fixed arrays retain their storage without a raw codec", () => {
  const fixture = memoryFixture(`
    import type { FixedArray as Inline, uint32 } from "@tsonic/core/types.js";
    const row: [uint32, uint32] = [1, 2];
    const rows: [Inline<uint32, 2>] = [row];
    export const matrix: Inline<Inline<uint32, 2>, 1> = rows;
    export function update() { matrix[0]![1] = 9; return matrix[0]![1]; }
  `, undefined, {}, "");
  const lowered = lowerMemoryFixture(fixture);
  assert.ok(importModules(fixture.source, lowered.sourceFile).includes("@tsonic/typescript-runtime"));
  assert.ok(!importModules(fixture.source, lowered.sourceFile).includes("@tsonic/core/types.js"));
  let storageTypes = 0;
  visit(fixture.source, lowered.sourceFile, node => {
    if (fixture.source.ast.is.IsTypeReferenceNode(node) &&
        fixture.source.ast.as.AsTypeReferenceNode(node)?.TypeArguments?.Nodes.length === 2) storageTypes++;
  });
  assert.equal(storageTypes, 3);
});

test("ordinary aliases retain their authored name after the canonical definition is lowered", () => {
  const fixture = memoryFixture(`
    import type { FixedArray, uint32 } from "@tsonic/core/types.js";
    export type Pair = FixedArray<uint32, 2>;
    export function first(pair: Pair) { return pair[0]; }
  `, undefined, {}, "");
  const lowered = lowerMemoryFixture(fixture);
  let pairUses = 0;
  visit(fixture.source, lowered.sourceFile, node => {
    if (!fixture.source.ast.is.IsTypeReferenceNode(node)) return;
    const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
    if (reference?.TypeName !== undefined && fixture.source.ast.is.IsIdentifier(reference.TypeName) &&
        fixture.source.ast.text(reference.TypeName) === "Pair") pairUses++;
  });
  assert.equal(pairUses, 1);
});

test("a fixed-array record field lowers as types without executable memory work", () => {
  const fixture = memoryFixture(`
    import { struct, field } from "@tsonic/core/lang.js";
    import type { FixedArray, uint32 } from "@tsonic/core/types.js";
    const Packet = struct({ Values: field<FixedArray<uint32, 2>>() });
    type Packet = typeof Packet;
    export function first(packet: Packet) { return packet.Values[0]; }
  `, undefined, {}, "");
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "struct"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "field"), 0);
  assert.ok(!importModules(fixture.source, lowered.sourceFile).includes("@tsonic/core/lang.js"));
  assert.ok(importModules(fixture.source, lowered.sourceFile).includes("@tsonic/typescript-runtime"));
});

test("an exact huge extent is type-only and is never rounded to a number", () => {
  const fixture = memoryFixture(`
    import type { FixedArray } from "@tsonic/core/types.js";
    interface Empty {}
    export function retain(values: FixedArray<Empty, 9007199254740993n>) { return values; }
  `, undefined, {}, "");
  const lowered = lowerMemoryFixture(fixture);
  const extents: string[] = [];
  visit(fixture.source, lowered.sourceFile, node => {
    if (fixture.source.ast.is.IsBigIntLiteral(node)) extents.push(fixture.source.ast.text(node));
  });
  assert.deepEqual(extents, ["9007199254740993n"]);
});

test("contradictory paired extent facts reject before publication", () => {
  const fixture = memoryFixture(`
    import type { FixedArray, uint32 } from "@tsonic/core/types.js";
    export function first(values: FixedArray<uint32, 2>) { return values[0]; }
  `, undefined, {}, "");
  const facts = fixture.source.sourceFacts;
  const names = new Set<import("@tsonic/tsts").ExtensionFactSubject>();
  visit(fixture.source, fixture.sourceFile, node => {
    if (fixture.source.ast.is.IsIdentifier(node) && facts.getFact(node, tsonicFixedArrayFactKey) !== undefined) names.add(node);
  });
  assert.equal(names.size, 1);
  const source = { ...fixture.source, sourceFacts: {
    ...facts,
    getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
      if (Object.is(key, tsonicFixedArrayFactKey) && subject !== undefined && names.has(subject)) {
        const fact = facts.getFact(subject, tsonicFixedArrayFactKey);
        if (fact !== undefined) return { ...fact, length: fact.length + 1n } as T;
      }
      return facts.getFact(subject, key);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
});

test("native-only huge fixed-array allocation is rejected instead of adding a JavaScript emulator", () => {
  const fixture = memoryFixture(`
    import { defaultValue } from "@tsonic/core/lang.js";
    import type { FixedArray } from "@tsonic/core/types.js";
    interface Empty {}
    export const values = defaultValue<FixedArray<Empty, 9007199254740993n>>();
  `, undefined, {}, "");
  assert.throws(() => lowerMemoryFixture(fixture), /fixed-array default allocation/);
});

test("an alias cannot hide an unsupported fixed-array allocation", () => {
  const fixture = memoryFixture(`
    import { defaultValue as zero } from "@tsonic/core/lang.js";
    import type { EmptyArray } from "./array.js";
    export const values = zero<EmptyArray>();
  `, undefined, {
    "/src/array.ts": `
      import type { FixedArray } from "@tsonic/core/types.js";
      interface Empty {}
      export type EmptyArray = FixedArray<Empty, 9007199254740993n>;
    `,
  }, "");
  assert.throws(() => lowerMemoryFixture(fixture), /fixed-array default allocation/);
});

test("missing fixed-array fact cannot be recovered from its provider spelling", () => {
  const fixture = memoryFixture(`
    import type { FixedArray } from "@tsonic/core/types.js";
    export function first(values: FixedArray<uint32, 2>) { return values[0]; }
  `);
  const facts = fixture.source.sourceFacts;
  const source = { ...fixture.source, sourceFacts: {
    ...facts,
    getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
      return Object.is(key, tsonicFixedArrayFactKey) ? undefined : facts.getFact(subject, key);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
});

test("a same-spelled local array contract stays ordinary source", () => {
  const fixture = memoryFixture(`
    interface FixedArray<Element, Length> { value: Element; length: Length }
    export function value(input: FixedArray<number, 2>) { return input.value; }
  `, undefined, {}, "");
  const lowered = lowerMemoryFixture(fixture);
  assert.deepEqual(importModules(fixture.source, lowered.sourceFile), []);
});
