import assert from "node:assert/strict";
import test from "node:test";
import { countCallsNamed } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

test("nested record layouts consume each child once and preserve alias-safe views", () => {
  const fixture = memoryFixture(`
    import { memoryField } from "@tsonic/core/lang.js";
    const Inner = struct({ value: field<uint32>() });
    type Inner = typeof Inner;
    const Outer = struct({ inner: field<Inner>(), tail: field<uint32>() });
    type Outer = typeof Outer;
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const inner = memoryLayout<Inner>(abi, 4, 4, 4,
      memoryField((value: Inner) => value.value, 0, 4, word));
    const outer = memoryLayout<Outer>(abi, 8, 4, 8,
      memoryField((value: Outer) => value.inner, 0, 4, inner),
      memoryField((value: Outer) => value.tail, 4, 4, word));
    export const raw = toRawPointer(allocatePointer<Outer>({inner: {value: 1}, tail: 2}), outer);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "recordLayout"), 2);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "recordField"), 3);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryField"), 0);
});

for (const selected of [
  { name: "omitted member", definition: "const Pair = struct({first: field<uint32>(), second: field<uint32>()}); type Pair = typeof Pair;", expected: /complete finite/ },
  { name: "index signature", definition: "const Shape = struct({first: field<uint32>()}); type Pair = typeof Shape & {[key: string]: uint32};", expected: /complete finite/ },
  { name: "unproven reference record", definition: "type Pair = {first: uint32};", expected: /value-record evidence/ },
]) {
  test(`record ${selected.name} fails before printing`, () => {
    const fixture = memoryFixture(`
      import { memoryField } from "@tsonic/core/lang.js";
      ${selected.definition}
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      export const layout = memoryLayout<Pair>(abi, 4, 4, 4,
        memoryField((value: Pair) => value.first, 0, 4, word));
      declare const pointer: Pointer<Pair>;
      export const raw = toRawPointer(pointer, layout);
    `);
    assert.throws(() => lowerMemoryFixture(fixture), selected.expected);
  });
}

test("readonly record fields reject at shared physical-field selection", () => {
  assert.throws(() => memoryFixture(`
    import { memoryField } from "@tsonic/core/lang.js";
    const Shape = struct({first: field<uint32>()});
    type Pair = Readonly<typeof Shape>;
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    export const layout = memoryLayout<Pair>(abi, 4, 4, 4,
      memoryField((value: Pair) => value.first, 0, 4, word));
  `), /memoryField requires one selected non-optional physical field/);
});
