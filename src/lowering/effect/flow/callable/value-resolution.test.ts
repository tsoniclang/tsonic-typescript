import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@tsonic/tsts";

import {
  mergeResolution,
  resolutionWith,
  sealResolution,
  sealResolutions,
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

  assert.equal("dependencies" in sealed, false);
  assert.equal("synchronousDeclarations" in sealed, false);
  assert.equal(sealed.dependencyCount, 1);
  assert.equal(sealed.synchronousDeclarationCount, 1);
  assert.deepEqual([...sealed.dependencyNodes()], [dependency]);
  assert.deepEqual(
    [...sealed.synchronousDeclarationNodes()],
    [synchronousDeclaration],
  );

  assert.throws(
    () => mergeResolution(mutable, resolutionWith(laterDependency)),
    /already sealed/u,
  );
  assert.throws(() => sealResolution(mutable), /already sealed/u);
  assert.deepEqual([...sealed.dependencyNodes()], [dependency]);
});

test("sealed resolution evidence preserves exact set behavior at every cardinality", () => {
  const first = Object.freeze({}) as Node;
  const second = Object.freeze({}) as Node;
  const empty = sealResolution(
    synchronousResolutionWith(first),
  );
  const single = sealResolution(resolutionWith(first));
  const mutableMany = resolutionWith(first);
  mergeResolution(mutableMany, resolutionWith(second));
  const many = sealResolution(mutableMany);

  assert.equal(empty.dependencyCount, 0);
  assert.deepEqual([...empty.dependencyNodes()], []);
  assert.equal(single.dependencyCount, 1);
  assert.deepEqual([...single.dependencyNodes()], [first]);
  assert.equal(many.dependencyCount, 2);
  assert.deepEqual([...many.dependencyNodes()], [first, second]);
});

test("bulk sealing transfers each interned resolution exactly once", () => {
  const dependency = Object.freeze({}) as Node;
  const shared = resolutionWith(dependency);

  sealResolutions([shared], [shared]);

  assert.deepEqual([...shared.dependencyNodes()], [dependency]);
  assert.throws(() => sealResolution(shared), /already sealed/u);
});
