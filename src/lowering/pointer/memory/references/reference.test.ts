import assert from "node:assert/strict";
import test from "node:test";
import { lowerMemoryFixture, memoryFixture, memoryPrelude } from "../memory.test-support.js";
import { countCallsNamed, importModules } from "../../pointer.test-support.js";

test("repeated pointer layouts select one typed codec owner", () => {
  const fixture = memoryFixture(`
    const first = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
    const second = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
    const pointer = allocatePointer<uint32>(7);
    const slot = allocatePointer<Pointer<uint32> | undefined>(pointer);
    const view = reinterpretRawPointer(toRawPointer(slot, first), second);
    if (view === undefined) throw new Error("nil");
    export const same = equalPointer(loadPointer(view), pointer);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "referenceLayout"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryLayout"), 0);
});

test("different pointer domains cannot share a typed codec", () => {
  const fixture = memoryFixture(`
    export const first = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
    export const second = memoryLayout<Pointer<int32> | undefined>(abi, 8, 8, 8);
    export const third = memoryLayout<RawPointer | undefined>(abi, 8, 8, 8);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "referenceLayout"), 3);
});

test("imported independent layouts consume the shared memory identity", () => {
  const fixture = memoryFixture(`
    import { otherLayout } from "./other.js";
    const local = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
    const slot = allocatePointer<Pointer<uint32> | undefined>(allocatePointer<uint32>(3));
    export const view = reinterpretRawPointer(toRawPointer(slot, local), otherLayout);
  `, { byteOrder: "little", addressWidth: 64 }, {
    "/src/other.ts": memoryPrelude + `
      type Word = Pointer<uint32>;
      export const otherLayout = memoryLayout<Word | undefined>(abi, 8, 8, 8);
    `,
  });
  const lowered = lowerMemoryFixture(fixture);
  assert.ok(importModules(fixture.source, lowered.sourceFile).includes("./other.js"));
  assert.ok(!importModules(fixture.source, lowered.sourceFile).includes("@tsonic/core/lang.js"));
});

test("closed generic and nested pointer domains retain their shared distinctions", () => {
  const fixture = memoryFixture(`
    type Link<T> = Pointer<T> | undefined;
    export const first = memoryLayout<Link<uint32>>(abi, 8, 8, 8);
    export const same = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
    export const signed = memoryLayout<Link<int32>>(abi, 8, 8, 8);
    export const nested = memoryLayout<Pointer<Link<uint32>> | undefined>(abi, 8, 8, 8);
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "referenceLayout"), 3);
});

test("open reference domains fail at shared source selection", () => {
  assert.throws(() => memoryFixture(`
    function layout<T>() { return memoryLayout<Pointer<T> | undefined>(abi, 8, 8, 8); }
  `), /exact closed source memory type/);
});

test("local reference types are not hoisted out of their authority", () => {
  const fixture = memoryFixture(`
    function layout() { type Local = { value: number }; return memoryLayout<Pointer<Local> | undefined>(abi, 8, 8, 8); }
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /local declaration/);
});

test("a nullable record containing a pointer is not itself a pointer word", () => {
  const fixture = memoryFixture(`
    type Container = { pointer: Pointer<uint32> };
    export const layout = memoryLayout<Container | undefined>(abi, 8, 8, 8);
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /memory layout/);
});

test("null cannot silently become the undefined nil representation", () => {
  const fixture = memoryFixture(`
    export const layout = memoryLayout<Pointer<uint32> | null>(abi, 8, 8, 8);
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /closed nullable pointer domain/);
});
