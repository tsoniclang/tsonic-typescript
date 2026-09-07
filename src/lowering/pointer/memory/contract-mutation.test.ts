import assert from "node:assert/strict";
import test from "node:test";
import { tsonicDataLayoutFactKey, tsonicMemoryLayoutFactKey } from "@tsonic/source-core/facts";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { memoryFixture } from "./memory.test-support.js";

for (const missing of ["address ABI", "raw location layout", "query layout"] as const) {
  test(`missing ${missing} fails at finalized evidence consumption`, () => {
    const input = missing === "address ABI"
      ? `declare const raw: RawPointer; export const result = rawPointerToAddressInteger<uint64>(raw, abi);`
      : missing === "raw location layout"
        ? `const word = memoryLayout<uint32>(abi, 4, 4, 4); declare const raw: RawPointer; export const result = reinterpretRawPointer(raw, word);`
        : `const word = memoryLayout<uint32>(abi, 4, 4, 4); export const result = sizeOf(word);`;
    const fixture = memoryFixture(input);
    const facts = fixture.source.sourceFacts;
    const hidden = missing === "address ABI" ? tsonicDataLayoutFactKey : tsonicMemoryLayoutFactKey;
    const source = { ...fixture.source, sourceFacts: {
      ...facts,
      getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
        if (Object.is(key, hidden)) return undefined;
        return facts.getFact(subject, key);
      },
    } };
    const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
      file => source.documents.forFile(file).identity);
    assert.equal(prepared.kind, "rejected");
    if (prepared.kind === "rejected") {
      assert.ok(prepared.failures.length > 0);
      assert.match(prepared.failures[0]?.message ?? "", /shared fact|finalized|selected ABI/);
      if (missing === "address ABI") assert.doesNotMatch(prepared.failures[0]?.message ?? "", /physical native address/);
    }
  });
}
