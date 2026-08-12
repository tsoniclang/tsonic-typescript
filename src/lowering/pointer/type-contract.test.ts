import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerFactKey } from "@tsonic/tsts";
import type { Node, PointerFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  visit,
} from "./pointer.test-support.js";
import { validatePointerFact } from "./type-contract.js";

test("rejects changed pointer pointee, mutability, and subject shape", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
type NumberPointer = Pointer<number>;
type StringPointer = Pointer<string>;
`);
  const facts = pointerTypeReferenceFacts(fixture);
  const number = facts[0];
  const string = facts[1];
  assert.ok(number !== undefined);
  assert.ok(string !== undefined);
  assert.doesNotThrow(() =>
    validatePointerFact(fixture.source, number.subject, number.fact)
  );

  assert.throws(
    () => validatePointerFact(fixture.source, number.subject, {
      ...number.fact,
      pointee: string.fact.pointee,
    }),
    /pointee disagrees/u,
  );
  assert.throws(
    () => validatePointerFact(fixture.source, number.subject, {
      ...number.fact,
      mutability: "readonly",
    }),
    /mutability.*readwrite/u,
  );
  assert.throws(
    () => validatePointerFact(
      fixture.source,
      fixture.sourceFile,
      number.fact,
    ),
    /not a type reference or its exact type name/u,
  );
});

function pointerTypeReferenceFacts(
  fixture: ReturnType<typeof checkedPointerFixture>,
): readonly { readonly subject: Node; readonly fact: PointerFact }[] {
  const facts: { readonly subject: Node; readonly fact: PointerFact }[] = [];
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      if (!fixture.source.ast.is.IsTypeReferenceNode(node)) {
        return;
      }
      const fact = fixture.source.sourceFacts.getFact(node, pointerFactKey);
      if (fact !== undefined) {
        facts.push(Object.freeze({ subject: node, fact }));
      }
    });
  }
  return Object.freeze(facts);
}
