import assert from "node:assert/strict";
import test from "node:test";
import { countCallsNamed } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

for (const optimize of [false, true]) {
  test(`pointer views lower through finalized relationships, optimized=${optimize}`, () => {
    const fixture = memoryFixture(`
      import { viewPointer } from "@tsonic/core/lang.js";
      let storage = 7;
      const base = addressOf(storage);
      const view = viewPointer(base, () => 0, (_value: number) => {});
      export const result = [loadPointer(view), equalPointer(base, view)];
    `);
    const lowered = lowerMemoryFixture(fixture, optimize);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "viewPointer"), 0);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "viewLocation"), 1);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "sameLocation"), 1);
  });

  test(`field bindings lower without byte codecs, optimized=${optimize}`, () => {
    const fixture = memoryFixture(`
      import { bindMemoryField, bindMemoryRecord, memoryField } from "@tsonic/core/lang.js";
      import type { MemoryFieldBinding } from "@tsonic/core/types.js";
      const Pair = struct({ first: field<uint32>(), second: field<uint32>() });
      type Pair = typeof Pair;
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      const first = memoryField((value: Pair) => value.first, 0, 4, word);
      const second = memoryField((value: Pair) => value.second, 4, 4, word);
      const layout = memoryLayout<Pair>(abi, 8, 4, 8, first, second);
      const pointer = allocatePointer<uint32>(7);
      const firstBinding: MemoryFieldBinding<Pair> = bindMemoryField(first, pointer);
      const record = bindMemoryRecord(layout, bindMemoryField(second, allocatePointer<uint32>(9)), firstBinding);
      export const result = equalPointer(addressOf(record.first), pointer);
    `);
    const lowered = lowerMemoryFixture(fixture, optimize);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "bindMemoryField"), 0);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "bindMemoryRecord"), 1);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "recordLayout"), 0);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "uint32Layout"), 0);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "boundFieldIdentity"), 2);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "sameLocation"), 1);
  });
}

test("same-spelled ordinary pointer views remain ordinary calls", () => {
  const fixture = memoryFixture(`
    function viewPointer(value: number): number { return value; }
    export const result = viewPointer(7);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "viewPointer"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "viewLocation"), 0);
});

test("field bindings use an imported exact layout and its declaration identities", () => {
  const fixture = memoryFixture(`
    import { layout, member } from "./layout.js";
    import { bindMemoryField, bindMemoryRecord } from "@tsonic/core/lang.js";
    const pointer = allocatePointer<uint32>(9);
    const record = bindMemoryRecord(layout, bindMemoryField(member, pointer));
    export const result = equalPointer(addressOf(record.value), pointer);
  `, undefined, {
    "/src/layout.ts": `
      import { abi } from "test:memory";
      import type { uint32 } from "@tsonic/core/types.js";
      import { memoryLayout, memoryField, struct, field } from "@tsonic/core/lang.js";
      const Record = struct({ value: field<uint32>() });
      type Record = typeof Record;
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      export const member = memoryField((record: Record) => record.value, 0, 4, word);
      export const layout = memoryLayout<Record>(abi, 4, 4, 4, member);
    `,
  });
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "boundFieldIdentity"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "recordLayout"), 0);
});

test("an empty record binding does not demand an allocation or byte codec", () => {
  const fixture = memoryFixture(`
    import { bindMemoryRecord } from "@tsonic/core/lang.js";
    type Empty = {};
    const layout = memoryLayout<Empty>(abi, 0, 1, 0);
    export const result = bindMemoryRecord(layout);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "bindMemoryRecord"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "identityLayout"), 0);
});

test("an inline record layout is metadata only at its exact binding operand", () => {
  const fixture = memoryFixture(`
    import { bindMemoryRecord } from "@tsonic/core/lang.js";
    type Empty = {};
    export const result = bindMemoryRecord((memoryLayout<Empty>(abi, 0, 1, 0)));
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "bindMemoryRecord"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryLayout"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "identityLayout"), 0);
});
