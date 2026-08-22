import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindGetAccessor,
  KindMethodDeclaration,
  KindPropertyDeclaration,
  KindSetAccessor,
} from "@tsonic/tsts/target-ast";

import { checkedEffectFixture } from "./effect/test-support/fixture.test-support.js";
import { createTargetProgramIndex } from "./program-index.js";
import {
  assertDispatchReconciles,
  indexedSource,
} from "./program-index.test-support.js";

test("batch member dispatch exactly matches canonical navigation", () => {
  const fixture = checkedEffectFixture(`
import { Base } from "./base.js";
export class Middle extends Base {
  override replaced(): number { return 2; }
  override get value(): number { return 2; }
  override set value(next: number) { void next; }
  override field = 2;
}
export declare class Leaf extends Middle {
  override replaced(): number;
}
`, {
    "/src/base.ts": `
import { External } from "./external.js";
const dynamicName = "dynamic";
export class Base extends External {
  replaced(): number { return 1; }
  stable(): number { return 1; }
  get value(): number { return 1; }
  set value(next: number) { void next; }
  field = 1;
  static staticOnly(): number { return 1; }
  private hidden(): number { return 1; }
  [dynamicName](): number { return 1; }
  "literal"(): number { return 1; }
  7(): number { return 1; }
  overloaded(value: string): string;
  overloaded(value: number): number;
  overloaded(value: string | number): string | number { return value; }
}
`,
    "/src/external.d.ts": `
export declare class External { replaced(): number; }
`,
  });
  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: true,
  });
  const members = index.nodesOfKinds([
    KindMethodDeclaration,
    KindGetAccessor,
    KindSetAccessor,
    KindPropertyDeclaration,
  ]);
  assert.ok(members.length >= 16);
  assertDispatchReconciles(fixture.source, index);
});

test("disabled facets perform zero semantic queries", () => {
  const fixture = checkedEffectFixture(indexedSource);
  let writeQueries = 0;
  let heritageQueries = 0;
  let referenceQueries = 0;
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      bindingWritesWithin(symbol: Symbol, root: Node) {
        writeQueries += 1;
        return fixture.source.navigation.bindingWritesWithin(symbol, root);
      },
      declaredHeritage(declaration: Node) {
        heritageQueries += 1;
        return fixture.source.navigation.declaredHeritage(declaration);
      },
      sourceReferenceFor(node: Node | undefined) {
        referenceQueries += 1;
        return fixture.source.navigation.sourceReferenceFor(node);
      },
    }),
  });
  const index = createTargetProgramIndex(source, {
    bindingWrites: false,
    memberDispatch: false,
  });

  assert.equal(writeQueries, 0);
  assert.equal(heritageQueries, 0);
  assert.equal(referenceQueries, 0);
  assert.equal(index.operations.bindingCandidates, 0);
  assert.equal(index.operations.bindingWrites, 0);
  assert.equal(index.operations.heritageEdges, 0);
  assert.equal(index.operations.dispatchMembers, 0);
  assert.deepEqual(
    index.operations.sourceReferenceIndex,
    fixture.source.navigation.referenceIndexStatistics,
  );
  assert.equal("declarationReferenceFor" in index, false);
  assert.equal("referencesToDeclaration" in index, false);
});
