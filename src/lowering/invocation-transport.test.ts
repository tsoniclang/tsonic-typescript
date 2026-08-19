import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import {
  composeInvocationTransportContracts,
  type InvocationTransport,
  type InvocationTransportContract,
} from "./invocation-transport.js";

const call = Object.freeze({}) as Node;
const input = Object.freeze({}) as Node;
const transport: InvocationTransport = Object.freeze({
  inputExpressions: Object.freeze([input]),
});

function owner(selected: boolean): InvocationTransportContract {
  return Object.freeze({
    transportFor(candidate: Node): InvocationTransport | undefined {
      return selected && candidate === call ? transport : undefined;
    },
  });
}

test("composes disjoint invocation transport owners", () => {
  const composed = composeInvocationTransportContracts([
    owner(false),
    owner(true),
  ]);

  assert.equal(composed?.transportFor(call), transport);
});

test("rejects duplicate invocation transport ownership", () => {
  const composed = composeInvocationTransportContracts([
    owner(true),
    owner(true),
  ]);

  assert.throws(
    () => composed?.transportFor(call),
    /multiple semantic owners/u,
  );
});
