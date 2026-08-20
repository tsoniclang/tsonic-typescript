import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  KindIdentifier,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../program-index.js";
import { checkedEffectFixture } from "../test-support/fixture.test-support.js";

test("materializes exact direct and reverse reference facts once", () => {
  const unrelated = Array.from(
    { length: 256 },
    (_, index) => `const unrelated${index} = ${index};`,
  ).join("\n");
  const fixture = checkedEffectFixture(`
${unrelated}
class Worker {
  async value(): Promise<number> { return 1; }
}
const worker = new Worker();
export const result = await worker.value();
`);
  let queries = 0;
  const queried = new Set<Node>();
  const source = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      sourceReferenceFor(node: Node | undefined) {
        queries += 1;
        if (node !== undefined) {
          queried.add(node);
        }
        return fixture.source.navigation.sourceReferenceFor(node);
      },
    }),
  });

  const program = createTargetProgramIndex(source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
  assert.ok(queries > 0);
  assert.ok(
    queries < program.operations.referenceCandidates - 200,
    "declaration and property names must not be eagerly resolved",
  );
  const access = program.nodesOfKind(KindPropertyAccessExpression)
    .find((node) => source.ast.text(source.ast.name(node)) === "value");
  assert.ok(access !== undefined);
  const propertyName = source.ast.name(access);
  assert.ok(propertyName !== undefined);
  const declarationName = program.nodesOfKind(KindIdentifier).find((node) => {
    const parent = source.ast.parent(node);
    return source.ast.text(node) === "value" &&
      parent !== undefined &&
      source.ast.is.IsMethodDeclaration(parent);
  });
  assert.ok(declarationName !== undefined);
  assert.equal(queried.has(access), true);
  assert.equal(queried.has(propertyName), false);
  assert.equal(queried.has(declarationName), false);

  const beforeDirectQuery = queries;
  const actualReference = program.declarationReferenceFor(access);
  const expectedReference = fixture.source.navigation.sourceReferenceFor(access);
  assert.ok(actualReference !== undefined);
  assert.ok(expectedReference !== undefined);
  assert.equal(actualReference.declaration === expectedReference.declaration, true);
  assert.equal(actualReference.symbol === expectedReference.symbol, true);
  assert.equal(actualReference.project, expectedReference.project);
  assert.equal(queries, beforeDirectQuery);
  assert.equal(program.declarationReferenceFor(propertyName), undefined);
  assert.equal(program.declarationReferenceFor(declarationName), undefined);
  assert.equal(queries, beforeDirectQuery);

  const declaration = source.ast.parent(declarationName);
  assert.ok(declaration !== undefined);
  assert.equal(program.referencesToDeclaration(declaration).includes(access), true);
});
