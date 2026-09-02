import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AsIndexedAccessTypeNode,
  AsLiteralTypeNode,
  AsTypeReferenceNode,
  IsIndexedAccessTypeNode,
  IsLiteralTypeNode,
  IsStringLiteral,
  IsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";

import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  variableDeclarationNamed,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("stabilizes an exact mutable-cell member inference with an indexed type", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class TupleType { constructor(public elementInfos: readonly number[]) {} }
const tuple: Pointer<TupleType> = allocatePointer(new TupleType([1]));
storePointer(tuple, new TupleType([2]));
const elementInfos = loadPointer<TupleType>(tuple).elementInfos;
export const result = elementInfos[0];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const result = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assert.equal(result.inferenceStabilizationCount, 1);
  const declaration = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "elementInfos",
  );
  assert.ok(IsIndexedAccessTypeNode(declaration.Type));
  const indexed = AsIndexedAccessTypeNode(declaration.Type);
  assert.ok(indexed !== undefined && IsTypeReferenceNode(indexed.ObjectType));
  const object = AsTypeReferenceNode(indexed.ObjectType);
  assert.equal(fixture.source.ast.text(object?.TypeName), "TupleType");
  assert.ok(indexed !== undefined && IsLiteralTypeNode(indexed.IndexType));
  const literal = AsLiteralTypeNode(indexed.IndexType)?.Literal;
  assert.ok(literal !== undefined && IsStringLiteral(literal));
  assert.equal(fixture.source.ast.text(literal), "elementInfos");
});

test("does not annotate canonical, immutable, or already typed member inference", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const pointer: Pointer<Box> = allocatePointer(new Box(1));
const inferred = loadPointer<Box>(pointer).value;
const typed: number = loadPointer<Box>(pointer).value;
export const result = inferred + typed;
`);
  const directPlan = createFixturePointerFlowPlan(fixture.source);
  const direct = lowerPointers(fixture.source, fixture.sourceFile, directPlan);
  assert.equal(direct.inferenceStabilizationCount, 0);
  assert.equal(
    variableDeclarationNamed(fixture.source, direct.sourceFile, "inferred").Type,
    undefined,
  );

  const canonical = lowerPointers(fixture.source, fixture.sourceFile);
  assert.equal(canonical.inferenceStabilizationCount, 0);
  assert.equal(
    variableDeclarationNamed(fixture.source, canonical.sourceFile, "inferred").Type,
    undefined,
  );
  assert.ok(
    variableDeclarationNamed(fixture.source, canonical.sourceFile, "typed").Type !==
      undefined,
  );
});
