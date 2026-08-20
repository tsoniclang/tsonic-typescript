import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import {
  propagateEffectBlockers,
  type EffectDependencyVertex,
} from "./blocker-propagation.js";
import type { CooperativeEffectFallbackReason } from "./retention.js";
import type { EffectProvenanceEdgeKind } from "../provenance/model.js";

interface MutableEffectDependencyVertex extends EffectDependencyVertex {
  readonly dependencies: Set<EffectDependencyVertex>;
  readonly dependencyEvidence: Map<
    EffectDependencyVertex,
    Map<EffectProvenanceEdgeKind, Set<Node>>
  >;
  readonly directBlockerNodes: Map<
    CooperativeEffectFallbackReason,
    Set<Node>
  >;
}

test("propagates exact blocker roots with bounded graph work", () => {
  const declarations = Array.from(
    { length: 4_096 },
    () => Object.freeze({}) as Node,
  );
  const occurrences = Array.from(
    { length: declarations.length },
    () => Object.freeze({}) as Node,
  );
  const vertices = declarations.map(createVertex);
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const owner = vertices[index]!;
    const dependency = vertices[index + 1]!;
    owner.dependencies.add(dependency);
    owner.dependencyEvidence.set(
      dependency,
      new Map([["callable-invocation", new Set([occurrences[index]!])]]),
    );
  }
  const terminal = vertices.at(-1)!;
  terminal.blockers.add("unresolved-call");
  terminal.directBlockerNodes.set(
    "unresolved-call",
    new Set([occurrences.at(-1)!]),
  );

  const propagation = propagateEffectBlockers(vertices);

  assert.ok(vertices.every((vertex) =>
    vertex.blockers.size === 1 && vertex.blockers.has("unresolved-call")
  ));
  assert.deepEqual(propagation.evidence, {
    vertices: 4_096,
    edges: 4_095,
    components: 4_096,
    work: 20_476,
  });
  const roots = propagation.rootsFor(vertices[0]!);
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.reason, "unresolved-call");
  assert.equal(roots[0]?.declaration, declarations.at(-1));
  assert.equal(roots[0]?.occurrence, occurrences.at(-1));
  assert.equal(roots[0]?.path.length, 4_096);
  assert.equal(roots[0]?.steps.length, 4_095);
  assert.ok(roots[0]?.steps.every((step) =>
    step.kind === "callable-invocation"
  ));
});

test("propagates one deterministic blocker path through an SCC", () => {
  const first = createVertex(Object.freeze({}) as Node);
  const second = createVertex(Object.freeze({}) as Node);
  const firstOccurrence = Object.freeze({}) as Node;
  const secondOccurrence = Object.freeze({}) as Node;
  connect(first, second, "argument", firstOccurrence);
  connect(second, first, "return", secondOccurrence);
  second.blockers.add("open-dispatch");
  second.directBlockerNodes.set("open-dispatch", new Set([second.declaration]));

  const propagation = propagateEffectBlockers([first, second]);

  assert.deepEqual(propagation.evidence, {
    vertices: 2,
    edges: 2,
    components: 1,
    work: 6,
  });
  const root = propagation.rootsFor(first)[0];
  assert.equal(root?.declaration, second.declaration);
  assert.equal(root?.path.length, 2);
  assert.equal(root?.path[0], first.declaration);
  assert.equal(root?.path[1], second.declaration);
  assert.equal(root?.steps.length, 1);
  assert.equal(root?.steps[0]?.kind, "argument");
  assert.equal(root?.steps[0]?.occurrence, firstOccurrence);
});

test("rejects dependency topology without exact edge evidence", () => {
  const first = createVertex(Object.freeze({}) as Node);
  const second = createVertex(Object.freeze({}) as Node);
  first.dependencies.add(second);

  assert.throws(
    () => propagateEffectBlockers([first, second]),
    /dependency set and evidence ledger do not exact-join/u,
  );
});

function createVertex(declaration: Node): MutableEffectDependencyVertex {
  return {
    declaration,
    dependencies: new Set<EffectDependencyVertex>(),
    dependencyEvidence: new Map(),
    directBlockerNodes: new Map<
      CooperativeEffectFallbackReason,
      Set<Node>
    >(),
    blockers: new Set<CooperativeEffectFallbackReason>(),
  };
}

function connect(
  owner: MutableEffectDependencyVertex,
  dependency: MutableEffectDependencyVertex,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
): void {
  owner.dependencies.add(dependency);
  owner.dependencyEvidence.set(
    dependency,
    new Map([[kind, new Set([occurrence])]]),
  );
}
