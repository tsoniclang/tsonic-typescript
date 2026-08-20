import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import {
  allCallableDependenciesAreOptimized,
  createCallableValueResolution,
} from "./value-resolution.js";

test("callable value resolution seals exact deduplicated evidence", () => {
  const dependency = Object.freeze({}) as Node;
  const synchronousDeclaration = Object.freeze({}) as Node;
  const dependencies = new Set([dependency]);
  const synchronousDeclarations = new Set([synchronousDeclaration]);
  const resolution = createCallableValueResolution(
    true,
    dependencies,
    synchronousDeclarations,
  );

  dependencies.clear();
  synchronousDeclarations.clear();

  assert.equal(resolution.closed, true);
  assert.equal(resolution.dependencyCount, 1);
  assert.equal(resolution.synchronousDeclarationCount, 1);
  const dependencyNodes = [...resolution.dependencyNodes()];
  const synchronousDeclarationNodes = [
    ...resolution.synchronousDeclarationNodes(),
  ];
  assert.equal(dependencyNodes.length, 1);
  assert.equal(dependencyNodes[0], dependency);
  assert.equal(synchronousDeclarationNodes.length, 1);
  assert.equal(synchronousDeclarationNodes[0], synchronousDeclaration);
  assert.equal("dependencies" in resolution, false);
  assert.equal("synchronousDeclarations" in resolution, false);
});

test("callable dependency settlement requires every exact origin", () => {
  const first = Object.freeze({}) as Node;
  const second = Object.freeze({}) as Node;
  const resolution = createCallableValueResolution(
    true,
    [first, second, first],
    [],
  );

  assert.equal(resolution.dependencyCount, 2);
  assert.equal(
    allCallableDependenciesAreOptimized(resolution, new Set([first])),
    false,
  );
  assert.equal(
    allCallableDependenciesAreOptimized(
      resolution,
      new Set([first, second]),
    ),
    true,
  );
});
