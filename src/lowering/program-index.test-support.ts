import assert from "node:assert/strict";

import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindElementAccessExpression,
  KindGetAccessor,
  KindIdentifier,
  KindMethodDeclaration,
  KindPropertyAccessExpression,
  KindPropertyDeclaration,
  KindSetAccessor,
  type Kind,
} from "@tsonic/tsts/target-ast";

import { visit } from "./effect/test-support/fixture.test-support.js";
import type { TargetProgramIndex } from "./program-index.js";

export const indexedSource = `
class Base {
  async replaced(): Promise<number> { return 1; }
  async stable(): Promise<number> { return 2; }
}
class Derived extends Base {
  override async replaced(): Promise<number> { return 3; }
}
let counter = 0;
counter += 1;
export { Base, Derived, counter };
`;

export function assertNodeIndexReconciles(
  source: TargetSourceProgram,
  index: TargetProgramIndex,
): void {
  const expected: Node[] = [];
  let identifierEntries = 0;
  assertSameNodes(index.sourceFiles, source.navigation.sourceFiles, "source-file census");
  for (const sourceFile of source.navigation.sourceFiles) {
    const fileNodes: Node[] = [];
    const identifierNames = new Set<string>();
    visit(source, sourceFile, (node) => {
      expected.push(node);
      fileNodes.push(node);
      if (source.ast.is.IsIdentifier(node)) {
        identifierEntries += 1;
        identifierNames.add(source.ast.text(node));
      }
    });
    assertSameNodes(
      index.nodesFor(sourceFile),
      fileNodes,
      "source-file partition",
    );
    for (const name of identifierNames) {
      assert.equal(
        index.hasAuthoredIdentifierName(sourceFile, name),
        true,
        `authored identifier '${name}' is absent from its source-file name index`,
      );
    }
    assert.equal(
      index.authoredIdentifierNameCount(sourceFile),
      identifierNames.size,
      "authored identifier unique-name count",
    );
    const absent = "__tsonic_absent_authored_identifier_7d43d68b";
    assert.equal(identifierNames.has(absent), false);
    assert.equal(
      index.hasAuthoredIdentifierName(sourceFile, absent),
      false,
      "absent authored-identifier foil was admitted",
    );
  }
  assert.equal(
    index.operations.identifierEntries,
    identifierEntries,
    "identifier entry operation count",
  );
  assertSameNodes(index.nodes, expected, "node census");
  const kinds = new Set(expected.map((node) => requireKind(source, node)));
  for (const kind of kinds) {
    assertSameNodes(
      index.nodesOfKind(kind),
      expected.filter((node) => requireKind(source, node) === kind),
      "kind partition",
    );
  }
}

export function assertBindingWritesReconcile(
  source: TargetSourceProgram,
  index: TargetProgramIndex,
): void {
  const declarations = new Map<Node, ReturnType<
    TargetSourceProgram["navigation"]["sourceReferenceFor"]
  >>();
  for (const node of index.nodesOfKinds([
    KindIdentifier,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    const reference = source.navigation.sourceReferenceFor(node);
    if (reference === undefined) {
      continue;
    }
    declarations.set(reference.declaration, reference);
    assertSameWrites(
      index.bindingWritesAt(node),
      source.navigation.bindingWritesWithin(reference.symbol, node),
      `binding writes at ${describeNode(source, node)}`,
    );
  }
  for (const [declaration, reference] of declarations) {
    assert.ok(reference !== undefined);
    const expected = source.navigation.sourceFiles.flatMap((sourceFile) =>
      source.navigation.bindingWritesWithin(reference.symbol, sourceFile)
    );
    assertSameWrites(
      index.bindingWritesFor(declaration),
      expected,
      `binding writes for ${describeNode(source, declaration)}`,
    );
  }
}

export function assertDispatchReconciles(
  source: TargetSourceProgram,
  index: TargetProgramIndex,
): void {
  for (const member of index.nodesOfKinds([
    KindMethodDeclaration,
    KindGetAccessor,
    KindSetAccessor,
    KindPropertyDeclaration,
  ])) {
    const actual = index.memberDispatch(member);
    const expected = source.navigation.memberDispatch(member);
    assert.equal(
      actual?.overridesBase,
      expected?.overridesBase,
      `member dispatch overridesBase for ${describeNode(source, member)}`,
    );
    assert.equal(
      actual?.hasDerivedOverride,
      expected?.hasDerivedOverride,
      `member dispatch hasDerivedOverride for ${describeNode(source, member)}`,
    );
  }
}

export function requireKind(source: TargetSourceProgram, node: Node): Kind {
  const kind = source.ast.kind(node);
  assert.ok(kind !== undefined);
  return kind;
}

function describeNode(source: TargetSourceProgram, node: Node): string {
  return source.ast.kindName(node);
}

function assertSameNodes(
  actual: readonly Node[],
  expected: readonly Node[],
  subject: string,
): void {
  if (actual.length !== expected.length) {
    throw new Error(`${subject} length ${actual.length}, expected ${expected.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(`${subject} differs at preorder index ${index}`);
    }
  }
}

function assertSameWrites(
  actual: readonly import("@tsonic/target-api").SourceBindingWrite[],
  expected: readonly import("@tsonic/target-api").SourceBindingWrite[],
  subject: string,
): void {
  if (actual.length !== expected.length) {
    throw new Error(`${subject} length ${actual.length}, expected ${expected.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = actual[index];
    const right = expected[index];
    if (
      left?.reference !== right?.reference ||
      left?.operation !== right?.operation ||
      left?.kind !== right?.kind
    ) {
      throw new Error(`${subject} differs at write index ${index}`);
    }
  }
}
