import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../program-index.js";
import { checkedEffectFixture } from "../test-support/fixture.test-support.js";

test("does not rebuild or facade the source-owned reference graph", () => {
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
  let directQueries = 0;
  let reverseQueries = 0;
  const source = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      sourceReferenceFor(node: Node | undefined) {
        directQueries += 1;
        return fixture.source.navigation.sourceReferenceFor(node);
      },
      referencesToDeclaration(declaration: Node) {
        reverseQueries += 1;
        return fixture.source.navigation.referencesToDeclaration(declaration);
      },
    }),
  });

  const program = createTargetProgramIndex(source, {
    bindingWrites: false,
    memberDispatch: false,
  });
  assert.equal(directQueries, 0);
  assert.equal(reverseQueries, 0);
  assert.deepEqual(
    program.operations.sourceReferenceIndex,
    fixture.source.navigation.referenceIndexStatistics,
  );
  assert.equal("declarationReferenceFor" in program, false);
  assert.equal("referencesToDeclaration" in program, false);
});

test("forbids every superseded target-owned reference-index shape", () => {
  const forbidden = [
    /createProjectDeclarationReferenceIndex/u,
    /declarationReferenceFor\s*\(/u,
    /referencesByDeclaration/u,
    /declarationsBySymbol/u,
    /projectReferences/u,
    /referenceCandidates/u,
  ];
  const production = productionTypeScriptFiles(join(process.cwd(), "src"));
  assert.ok(production.length > 100);
  for (const path of production) {
    const source = readFileSync(path, "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${path}: ${pattern.source}`);
    }
  }
  assert.equal(
    forbidden.some((pattern) =>
      pattern.test("createProjectDeclarationReferenceIndex(referenceCandidates)")
    ),
    true,
  );
});

test("requires declaration-bounded reference consumers", () => {
  const consumers = [
    "src/lowering/effect/flow/callable/input-reference.ts",
    "src/lowering/effect/flow/callable/value-inputs.ts",
    "src/lowering/effect/flow/storage/owners.ts",
  ];
  for (const path of consumers) {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    assert.match(source, /referencesToDeclaration\s*\(/u, path);
    assert.doesNotMatch(source, /nodesOfKind\(KindIdentifier\)/u, path);
    assert.doesNotMatch(
      source,
      /nodesOfKinds\(\[[\s\S]{0,160}KindIdentifier/u,
      path,
    );
  }
  assert.match(
    "program.nodesOfKind(KindIdentifier)",
    /nodesOfKind\(KindIdentifier\)/u,
  );
});

function productionTypeScriptFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return productionTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test-support.ts")
      ? [path]
      : [];
  });
}
