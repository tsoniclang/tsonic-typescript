import assert from "node:assert/strict";
import test from "node:test";
import { tsonicPointerViewFactKey, tsonicMemoryFieldBindingFactKey, tsonicMemoryRecordBindingFactKey } from "@tsonic/source-core/facts";
import type { ExtensionFactKey } from "@tsonic/tsts";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { memoryFixture } from "./memory.test-support.js";

for (const hidden of [tsonicPointerViewFactKey, tsonicMemoryFieldBindingFactKey, tsonicMemoryRecordBindingFactKey]) {
  test(`a missing exact relationship fact rejects: ${hidden.name}`, () => {
    const fixture = memoryFixture(`
      import { viewPointer, memoryField, bindMemoryField, bindMemoryRecord } from "@tsonic/core/lang.js";
      const Record = struct({ value: field<uint32>() });
      type Record = typeof Record;
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      const member = memoryField((record: Record) => record.value, 0, 4, word);
      const layout = memoryLayout<Record>(abi, 4, 4, 4, member);
      let stored: uint32 = 7;
      const pointer = viewPointer<uint32, uint32>(addressOf(stored), (): uint32 => stored, (value: uint32) => { stored = value; });
      export const record = bindMemoryRecord(layout, bindMemoryField(member, pointer));
    `);
    const facts = fixture.source.sourceFacts;
    const source = { ...fixture.source, sourceFacts: { ...facts,
      getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: ExtensionFactKey<T>): T | undefined {
        return Object.is(key, hidden) ? undefined : facts.getFact(subject, key);
      },
    } };
    const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
      file => source.documents.forFile(file).identity);
    assert.equal(prepared.kind, "rejected");
  });
}
