import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  TargetSourceProgram,
} from "@tsonic/target-api";
import {
  KindClassDeclaration,
  KindIdentifier,
  KindMethodDeclaration,
  type Kind,
} from "@tsonic/tsts/target-ast";

import { checkedEffectFixture, visit } from "./effect/test-support/fixture.test-support.js";
import {
  createTargetProgramIndex,
} from "./program-index.js";
import { indexedSource, requireKind } from "./program-index.test-support.js";
import { checkedScalarFixture } from "./scalar/scalar.test-support.js";

test("indexes every exact node once and preserves kind order", () => {
  const fixture = checkedEffectFixture(indexedSource);
  const expected: Node[] = [];
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => expected.push(node));
  }

  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });

  assertSameNodes(index.nodes, expected, "node census");
  assertSameNodes(
    index.nodesOfKind(KindIdentifier),
    expected.filter((node) => fixture.source.ast.is.IsIdentifier(node)),
    "identifier partition",
  );
  const mixedKinds = [
    KindMethodDeclaration,
    KindIdentifier,
    KindClassDeclaration,
    KindIdentifier,
  ];
  assertSameNodes(
    index.nodesOfKinds(mixedKinds),
    expected.filter((node) =>
      new Set<Kind>(mixedKinds).has(requireKind(fixture.source, node))
    ),
    "mixed-kind partition",
  );
  assert.equal(index.nodesOfKinds(mixedKinds), index.nodesOfKinds(mixedKinds));
  assert.equal(index.operations.nodeVisits, expected.length);
  assert.equal(index.operations.kindEntries, expected.length);
  assert.equal(
    index.operations.identifierEntries,
    index.nodesOfKind(KindIdentifier).length,
  );
  assert.ok(Object.isFrozen(index));
  assert.ok(Object.isFrozen(index.nodes));
  assert.ok(Object.isFrozen(index.nodesOfKind(KindIdentifier)));
});

test("joins shared binding writes and member dispatch to canonical navigation", () => {
  const fixture = checkedEffectFixture(indexedSource);
  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
  const methods = index.nodesOfKind(KindMethodDeclaration);
  assert.equal(methods.length, 3);
  for (const method of methods) {
    assert.deepEqual(
      index.memberDispatch(method),
      fixture.source.navigation.memberDispatch(method),
    );
  }

  const counterReferences = index.nodesOfKind(KindIdentifier).filter((node) =>
    fixture.source.ast.text(node) === "counter"
  );
  const writes = counterReferences.flatMap((node) =>
    index.bindingWritesAt(node)
  );
  assert.equal(new Set(writes.map((write) => write.operation)).size, 1);
  const reference = counterReferences
    .map((node) => fixture.source.navigation.sourceReferenceFor(node))
    .find((candidate) => candidate?.project === true);
  assert.ok(reference !== undefined);
  assertSameWrites(
    index.bindingWritesFor(reference.declaration),
    fixture.source.navigation.bindingWritesWithin(
      reference.symbol,
      reference.sourceFile,
    ),
    "counter writes",
  );
});

test("exact-joins project references to canonical navigation", () => {
  const fixture = checkedEffectFixture(indexedSource);
  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
  assertProjectReferencesReconcile(fixture.source, index);
});

test("exact-joins aliases, qualified names, properties, and private names", () => {
  const fixture = checkedScalarFixture(
    `import { Models as Domain, create } from "./library.js";
const item: Domain.Box = create();
const shorthand = { item };
export const result = shorthand.item.read();`,
    {
      additionalFiles: {
        "/src/library.ts": `export namespace Models {
  export class Box {
    #value = 1;
    read(): number { return this.#value; }
  }
}
export function create(): Models.Box { return new Models.Box(); }`,
      },
    },
  );
  const index = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
  assertProjectReferencesReconcile(fixture.source, index);
});

