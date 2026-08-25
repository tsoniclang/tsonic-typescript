import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import type { CallableValueResolution } from "../value-resolution.js";
import { finalizeCallableInterfaceEvidence } from "./interface-evidence.js";

test("interface evidence detaches exact callable settlement facts", () => {
  const call = node();
  const declaration = node();
  const dependency = node();
  const synchronous = node();
  const closedReference = node();
  const settledReturnSource = node();
  const inheritedReference = node();
  const dependencies = [dependency];
  const synchronousDeclarations = [synchronous];
  const resolution: CallableValueResolution = Object.freeze({
    closed: true,
    dependencyCount: 1,
    synchronousDeclarationCount: 1,
    dependencyNodes(): Iterable<Node> {
      return dependencies;
    },
    synchronousDeclarationNodes(): Iterable<Node> {
      return synchronousDeclarations;
    },
  });
  const calls = new Map([[call, resolution]]);
  const references = new Set([closedReference]);
  const declarations = new Map([[declaration, resolution]]);
  const closedDeclarations = new Set([declaration]);
  const settledSources = new Set([settledReturnSource]);

  const evidence = finalizeCallableInterfaceEvidence(
    calls,
    references,
    declarations,
    closedDeclarations,
    settledSources,
    (reference) => reference === inheritedReference,
  );
  calls.clear();
  references.clear();
  declarations.clear();
  closedDeclarations.clear();
  settledSources.clear();
  dependencies.length = 0;
  synchronousDeclarations.length = 0;

  assert.deepEqual(evidence.implementationsForCall(call), [
    dependency,
    synchronous,
  ]);
  const detached = evidence.resolutionForDeclaration(declaration);
  assert.equal(detached?.closed, true);
  assert.deepEqual([...(detached?.dependencyNodes() ?? [])], [dependency]);
  assert.deepEqual(
    [...(detached?.synchronousDeclarationNodes() ?? [])],
    [synchronous],
  );
  assert.equal(evidence.allowsCallableReference(closedReference), true);
  assert.equal(evidence.allowsCallableReference(declaration), true);
  assert.equal(evidence.allowsCallableReference(settledReturnSource), true);
  assert.equal(evidence.allowsCallableReference(inheritedReference), true);
  assert.equal(evidence.allowsCallableReference(node()), false);
});

test("interface evidence excludes unresolved callable origins", () => {
  const call = node();
  const unresolved: CallableValueResolution = Object.freeze({
    closed: false,
    dependencyCount: 0,
    synchronousDeclarationCount: 0,
    dependencyNodes(): Iterable<Node> {
      return [];
    },
    synchronousDeclarationNodes(): Iterable<Node> {
      return [];
    },
  });
  const evidence = finalizeCallableInterfaceEvidence(
    new Map([[call, unresolved]]),
    new Set(),
    new Map(),
    new Set(),
    new Set(),
    undefined,
  );

  assert.equal(evidence.implementationsForCall(call), undefined);
});

function node(): Node {
  return Object.freeze({}) as Node;
}
