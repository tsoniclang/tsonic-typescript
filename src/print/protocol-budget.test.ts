import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BoundedFrameCollection,
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

test("bounded frame collection rejects before retaining an over-budget frame", () => {
  const frames = new BoundedFrameCollection(4, limits, "test");
  const accepted = Uint8Array.from([1, 2, 3]);
  frames.append(accepted);

  assert.throws(
    () => frames.append(Uint8Array.from([4, 5, 6])),
    /payload size 22 exceeds limit 18/u,
  );
  assert.equal(frames.size, 1);
  assert.equal(frames.payloadLength, 15);
  const retained = frames.frames();
  assert.equal(Object.isFrozen(retained), true);
  assert.deepEqual(retained, [accepted]);
});

test("bounded frame collection reports a full batch without retaining its next frame", () => {
  const frames = new BoundedFrameCollection(4, limits, "test");
  const accepted = Uint8Array.from([1, 2, 3]);
  assert.equal(frames.tryAppend(accepted), true);
  assert.equal(frames.tryAppend(Uint8Array.from([4, 5, 6])), false);
  assert.equal(frames.size, 1);
  assert.equal(frames.payloadLength, 15);
  assert.deepEqual(frames.frames(), [accepted]);
});
