import assert from "node:assert/strict";
import test from "node:test";
import { countCallsNamed } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

for (const optimize of [false, true]) {
  test(`boolean and floating layouts consume exact domains, optimize=${optimize}`, () => {
    const fixture = memoryFixture(`
      import type { float32, float64 } from "@tsonic/core/types.js";
      type Flag = boolean;
      type Small = float32;
      type Large = float64;
      export const flag = memoryLayout<Flag>(abi, 1, 1, 1);
      export const small = memoryLayout<Small>(abi, 4, 4, 4);
      export const large = memoryLayout<Large>(abi, 8, 4, 8);
    `);
    const lowered = lowerMemoryFixture(fixture, optimize);
    for (const name of ["booleanLayout", "float32Layout", "float64Layout"]) {
      assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, name), 1);
    }
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "memoryLayout"), 0);
  });
}

for (const [name, declaration] of [
  ["boolean width", "memoryLayout<boolean>(abi, 4, 4, 4)"],
  ["float width", "memoryLayout<float32>(abi, 8, 8, 8)"],
  ["ordinary number", "memoryLayout<number>(abi, 8, 8, 8)"],
  ["same-spelled ordinary alias", "memoryLayout<Ordinary>(abi, 8, 8, 8)"],
]) {
  test(`scalar storage rejects ${name}`, () => {
    const fixture = memoryFixture(`
      import type { float32 } from "@tsonic/core/types.js";
      type Ordinary = number;
      export const layout = ${declaration};
    `);
    assert.throws(() => lowerMemoryFixture(fixture), /memory layout/);
  });
}
