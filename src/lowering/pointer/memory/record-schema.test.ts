import assert from "node:assert/strict";
import test from "node:test";
import { structFactKey, fieldFactKey } from "@tsonic/tsts";
import type { ExtensionFactKey } from "@tsonic/tsts";
import { countCallsNamed } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

const schema = `
const Shape = struct({ value: field<uint32>() });
type Shape = typeof Shape;
const word = memoryLayout<uint32>(abi, 4, 4, 4);
import { memoryField } from "@tsonic/core/lang.js";
export const layout = memoryLayout<Shape>(abi, 4, 4, 4,
  memoryField((value: Shape) => value.value, 0, 4, word));
declare const raw: RawPointer;
export const view = reinterpretRawPointer(raw, layout);
`;

for (const missing of [structFactKey, fieldFactKey]) {
  test(`record schema rejects missing finalized ${missing.id} evidence`, () => {
    const fixture = memoryFixture(schema);
    const facts = fixture.source.sourceFacts;
    const source = { ...fixture.source, sourceFacts: {
      ...facts,
      getFact<Value>(subject: Parameters<typeof facts.getFact>[0], key: ExtensionFactKey<Value>): Value | undefined {
        return Object.is(key, missing) ? undefined : facts.getFact(subject, key);
      },
    } };
    assert.throws(() => lowerMemoryFixture({ ...fixture, source }), /record schema/);
  });
}

for (const use of ["export const escaped = Shape;", "Shape.value = 7;", "export const read = Shape.value;"]) {
  test(`record schema rejects observable value use: ${use}`, () => {
    assert.throws(() => lowerMemoryFixture(memoryFixture(schema + use)), /record schema/);
  });
}

test("ordinary same-spelled struct and field functions remain ordinary calls", () => {
  const fixture = memoryFixture(`
    export function run(): number {
      function field(): number { return 3; }
      function struct(value: number): number { return value + 4; }
      return struct(field());
    }
  `);
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "struct"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "field"), 1);
});

test("an explicitly typed schema retains its value-record evidence and exported alias", () => {
  const fixture = memoryFixture(schema.replace("const Shape =", "export const Shape: {value: uint32} ="));
  const lowered = lowerMemoryFixture(fixture);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "struct"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "field"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "recordLayout"), 1);
});

for (const runtimeUse of [false, true]) {
  test(`re-exported record alias is consumed only as a type, runtime use=${runtimeUse}`, () => {
    const fixture = memoryFixture(`
      import { Shape } from "./barrel.js";
      import { memoryField } from "@tsonic/core/lang.js";
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      export const layout = memoryLayout<Shape>(abi, 4, 4, 4,
        memoryField((value: Shape) => value.value, 0, 4, word));
      declare const raw: RawPointer;
      export const view = reinterpretRawPointer(raw, layout);
      ${runtimeUse ? "export const escaped = Shape.value;" : ""}
    `, undefined, {
      "/src/record.ts": `
        import type { uint32 } from "@tsonic/core/types.js";
        import { struct, field } from "@tsonic/core/lang.js";
        export const Shape: {value: uint32} = struct({value: field<uint32>()});
        export type Shape = typeof Shape;
      `,
      "/src/barrel.ts": 'export { Shape } from "./record.js";',
    });
    if (runtimeUse) assert.throws(() => lowerMemoryFixture(fixture), /record schema/);
    else {
      const lowered = lowerMemoryFixture(fixture);
      assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "recordLayout"), 1);
    }
  });
}
