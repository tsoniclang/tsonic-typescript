import assert from "node:assert/strict";
import test from "node:test";
import { countCallsNamed } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

const body = `
  const word = memoryLayout<uint32>(abi, 4, 4, 4);
  const byte = memoryLayout<uint8>(abi, 1, 1, 1);
  export function run(): (number | boolean)[] {
    const values: uint32[] = [1, 2];
    const alias = values;
    const second = addressOf(alias[1]);
    const first = addressOf(values[0]);
    const raw = toRawPointer(first, word);
    const advanced = offsetRawPointer(raw, 4, abi);
    const view = reinterpretRawPointer(advanced, word);
    if (view !== undefined) storePointer(view, 7);
    const edit = reinterpretRawPointer(offsetRawPointer(raw, 1, abi), byte);
    if (edit !== undefined) storePointer(edit, 3);
    return [values[0], alias[1], equalPointer(view, second), equalRawPointer(advanced, toRawPointer(second, word))];
  }
`;

for (const optimize of [false, true]) {
  test(`all addresses of one closed allocation retain its memory, optimize=${optimize}`, () => {
    const fixture = memoryFixture(body);
    const lowered = lowerMemoryFixture(fixture, optimize);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "arrayElementLocation"), 2);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "propertyLocation"), 0);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "nestedPropertyLocation"), 0);
  });
}

for (const [name, edit, expected] of [
  ["escape", "consume(values);", /escape/],
  ["resize", "values.push(3);", /resize|property operation/],
  ["sparse write", "values[9] = 3;", /in-bounds/],
  ["unproved index write", "values[index] = 3;", /in-bounds/],
] as const) {
  test(`unproved ${name} rejects before printing`, () => {
    const fixture = memoryFixture(`
      declare function consume(values: uint32[]): void;
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      export function run(index: number): void {
        const values: uint32[] = [1, 2];
        const raw = toRawPointer(addressOf(values[0]), word);
        ${edit}
        keepAlive(raw);
      }
    `);
    assert.throws(() => lowerMemoryFixture(fixture), expected);
  });
}

test("array variable replacement is not mistaken for fixed allocation storage", () => {
  const fixture = memoryFixture(`
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    export function run(): void {
      let values: uint32[] = [1, 2];
      const raw = toRawPointer(addressOf(values[0]), word);
      values = [3, 4];
      keepAlive(raw);
    }
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /non-reassigned/);
});

test("conflicting array element domains reject at shared source selection", () => {
  assert.throws(() => memoryFixture(`
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const signed = memoryLayout<int32>(abi, 4, 4, 4);
    export function run(): void {
      const values: uint32[] = [1, 2];
      const first = toRawPointer(addressOf(values[0]), word);
      const second = toRawPointer(addressOf(values[1]), signed);
      keepAlive(first); keepAlive(second);
    }
  `), /same exact closed memory type and marker domain/);
});

test("conflicting array element dimensions reject rather than depend on conversion order", () => {
  const fixture = memoryFixture(`
    const word = memoryLayout<uint32>(abi, 4, 4, 4);
    const padded = memoryLayout<uint32>(abi, 4, 4, 8);
    export function run(): void {
      const values: uint32[] = [1, 2];
      const first = toRawPointer(addressOf(values[0]), word);
      const second = toRawPointer(addressOf(values[1]), padded);
      keepAlive(first); keepAlive(second);
    }
  `);
  assert.throws(() => lowerMemoryFixture(fixture), /conflicting/);
});
