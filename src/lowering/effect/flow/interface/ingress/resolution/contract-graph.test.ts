import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import { createInterfaceOriginContractGraph } from "./contract-graph.js";

test("resolves shared cyclic topology independently for each contract", () => {
  const contracts = [node(), node()];
  const occurrence = node();
  const builder = createInterfaceOriginContractGraph(contracts);
  const origin = builder.vertex();
  const opaque = builder.vertex();
  const shared = builder.vertex();
  const root = builder.vertex();

  for (let contract = 0; contract < contracts.length; contract += 1) {
    assert.equal(builder.activate(root, contract), true);
    assert.equal(builder.activate(root, contract), false);
    builder.addDependency(root, shared, "projection", occurrence, contract);
    builder.addDependency(shared, root, "alias", occurrence, contract);
  }
  builder.addDependency(shared, origin, "assignment", occurrence, 0);
  builder.addDependency(shared, origin, "assignment", occurrence, 0);
  builder.addDependency(shared, opaque, "assignment", occurrence, 1);
  builder.addOrigin(origin, 0);
  builder.addBoundary(opaque, "opaque-call-transport", 1);

  const resolutions = builder.seal();

  assert.deepEqual(resolutions.resolutionFor(root, 0), {
    closed: true,
    opaque: false,
  });
  assert.deepEqual(resolutions.resolutionFor(root, 1), {
    closed: false,
    opaque: true,
  });
  assert.equal(resolutions.measurements.contracts, 2);
  assert.equal(resolutions.measurements.vertices, 4);
  assert.equal(resolutions.measurements.edges, 4);
  assert.equal(resolutions.measurements.steps, 2);
  assert.throws(() => builder.seal(), /already sealed/u);
});

test("keeps an originless contract cycle open", () => {
  const builder = createInterfaceOriginContractGraph([node()]);
  const first = builder.vertex();
  const second = builder.vertex();
  builder.addDependency(first, second, "alias", node(), 0);
  builder.addDependency(second, first, "assignment", node(), 0);

  const resolutions = builder.seal();

  assert.deepEqual(resolutions.resolutionFor(first, 0), {
    closed: false,
    opaque: false,
  });
  assert.deepEqual(resolutions.resolutionFor(second, 0), {
    closed: false,
    opaque: false,
  });
});

function node(): Node {
  return Object.freeze({}) as Node;
}
