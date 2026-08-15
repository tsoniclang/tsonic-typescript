import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import {
  mergeResolution,
  resolutionWith,
  sealResolution,
  synchronousResolutionWith,
} from "./value-resolution.js";

test("sealing transfers resolution storage without copying or exposing it", () => {
  const dependency = Object.freeze({}) as Node;
  const synchronousDeclaration = Object.freeze({}) as Node;
  const laterDependency = Object.freeze({}) as Node;
  const mutable = resolutionWith(dependency);

  mergeResolution(
    mutable,
    synchronousResolutionWith(synchronousDeclaration),
  );
  const sealed = sealResolution(mutable);

  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.dependencies), true);
  assert.equal(Object.isFrozen(sealed.synchronousDeclarations), true);
  assert.equal("add" in sealed.dependencies, false);
  assert.equal("delete" in sealed.dependencies, false);
  assert.deepEqual([...sealed.dependencies], [dependency]);
  assert.deepEqual(
    [...sealed.synchronousDeclarations],
    [synchronousDeclaration],
  );

  assert.throws(
    () => mergeResolution(mutable, resolutionWith(laterDependency)),
    /already sealed/u,
  );
  assert.throws(() => sealResolution(mutable), /already sealed/u);
  assert.deepEqual([...sealed.dependencies], [dependency]);
});

test("sealed resolution views preserve exact set behavior at every cardinality", () => {
  const first = Object.freeze({}) as Node;
  const second = Object.freeze({}) as Node;
  const empty = sealResolution(
    synchronousResolutionWith(first),
  ).dependencies;
  const single = sealResolution(resolutionWith(first)).dependencies;
  const mutableMany = resolutionWith(first);
  mergeResolution(mutableMany, resolutionWith(second));
  const many = sealResolution(mutableMany).dependencies;

  assert.equal(empty.size, 0);
  assert.deepEqual([...empty], []);
  assert.equal(single.size, 1);
  assert.equal(single.has(first), true);
  assert.deepEqual([...single.keys()], [first]);
  assert.deepEqual([...single.entries()], [[first, first]]);
  assert.equal(many.size, 2);
  assert.equal(many.has(second), true);
  assert.deepEqual([...many.values()], [first, second]);
});
