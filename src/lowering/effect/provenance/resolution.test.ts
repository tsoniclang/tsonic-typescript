import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import { createEffectProvenanceGraphBuilder } from "./graph.js";
import { resolveEffectProvenance } from "./resolution.js";

test("provenance resolution closes cycles only from exact origins", () => {
  const firstNode = node();
  const secondNode = node();
  const dependentNode = node();
  const origin = node();
  const firstEdge = node();
  const secondEdge = node();
  const dependentEdge = node();
  const boundary = node();
  const builder = createEffectProvenanceGraphBuilder<"open-result">();
  const first = builder.vertex("expression", firstNode);
  const second = builder.vertex("binding", secondNode);
  const dependent = builder.vertex("result", dependentNode);

  builder.addDependency(first, second, "alias", firstEdge);
  builder.addDependency(second, first, "assignment", secondEdge);
  builder.addDependency(dependent, first, "return", dependentEdge);
  builder.addOrigin(first, origin);
  builder.addBoundary(dependent, "open-result", boundary);
  const graph = builder.seal();
  const resolutions = resolveEffectProvenance(graph);

  assert.equal(resolutions.componentCount, 2);
  assert.equal(resolutions.edgeCount, 3);
  const componentDependencies: Array<readonly [number, number]> = [];
  resolutions.forEachComponentDependency((destination, source) => {
    componentDependencies.push([destination, source]);
  });
  assert.equal(componentDependencies.length, 1);
  assert.notEqual(
    componentDependencies[0]?.[0],
    componentDependencies[0]?.[1],
  );
  const firstOrigins = resolutions.resolutionFor(first).origins;
  const secondOrigins = resolutions.resolutionFor(second).origins;
  assert.equal(firstOrigins.length, 1);
  assert.equal(firstOrigins[0], origin);
  assert.equal(secondOrigins.length, 1);
  assert.equal(secondOrigins[0], origin);
  assert.equal(resolutions.resolutionFor(first).closed, true);
  assert.equal(resolutions.resolutionFor(second).closed, true);
  assert.equal(resolutions.resolutionFor(dependent).closed, false);
  const boundaries = resolutions.resolutionFor(dependent).boundaries;
  assert.equal(boundaries.length, 1);
  assert.equal(boundaries[0]?.reason, "open-result");
  assert.equal(boundaries[0]?.occurrence, boundary);
});

test("provenance graph sealing is immutable, exact, and graph-owned", () => {
  const occurrence = node();
  const builder = createEffectProvenanceGraphBuilder<"open">();
  const source = builder.vertex("expression", node());
  const destination = builder.vertex("result", node());

  builder.addDependency(destination, source, "return", occurrence);
  builder.addDependency(destination, source, "return", occurrence);
  builder.addOrigin(source, occurrence);
  builder.addOrigin(source, occurrence);
  builder.addBoundary(destination, "open", occurrence);
  builder.addBoundary(destination, "open", occurrence);
  const graph = builder.seal();

  assert.equal(graph.vertices.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.origins.length, 1);
  assert.equal(graph.boundaries.length, 1);
  assert.throws(() => builder.seal(), /already sealed/u);
  assert.throws(
    () => builder.addOrigin(source, node()),
    /already sealed/u,
  );

  const foreignBuilder = createEffectProvenanceGraphBuilder<never>();
  const foreign = foreignBuilder.vertex("expression", node());
  assert.throws(
    () => foreignBuilder.addDependency(foreign, source, "alias", node()),
    /another graph/u,
  );
  assert.throws(
    () => resolveEffectProvenance(graph).resolutionFor(foreign),
    /foreign vertex/u,
  );
});

test("an originless provenance cycle remains unproved", () => {
  const builder = createEffectProvenanceGraphBuilder<never>();
  const first = builder.vertex("expression", node());
  const second = builder.vertex("binding", node());
  builder.addDependency(first, second, "alias", node());
  builder.addDependency(second, first, "assignment", node());

  const resolutions = resolveEffectProvenance(builder.seal());

  assert.equal(resolutions.componentCount, 1);
  assert.equal(resolutions.resolutionFor(first).closed, false);
  assert.equal(resolutions.resolutionFor(first).originless, true);
  assert.equal(resolutions.resolutionFor(second).closed, false);
  assert.equal(resolutions.resolutionFor(second).originless, true);
});

test("provenance evidence is shared through a long dependency chain", () => {
  const builder = createEffectProvenanceGraphBuilder<never>();
  const vertices = Array.from(
    { length: 4_096 },
    () => builder.vertex("expression", node()),
  );
  const origin = node();
  const first = vertices[0];
  assert.ok(first !== undefined);
  builder.addOrigin(first, origin);
  for (let index = 1; index < vertices.length; index += 1) {
    const source = vertices[index - 1];
    const destination = vertices[index];
    assert.ok(source !== undefined);
    assert.ok(destination !== undefined);
    builder.addDependency(destination, source, "alias", node());
  }

  const resolutions = resolveEffectProvenance(builder.seal());
  const expected = resolutions.resolutionFor(first).origins;

  assert.equal(expected[0], origin);
  for (const vertex of vertices) {
    assert.equal(resolutions.resolutionFor(vertex).origins, expected);
  }
});

test("mostly isolated provenance stays sparse and query-bounded", () => {
  const builder = createEffectProvenanceGraphBuilder<never>();
  const vertices = Array.from(
    { length: 32_768 },
    () => builder.vertex("expression", node()),
  );
  const selected = vertices[17_000];
  assert.ok(selected !== undefined);
  builder.addOrigin(selected, selected.occurrence);

  const resolutions = resolveEffectProvenance(builder.seal());

  assert.equal(resolutions.componentCount, vertices.length);
  assert.ok(resolutions.work < vertices.length * 4);
  assert.equal(resolutions.resolutionFor(selected).closed, true);
});

test("boundary reasons use exact compact reachability over shared tails", () => {
  type Reason = "opaque" | "unproven";
  const builder = createEffectProvenanceGraphBuilder<Reason>();
  const opaque = builder.vertex("provider", node());
  const unproven = builder.vertex("provider", node());
  const shared = builder.vertex("storage", node());
  const first = builder.vertex("interface-value", node());
  const second = builder.vertex("interface-value", node());
  const clear = builder.vertex("interface-value", node());
  builder.addBoundary(opaque, "opaque", node());
  builder.addBoundary(unproven, "unproven", node());
  builder.addDependency(shared, opaque, "provider-transport", node());
  builder.addDependency(shared, unproven, "assignment", node());
  builder.addDependency(first, shared, "projection", node());
  builder.addDependency(second, shared, "projection", node());
  builder.addOrigin(clear, node());

  const resolutions = resolveEffectProvenance(builder.seal());

  for (const selected of [shared, first, second]) {
    const resolution = resolutions.resolutionFor(selected);
    assert.equal(resolution.hasBoundaryReason("opaque"), true);
    assert.equal(resolution.hasBoundaryReason("unproven"), true);
  }
  assert.equal(
    resolutions.resolutionFor(opaque).hasBoundaryReason("unproven"),
    false,
  );
  assert.equal(
    resolutions.resolutionFor(unproven).hasBoundaryReason("opaque"),
    false,
  );
  assert.equal(
    resolutions.resolutionFor(clear).hasBoundaryReason("opaque"),
    false,
  );
  assert.equal(resolutions.resolutionFor(first).boundaries.length, 2);
});

function node(): Node {
  return Object.freeze({}) as Node;
}
