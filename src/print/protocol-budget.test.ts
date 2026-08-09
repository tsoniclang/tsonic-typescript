import assert from "node:assert/strict";
import { test } from "node:test";

import {
  framedPayloadLength,
  type PrinterProtocolLimits,
} from "./protocol-budget.js";

const limits: PrinterProtocolLimits = Object.freeze({
  maximumFileCount: 2,
  maximumFrameBytes: 3,
  maximumPayloadBytes: 18,
});

test("printer protocol budget accepts the exact aggregate boundary", () => {
  assert.equal(framedPayloadLength([1, 1], 4, limits, "test"), 18);
});

test("printer protocol budget rejects count, frame, aggregate, and arithmetic excess", () => {
  assert.throws(
    () => framedPayloadLength([0, 0, 0], 4, limits, "test"),
    /file count 3 exceeds limit 2/u,
  );
  assert.throws(
    () => framedPayloadLength([4], 4, limits, "test"),
    /frame 0 size 4 exceeds limit 3/u,
  );
  assert.throws(
    () => framedPayloadLength([3, 3], 4, limits, "test"),
    /payload size 22 exceeds limit 18/u,
  );
  assert.throws(
    () => framedPayloadLength([Number.MAX_SAFE_INTEGER], 4, {
      ...limits,
      maximumFrameBytes: Number.MAX_SAFE_INTEGER,
    }, "test"),
    /frame 0 size .* exceeds limit/u,
  );
});
