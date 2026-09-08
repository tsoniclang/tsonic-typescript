import assert from "node:assert/strict";
import test from "node:test";
import { selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { countCallsNamed, visit } from "../pointer.test-support.js";
import { lowerMemoryFixture, memoryFixture } from "./memory.test-support.js";

const cases = [
  {
    name: "complete scalar record",
    size: 8,
    offsets: [0, 4],
    childSizes: [4, 4],
    executable: true,
    source: `
      import { memoryField } from "@tsonic/core/lang.js";
      const Pair = struct({ First: field<uint32>(), Second: field<uint32>() });
      type Pair = typeof Pair;
      const word = memoryLayout<uint32>(abi, 4, 4, 4);
      const layout = memoryLayout<Pair>(abi, 8, 4, 8,
        memoryField((pair: Pair) => pair.First, 0, 4, word),
        memoryField((pair: Pair) => pair.Second, 4, 4, word));
      const pair = allocatePointer<Pair>({ First: 1, Second: 2 });
      export const raw = toRawPointer(pair, layout);
    `,
  },
  {
    name: "complete pointer-bearing record",
    size: 8,
    offsets: [0],
    childSizes: [8],
    executable: false,
    source: `
      import { memoryField } from "@tsonic/core/lang.js";
      const Header = struct({ data: field<Pointer<uint32> | undefined>() });
      type Header = typeof Header;
      const address = memoryLayout<Pointer<uint32> | undefined>(abi, 8, 8, 8);
      const layout = memoryLayout<Header>(abi, 8, 8, 8,
        memoryField((header: Header) => header.data, 0, 8, address));
      const header = allocatePointer<Header>({ data: allocatePointer<uint32>(7) });
      export const raw = toRawPointer(header, layout);
    `,
  },
];

for (const selectedCase of cases) {
  test(`${selectedCase.name} consumes complete shared evidence at its representation owner`, () => {
    const fixture = memoryFixture(selectedCase.source);
    const source = fixture.source;
    let conversions = 0;
    visit(source, fixture.sourceFile, node => {
      if (!source.ast.is.IsCallExpression(node)) return;
      const selected = selectTsonicRawLocationOperation(source.ast, source.sourceFacts, node);
      if (selected === undefined) return;
      assert.equal(selected.kind, "resolved");
      if (selected.kind !== "resolved") return;
      conversions++;
      assert.equal(selected.operation.operation, "to-raw");
      assert.equal(selected.layout.byteSize, selectedCase.size);
      assert.deepEqual(selected.layout.fields.map(field => field.byteOffset), selectedCase.offsets);
      assert.deepEqual(selected.layout.fields.map(field => field.fieldLayout.byteSize), selectedCase.childSizes);
      assert.equal(source.semantics.forNode(node).types.isIdentical(
        selected.layout.sourceType, selected.operation.pointeeType,
      ), true);
    });
    assert.equal(conversions, 1);
    if (selectedCase.executable) {
      const lowered = lowerMemoryFixture(fixture);
      assert.equal(countCallsNamed(source, lowered.sourceFile, "recordLayout"), 1);
      assert.equal(countCallsNamed(source, lowered.sourceFile, "recordField"), 2);
      assert.equal(countCallsNamed(source, lowered.sourceFile, "memoryField"), 0);
      return;
    }
    const result = prepareTypeScriptLowering(source, source.navigation.sourceFiles,
      canonicalTypeScriptOptimizationProfile(), file => source.documents.forFile(file).identity);
    assert.equal(result.kind, "rejected");
    if (result.kind !== "rejected") return;
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]?.message ?? "", /memory layout.*(?:scalar|integer)/u);
  });
}
