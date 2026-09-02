import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedPointerFixture,
  sourceFileNamed,
  visit,
} from "../pointer/pointer.test-support.js";
import { createRepresentationBindingProof } from "./binding-proof.js";

test("evaluates each exact class and callable binding once", () => {
  const fixture = checkedPointerFixture(
    `
import { Box as ImportedBox, Storage } from "./public.js";
export const value = ImportedBox.to(ImportedBox.from(new Storage(41))).value;
`,
    {
      "/src/box.ts": `
export class Storage { constructor(readonly value: number) {} }
export class Box {
  constructor(readonly storage: Storage) {}
  static from(storage: Storage): Box { return new Box(storage); }
  static to(box: Box): Storage { return box.storage; }
}
`,
      "/src/public.ts": `export { Box, Storage } from "./box.js";`,
    },
  );
  const classFile = sourceFileNamed(fixture.source, "/src/box.ts");
  const box = namedNode(fixture.source, classFile, "Box", "class");
  const from = namedNode(fixture.source, classFile, "from", "method");
  const proof = createRepresentationBindingProof(
    fixture.source,
    createTargetProgramIndex(fixture.source, { bindingWrites: true }),
  );

  assert.equal(proof.classValueReferencesAreClosed(box), true);
  assert.equal(proof.classValueReferencesAreClosed(box), true);
  assert.equal(proof.stableCallable(from), true);
  assert.equal(proof.stableCallable(from), true);
  assert.deepEqual(proof.statistics(), {
    classQueries: 3,
    classEvaluations: 1,
    callableQueries: 2,
    callableEvaluations: 1,
  });
});

function namedNode(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
  name: string,
  kind: "class" | "method",
): Node {
  let selected: Node | undefined;
  visit(source, root, (node) => {
    if (
      source.ast.text(source.ast.name(node)) === name &&
      (kind === "class"
        ? source.ast.is.IsClassDeclaration(node)
        : source.ast.is.IsMethodDeclaration(node))
    ) {
      selected = node;
    }
  });
  assert.ok(selected !== undefined, `Missing ${kind} '${name}'.`);
  return selected;
}
