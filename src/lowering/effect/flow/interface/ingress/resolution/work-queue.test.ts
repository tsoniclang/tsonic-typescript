import assert from "node:assert/strict";
import { test } from "node:test";

import { createInterfaceOriginWorkQueue } from "./work-queue.js";

test("retains only the live interface-origin frontier", () => {
  const queue = createInterfaceOriginWorkQueue<number>(2);
  queue.enqueue(1);
  queue.enqueue(2);
  assert.equal(queue.dequeue(), 1);
  queue.enqueue(3);
  queue.enqueue(4);

  assert.equal(queue.length, 3);
  assert.equal(queue.highWaterMark, 3);
  assert.deepEqual([
    queue.dequeue(),
    queue.dequeue(),
    queue.dequeue(),
    queue.dequeue(),
  ], [2, 3, 4, undefined]);
  assert.equal(queue.length, 0);
  assert.equal(queue.highWaterMark, 3);
});

test("rejects an invalid interface-origin frontier capacity", () => {
  assert.throws(
    () => createInterfaceOriginWorkQueue(0),
    /capacity must be positive/u,
  );
});
