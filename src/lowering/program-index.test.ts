import assert from "node:assert/strict";
import { test } from "node:test";

import { KindIdentifier } from "@tsonic/tsts/target-ast";
import type { Node } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  visit,
} from "./pointer/pointer.test-support.js";
import { createTargetProgramIndex } from "./program-index.js";

test("indexes one exact node census and selected binding writes", () => {
  const fixture = checkedPointerFixture(`
let value = 1;
value = 2;
export const result = value;
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
  });
  const identifiers = program.nodesOfKind(KindIdentifier);
  let declaration: Node | undefined;
  visit(fixture.source, fixture.sourceFile, (node) => {
    if (
      fixture.source.ast.is.IsIdentifier(node) &&
      fixture.source.ast.text(node) === "value"
    ) {
      declaration ??= fixture.source.navigation.sourceReferenceFor(node)
        ?.declaration;
    }
  });

  assert.ok(declaration !== undefined);
  assert.equal(program.operations.nodeVisits, program.nodes.length);
  assert.equal(program.operations.kindEntries, program.nodes.length);
  assert.equal(
    program.operations.childEdges + program.sourceFiles.length,
    program.nodes.length,
  );
  assert.equal(identifiers.length, program.operations.identifierEntries);
  assert.equal(program.bindingWritesFor(declaration).length, 1);
  assert.equal(program.hasBindingWrite(declaration), true);
  assert.equal(
    program.nodesFor(fixture.sourceFile).includes(declaration),
    true,
  );
});

test("does not query or retain unselected binding-write facts", () => {
  const fixture = checkedPointerFixture(`
let value = 1;
value = 2;
export const result = value;
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
  });

  assert.equal(program.operations.bindingCandidates, 0);
  assert.equal(program.operations.bindingWrites, 0);
  assert.equal(program.bindingWritesFor(undefined).length, 0);
});
