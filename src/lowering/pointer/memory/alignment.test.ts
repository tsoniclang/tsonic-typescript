import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@tsonic/tsts";
import { visit } from "../pointer.test-support.js";
import { memoryFixture, lowerMemoryFixture } from "./memory.test-support.js";

for (const byteOrder of ["little", "big"] as const) {
  for (const addressWidth of [32, 64] as const) {
    test(`scalar lowering transports ${byteOrder}/${addressWidth} alignment independently of width`, () => {
      const alignment = addressWidth === 32 ? 4 : 8;
      const fixture = memoryFixture(`
        const layout = memoryLayout<uint64>(abi, 8, ${alignment}, 8);
        let value: uint64 = 1n;
        export const pointer = toRawPointer(addressOf(value), layout);
      `, { byteOrder, addressWidth });
      const lowered = lowerMemoryFixture(fixture);
      const calls: Node[] = [];
      visit(fixture.source, lowered.sourceFile, (node) => {
        const call = fixture.source.ast.as.AsCallExpression(node);
        const access = call?.Expression === undefined ? undefined : fixture.source.ast.as.AsPropertyAccessExpression(call.Expression);
        if (access?.name !== undefined && fixture.source.ast.text(access.name) === "uint64Layout") calls.push(node);
      });
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call);
      assert.deepEqual(fixture.source.ast.arguments(call).map(argument => fixture.source.ast.text(argument)),
        [byteOrder, String(alignment), "8"]);
    });
  }
}

test("selected stride and over-alignment do not become scalar width", () => {
  const fixture = memoryFixture("export const layout = memoryLayout<uint32>(abi, 4, 8, 16);");
  const lowered = lowerMemoryFixture(fixture);
  const dimensions: string[][] = [];
  visit(fixture.source, lowered.sourceFile, (node) => {
    const call = fixture.source.ast.as.AsCallExpression(node);
    const access = call?.Expression === undefined ? undefined : fixture.source.ast.as.AsPropertyAccessExpression(call.Expression);
    if (access?.name !== undefined && fixture.source.ast.text(access.name) === "uint32Layout") {
      dimensions.push(fixture.source.ast.arguments(node).map(argument => fixture.source.ast.text(argument)));
    }
  });
  assert.deepEqual(dimensions, [["little", "8", "16"]]);
});
