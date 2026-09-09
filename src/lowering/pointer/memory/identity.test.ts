import assert from "node:assert/strict";
import test from "node:test";
import type { TsonicDataLayoutFact } from "@tsonic/source-core/facts";
import { memoryABIKey } from "./identity.js";

const abi: TsonicDataLayoutFact = {
  providerDeclaration: { providerId: "memory", providerVersion: "1", providerModuleId: "memory-abi", moduleSpecifier: "test:abi", exportId: "abi" },
  fingerprint: "abi64", addressWidth: 64, byteOrder: "little",
};

test("codec ABI reuse retains every provider identity and dimension", () => {
  const expected = memoryABIKey(abi);
  assert.equal(memoryABIKey({ ...abi, providerDeclaration: { ...abi.providerDeclaration } }), expected);
  for (const member of ["providerId", "providerVersion", "providerModuleId", "moduleSpecifier", "exportId"] as const) {
    assert.notEqual(memoryABIKey({ ...abi, providerDeclaration: { ...abi.providerDeclaration, [member]: "different" } }), expected);
  }
  assert.notEqual(memoryABIKey({ ...abi, fingerprint: "different" }), expected);
  assert.notEqual(memoryABIKey({ ...abi, addressWidth: 32 }), expected);
  assert.notEqual(memoryABIKey({ ...abi, byteOrder: "big" }), expected);
});
