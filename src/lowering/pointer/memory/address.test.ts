import assert from "node:assert/strict";
import test from "node:test";
import { readTsonicRawMemoryOperation } from "@tsonic/source-core/facts";
import { visit } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

for (const addressWidth of [32, 64] as const) {
  test(`exact ABI${addressWidth} address facts reach the explicit physical-address boundary`, () => {
    const domain = addressWidth === 32 ? "uint32" : "uint64";
    const value = addressWidth === 32 ? "4294967295" : "9007199254740993n";
    const fixture = memoryFixture(`
      const original: ${domain} = ${value};
      const raw = addressIntegerToRawPointer(original, abi);
      export const result = rawPointerToAddressInteger<${domain}>(raw, abi);
    `, { byteOrder: "little", addressWidth });
    let conversions = 0;
    visit(fixture.source, fixture.sourceFile, node => {
      const fact = readTsonicRawMemoryOperation(fixture.source.sourceFacts, node);
      if (fact?.operation !== "raw-to-address-integer" && fact?.operation !== "address-integer-to-raw") return;
      assert.equal(fact.call, node);
      assert.equal(fact.addressWidth, addressWidth);
      assert.equal(fact.addressRuntimeBase, addressWidth === 32 ? "number" : "bigint");
      assert.equal(fact.addressSignedness, "unsigned");
      conversions++;
    });
    assert.equal(conversions, 2);
    assert.throws(() => lowerMemoryFixture(fixture), /physical native address/);
  });
}
