import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  TypeScriptAstPrinter,
  TypeScriptPrinterBatch,
} from "../print/ast-printer.js";
import type { PrinterProtocolLimits } from "../print/protocol-budget.js";
import {
  printEncodedTypeScriptSources,
  type EncodedTypeScriptSource,
} from "./source-artifact-batches.js";

const limits: PrinterProtocolLimits = Object.freeze({
  maximumFileCount: 2,
  maximumFrameBytes: 3,
  maximumPayloadBytes: 26,
});

test("prints multiple immutable bounded batches with exact artifact association", () => {
  const observed: number[][][] = [];
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      assertSealedBatch(batch);
      const encoded = batch.encodedSourceFiles.map((file) => [...file]);
      observed.push(encoded);
      const batchIndex = observed.length - 1;
      return encoded.map((file, fileIndex) =>
        `// batch ${batchIndex} file ${fileIndex} byte ${String(file[0])}\n`);
    },
  };

  const artifacts = printEncodedTypeScriptSources(
    encodedSources(1, 2, 3, 4, 5),
    printer,
    limits,
  );

  assert.deepEqual(observed, [
    [[1, 1, 1], [2, 2, 2]],
    [[3, 3, 3], [4, 4, 4]],
    [[5, 5, 5]],
  ]);
  assert.deepEqual(
    artifacts.map(({ path, text }) => ({ path, text })),
    [
      { path: "1.ts", text: "// batch 0 file 0 byte 1\n" },
      { path: "2.ts", text: "// batch 0 file 1 byte 2\n" },
      { path: "3.ts", text: "// batch 1 file 0 byte 3\n" },
      { path: "4.ts", text: "// batch 1 file 1 byte 4\n" },
      { path: "5.ts", text: "// batch 2 file 0 byte 5\n" },
    ],
  );
  assert.equal(Object.isFrozen(artifacts), true);
  assert.ok(artifacts.every(Object.isFrozen));
});

test("fails the complete print operation on a later batch count mismatch", () => {
  let batchIndex = 0;
  const printer: TypeScriptAstPrinter = {
    print(batch) {
      batchIndex += 1;
      return batchIndex === 1
        ? batch.encodedSourceFiles.map(() => "// printed\n")
        : [];
    },
  };

  assert.throws(
    () => printEncodedTypeScriptSources(encodedSources(1, 2, 3), printer, limits),
    /returned 0 files, expected 1/u,
  );
  assert.equal(batchIndex, 2);
});

test("rejects one oversized frame before invoking the printer", () => {
  let printCalls = 0;
  const printer: TypeScriptAstPrinter = {
    print() {
      printCalls += 1;
      return [];
    },
  };
  const oversized = [{
    path: "oversized.ts",
    encoded: Uint8Array.from([1, 2, 3, 4]),
  }];

  assert.throws(
    () => printEncodedTypeScriptSources(oversized, printer, limits),
    /frame 0 size 4 exceeds limit 3/u,
  );
  assert.equal(printCalls, 0);
});

function encodedSources(...values: readonly number[]): readonly EncodedTypeScriptSource[] {
  return values.map((value) => Object.freeze({
    path: `${String(value)}.ts`,
    encoded: Uint8Array.from([value, value, value]),
  }));
}

function assertSealedBatch(batch: TypeScriptPrinterBatch): void {
  assert.equal(Object.isFrozen(batch), true);
  assert.equal(Object.isFrozen(batch.encodedSourceFiles), true);
  assert.equal("append" in batch, false);
  assert.equal("tryAppend" in batch, false);
}
