import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FramedPayloadBudget,
  printerProtocolLimits,
  type PrinterProtocolLimits,
} from "./protocol-budget.js";

const limits: PrinterProtocolLimits = Object.freeze({
  maximumFileCount: 2,
  maximumFrameBytes: 3,
  maximumPayloadBytes: 18,
});

test("printer protocol budget accepts the exact aggregate boundary", () => {
  const budget = new FramedPayloadBudget(4, limits, "test");
  budget.reserveFrame(1);
  budget.reserveFrame(1);
  assert.equal(budget.payloadLength, 18);
});

test("printer protocol budget rejects count, frame, aggregate, and arithmetic excess", () => {
  const count = new FramedPayloadBudget(4, limits, "test");
  count.reserveFrame(0);
  count.reserveFrame(0);
  assert.throws(
    () => count.reserveFrame(0),
    /file count 3 exceeds limit 2/u,
  );
  assert.throws(
    () => new FramedPayloadBudget(4, limits, "test").reserveFrame(4),
    /frame 0 size 4 exceeds limit 3/u,
  );
  const aggregate = new FramedPayloadBudget(4, limits, "test");
  aggregate.reserveFrame(3);
  assert.throws(
    () => aggregate.reserveFrame(3),
    /payload size 22 exceeds limit 18/u,
  );
  assert.throws(
    () => new FramedPayloadBudget(4, {
      ...limits,
      maximumFrameBytes: Number.MAX_SAFE_INTEGER,
    }, "test").reserveFrame(Number.MAX_SAFE_INTEGER),
    /frame 0 size .* exceeds limit/u,
  );
});

test("printer protocol budget validates its complete finite policy", () => {
  assert.throws(
    () => new FramedPayloadBudget(4, {
      ...limits,
      maximumFileCount: 0,
    }, "test"),
    /maximum file count must be a positive safe integer/u,
  );
  assert.throws(
    () => new FramedPayloadBudget(4, {
      ...limits,
      maximumPayloadBytes: 7,
    }, "test"),
    /base payload size 8 exceeds limit 7/u,
  );
});

test("production printer budget admits large official ASTs within its finite ceiling", () => {
  const mebibyte = 1024 * 1024;
  assert.equal(printerProtocolLimits.maximumFrameBytes, 128 * mebibyte);
  assert.equal(printerProtocolLimits.maximumPayloadBytes, 256 * mebibyte);
  const admitted = new FramedPayloadBudget(
    8,
    printerProtocolLimits,
    "production printer request",
  );
  admitted.reserveFrame(96 * mebibyte);
  assert.throws(
    () => new FramedPayloadBudget(
      8,
      printerProtocolLimits,
      "production printer request",
    ).reserveFrame(128 * mebibyte + 1),
    /frame 0 size .* exceeds limit/u,
  );
});
