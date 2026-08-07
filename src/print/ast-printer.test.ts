import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodePrinterResponse,
  encodePrinterRequest,
} from "./ast-printer.js";

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

function framedResponse(files: readonly string[]): Buffer {
  const count = Buffer.allocUnsafe(4);
  count.writeUInt32LE(files.length, 0);
  const frames = files.flatMap((file) => {
    const payload = Buffer.from(file, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32LE(payload.length, 0);
    return [length, payload];
  });
  return Buffer.concat([Buffer.from("TSTSPR02", "ascii"), count, ...frames]);
}
