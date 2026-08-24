import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import type { ExactValueSlotResolution } from "./model.js";
import { mergeExactValueSlotResolutions } from "./resolution.js";

test("duplicate batch resolutions must carry identical exact evidence", () => {
  const root = node();
  const origin = node();
  const owner = node();
  const contract = node();
  const invocation = node();
  const resolution = closedResolution(
    origin,
    owner,
    contract,
    invocation,
  );
  const target = new Map<Node, ExactValueSlotResolution>();

  mergeExactValueSlotResolutions(target, new Map([[root, resolution]]));
  mergeExactValueSlotResolutions(
    target,
    new Map([[
      root,
      closedResolution(origin, owner, contract, invocation),
    ]]),
  );
  assert.equal(target.get(root), resolution);

  assert.throws(
    () =>
      mergeExactValueSlotResolutions(
        target,
        new Map([[
          root,
          closedResolution(node(), owner, contract, invocation),
        ]]),
      ),
    /conflicting exact evidence/u,
  );
});

function closedResolution(
  origin: Node,
  resultOwner: Node,
  contract: Node,
  invocation: Node,
): ExactValueSlotResolution {
  return Object.freeze({
    closed: true,
    expressions: Object.freeze([origin]),
    steps: Object.freeze([Object.freeze({
      resultOwner,
      contracts: Object.freeze([contract]),
      invocation,
      path: Object.freeze([Object.freeze({
        kind: "element" as const,
        index: 0,
      })]),
    })]),
  });
}

function node(): Node {
  return Object.freeze({}) as Node;
}
