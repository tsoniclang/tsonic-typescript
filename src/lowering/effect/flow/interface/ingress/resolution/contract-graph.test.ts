import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import { createInterfaceOriginContractGraph } from "./contract-graph.js";
import { createInterfaceOriginContractDomain } from "./contract-set.js";

test("resolves shared cyclic topology independently for each contract", () => {
  const contracts = [node(), node()];
  const domain = createInterfaceOriginContractDomain(contracts);
  const occurrence = node();
  const builder = createInterfaceOriginContractGraph(domain);
  const origin = builder.vertex();
  const opaque = builder.vertex();
  const shared = builder.vertex();
  const root = builder.vertex();

  for (let contract = 0; contract < contracts.length; contract += 1) {
    const selected = domain.single(contract);
    assert.equal(domain.count(builder.activate(root, selected)), 1);
    assert.equal(domain.count(builder.activate(root, selected)), 0);
    builder.addDependency(root, shared, "projection", occurrence, selected);
    builder.addDependency(shared, root, "alias", occurrence, selected);
  }
  builder.addDependency(
    shared,
    origin,
    "assignment",
    occurrence,
    domain.single(0),
  );
  builder.addDependency(
    shared,
    origin,
    "assignment",
    occurrence,
    domain.single(0),
  );
  builder.addDependency(
    shared,
    opaque,
    "assignment",
    occurrence,
    domain.single(1),
  );
  builder.addOrigin(origin, domain.single(0));
  builder.addBoundary(
    opaque,
    "opaque-call-transport",
    domain.single(1),
  );

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
  assert.ok(resolutions.measurements.frontier <= 4);
  assert.equal(resolutions.measurements.steps, 2);
  assert.throws(() => builder.seal(), /already sealed/u);
});

test("keeps an originless contract cycle open", () => {
  const domain = createInterfaceOriginContractDomain([node()]);
  const builder = createInterfaceOriginContractGraph(domain);
  const first = builder.vertex();
  const second = builder.vertex();
  builder.addDependency(first, second, "alias", node(), domain.single(0));
  builder.addDependency(second, first, "assignment", node(), domain.single(0));

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