test("shared index construction stays linear as independent classes double", () => {
  const small = indexedClassFixture(64);
  const large = indexedClassFixture(128);
  const smallMeasured = measuredIndex(small.source);
  const largeMeasured = measuredIndex(large.source);
  const smallIndex = smallMeasured.index;
  const largeIndex = largeMeasured.index;
  const smallWork = totalOperations(smallIndex.operations);
  const largeWork = totalOperations(largeIndex.operations);

  assert.ok(largeWork < smallWork * 2.2, `${smallWork} -> ${largeWork}`);
  assert.equal(
    largeIndex.nodesOfKind(KindClassDeclaration).length,
    smallIndex.nodesOfKind(KindClassDeclaration).length * 2,
  );
  assert.equal(smallMeasured.heritageQueries, 64);
  assert.equal(largeMeasured.heritageQueries, 128);
  assert.equal(smallMeasured.memberDispatchQueries, 0);
  assert.equal(largeMeasured.memberDispatchQueries, 0);
  const quadraticFoil = (count: number): number => count * count;
  assert.equal(quadraticFoil(128), quadraticFoil(64) * 4);
});

function indexedClassFixture(count: number) {
  const classes = Array.from(
    { length: count },
    (_, index) => `class C${index} { async run(): Promise<number> { return ${index}; } }`,
  ).join("\n");
  return checkedEffectFixture(`${classes}\nexport const count = ${count};`);
}

function measuredIndex(source: TargetSourceProgram) {
  let heritageQueries = 0;
  let memberDispatchQueries = 0;
  const measured: TargetSourceProgram = Object.freeze({
    ...source,
    navigation: Object.freeze({
      ...source.navigation,
      declaredHeritage(declaration: Node) {
        heritageQueries += 1;
        return source.navigation.declaredHeritage(declaration);
      },
      memberDispatch(node: Node | undefined) {
        memberDispatchQueries += 1;
        return source.navigation.memberDispatch(node);
      },
    }),
  });
  const index = createTargetProgramIndex(measured, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
  return { index, heritageQueries, memberDispatchQueries };
}

function totalOperations(operations: {
  readonly nodeVisits: number;
  readonly childEdges: number;
  readonly kindEntries: number;
  readonly identifierEntries: number;
  readonly referenceCandidates: number;
  readonly projectReferences: number;
  readonly bindingCandidates: number;
  readonly bindingWrites: number;
  readonly heritageEdges: number;
  readonly dispatchMembers: number;
}): number {
  return Object.values(operations).reduce((total, count) => total + count, 0);
}

function assertProjectReferencesReconcile(
  source: TargetSourceProgram,
  index: ReturnType<typeof createTargetProgramIndex>,
): void {
  const declarations = new Set<Node>();
  for (const node of index.nodes) {
    const reference = source.navigation.sourceReferenceFor(node);
    if (reference?.project === true) {
      declarations.add(reference.declaration);
    }
  }
  assert.ok(declarations.size > 0);
  let referenceCount = 0;
  for (const declaration of declarations) {
    const expected = source.navigation.referencesToDeclaration(declaration);
    const actual = index.referencesToDeclaration(declaration);
    assertSameNodes(actual, expected, "declaration references");
    referenceCount += actual.length;
  }
  assert.equal(index.operations.projectReferences, referenceCount);
}

function assertSameNodes(
  actual: readonly Node[],
  expected: readonly Node[],
  subject: string,
): void {
  assert.equal(actual.length, expected.length, `${subject} length`);
  for (let index = 0; index < expected.length; index += 1) {
    assert.equal(actual[index], expected[index], `${subject} index ${index}`);
  }
}

function assertSameWrites(
  actual: readonly SourceBindingWrite[],
  expected: readonly SourceBindingWrite[],
  subject: string,
): void {
  assert.equal(actual.length, expected.length, `${subject} length`);
  for (let index = 0; index < expected.length; index += 1) {
    assert.equal(actual[index]?.reference, expected[index]?.reference, `${subject} reference ${index}`);
    assert.equal(actual[index]?.operation, expected[index]?.operation, `${subject} operation ${index}`);
    assert.equal(actual[index]?.kind, expected[index]?.kind, `${subject} kind ${index}`);
  }
}
