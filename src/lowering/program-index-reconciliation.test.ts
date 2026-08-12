import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import { KindIdentifier, KindMethodDeclaration } from "@tsonic/tsts/target-ast";

import { checkedEffectFixture } from "./effect/effect.test-support.js";
import { createTargetProgramIndex } from "./program-index.js";
import {
  assertBindingWritesReconcile,
  assertDispatchReconciles,
  assertNodeIndexReconciles,
  indexedSource,
} from "./program-index.test-support.js";

test("batch binding writes exactly match canonical navigation", () => {
  const fixture = checkedEffectFixture(`
let first = 0;
let second = 0;
let third = 0;
const object = { value: 0 };
first += 1;
++second;
[first] = [2];
({ value: second } = { value: 3 });
for (third of [4]) { void third; }
object.value = 5;
export const total = first + second + third + object.value;
`);
  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
  });
  assertBindingWritesReconcile(fixture.source, index);
  assert.ok(index.operations.bindingCandidates >= 6);
  assert.ok(index.operations.bindingWrites >= 6);
});

test("independent reconciliation catches node and edge mutations", () => {
  const fixture = checkedEffectFixture(
    `import { other } from "./other.js";\n${indexedSource}\nvoid other;`,
    { "/src/other.ts": "export const other = 1;" },
  );
  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  assertNodeIndexReconciles(fixture.source, index);
  assertBindingWritesReconcile(fixture.source, index);
  assertDispatchReconciles(fixture.source, index);

  assert.throws(
    () => assertNodeIndexReconciles(fixture.source, {
      ...index,
      nodes: Object.freeze(index.nodes.slice(1)),
    }),
    /node census/,
  );
  assert.throws(
    () => assertNodeIndexReconciles(fixture.source, {
      ...index,
      nodes: Object.freeze([...index.nodes, index.nodes[0] as Node]),
    }),
    /node census/,
  );
  assert.throws(
    () => assertNodeIndexReconciles(fixture.source, {
      ...index,
      nodesOfKind(kind) {
        return kind === KindIdentifier
          ? index.nodesOfKind(KindMethodDeclaration)
          : index.nodesOfKind(kind);
      },
    }),
    /kind partition/,
  );
  const [firstFile, secondFile] = index.sourceFiles;
  assert.ok(firstFile !== undefined);
  assert.ok(secondFile !== undefined);
  assert.throws(
    () => assertNodeIndexReconciles(fixture.source, {
      ...index,
      nodesFor(sourceFile) {
        return sourceFile === firstFile
          ? index.nodesFor(secondFile)
          : index.nodesFor(sourceFile);
      },
    }),
    /source-file partition/,
  );
  assert.throws(
    () => assertBindingWritesReconcile(fixture.source, {
      ...index,
      bindingWritesFor() {
        return Object.freeze([]);
      },
    }),
    /binding writes/,
  );
  const declaration = index.nodesOfKind(KindIdentifier)
    .map((node) => fixture.source.navigation.sourceReferenceFor(node)?.declaration)
    .find((node) => node !== undefined && index.bindingWritesFor(node).length !== 0);
  assert.ok(declaration !== undefined);
  assert.throws(
    () => assertBindingWritesReconcile(fixture.source, {
      ...index,
      bindingWritesFor(node) {
        const writes = index.bindingWritesFor(node);
        return node === declaration && writes[0] !== undefined
          ? Object.freeze([writes[0], ...writes])
          : writes;
      },
    }),
    /binding writes/,
  );
  const target = index.nodesOfKind(KindMethodDeclaration)[0];
  assert.ok(target !== undefined);
  assert.throws(
    () => assertDispatchReconciles(fixture.source, {
      ...index,
      memberDispatch(node) {
        return node === target
          ? { overridesBase: true, hasDerivedOverride: true }
          : index.memberDispatch(node);
      },
    }),
    /member dispatch/,
  );
});
