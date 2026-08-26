import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodePrinterResponse,
  encodePrinterRequest,
  TypeScriptPrinterBatchBuilder,
} from "./ast-printer.js";
import { printerProtocolLimits } from "./protocol-budget.js";

test("printer framing preserves exact binary inputs and UTF-8 outputs", () => {
  const request = Buffer.from(encodePrinterRequest([
    Uint8Array.from([0, 1, 2]),
    Uint8Array.from([3, 4]),
  ]));
  assert.equal(request.subarray(0, 8).toString("ascii"), "TSTSPR01");
  assert.equal(request.readUInt32LE(8), 2);
  assert.equal(request.readUInt32LE(12), 3);
  assert.deepEqual([...request.subarray(16, 19)], [0, 1, 2]);

  const response = framedResponse(["const first = 1;\n", "const second = '😀';\n"]);
  assert.deepEqual(decodePrinterResponse(response, 2), [
    "const first = 1;\n",
    "const second = '😀';\n",
  ]);
});

test("printer batches seal one immutable membership snapshot", () => {
  const builder = new TypeScriptPrinterBatchBuilder({
    maximumFileCount: 2,
    maximumFrameBytes: 3,
    maximumPayloadBytes: 26,
  });
  const encoded = Uint8Array.from([1, 2, 3]);
  builder.append(encoded);

  const batch = builder.seal();

  assert.equal(Object.isFrozen(batch), true);
  assert.equal(Object.isFrozen(batch.encodedSourceFiles), true);
  assert.deepEqual(batch.encodedSourceFiles, [encoded]);
  assert.equal(builder.seal(), batch);
  assert.throws(
    () => builder.append(Uint8Array.from([4])),
    /batch is already sealed/u,
  );
});

test("printer response fails closed on count and trailing-byte mutations", () => {
  const response = framedResponse(["export {};\n"]);
  assert.throws(
    () => decodePrinterResponse(response, 2),
    /returned 1 files, expected 2/,
  );
  assert.throws(
    () => decodePrinterResponse(Buffer.concat([response, Buffer.from([1])]), 1),
    /trailing bytes/,
  );
});

test("printer response rejects malformed framing and invalid UTF-8", () => {
  const valid = framedResponse(["x"]);
  const invalidMagic = Buffer.from(valid);
  invalidMagic[0] = 0;
  const invalidUtf8 = framedBinaryResponse([Buffer.from([0xc3, 0x28])]);
  const oversizedFrame = Buffer.from(framedResponse([""]));
  oversizedFrame.writeUInt32LE(
    printerProtocolLimits.maximumFrameBytes + 1,
    12,
  );

  const cases: readonly [Uint8Array, RegExp][] = [
    [invalidMagic, /invalid magic/u],
    [valid.subarray(0, 7), /header is truncated/u],
    [valid.subarray(0, 10), /file count is truncated/u],
    [valid.subarray(0, 14), /frame 0 length is truncated/u],
    [valid.subarray(0, 16), /frame 0 is truncated/u],
    [invalidUtf8, /frame 0 is not valid UTF-8/u],
    [oversizedFrame, /frame 0 size .* exceeds limit/u],
  ];
  for (const [response, expected] of cases) {
    assert.throws(() => decodePrinterResponse(response, 1), expected);
  }
});

function framedResponse(files: readonly string[]): Buffer {
  return framedBinaryResponse(files.map((file) => Buffer.from(file, "utf8")));
}

function framedBinaryResponse(files: readonly Buffer[]): Buffer {
  const count = Buffer.allocUnsafe(4);
  count.writeUInt32LE(files.length, 0);
  const frames = files.flatMap((payload) => {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32LE(payload.length, 0);
    return [length, payload];
  });
  return Buffer.concat([Buffer.from("TSTSPR02", "ascii"), count, ...frames]);
}
