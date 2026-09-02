import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsBinaryExpression,
  AsNewExpression,
  AsPropertyAccessExpression,
  IsBinaryExpression,
  IsClassDeclaration,
  IsNewExpression,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  checkedPointerFixture,
  countCallsNamed,
  importModules,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("emits one self-identifying class for retained root allocations", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import {
  allocatePointer,
  equalPointer,
  hashPointer,
  loadPointer,
  storePointer,
} from "./markers.js";

const first: Pointer<{ value: number }> = allocatePointer({ value: 1 });
const alias = first;
const second = allocatePointer({ value: 2 });
storePointer(first, { value: loadPointer(first).value + 1 });
export const result = [
  loadPointer(alias).value,
  equalPointer(first, alias),
  equalPointer(first, second),
  hashPointer(first) === hashPointer(alias),
];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 9);
  assert.deepEqual(importModules(fixture.source, result.sourceFile), [
    "@tsonic/typescript-runtime",
  ]);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "location"), 0);

  const rootClass = classNamed(
    fixture.source,
    result.sourceFile,
    "$RootLocation",
  );
  assert.equal(
    countConstructionsNamed(
      fixture.source,
      result.sourceFile,
      "$RootLocation",
    ),
    2,
  );
  assert.equal(
    assignmentValueKind(
      fixture.source,
      rootClass,
      "storageIdentity",
    ),
    "KindThisKeyword",
  );
  assert.equal(
    assignmentValueKind(fixture.source, rootClass, "storageKey"),
    "KindVoidExpression",
  );
  assert.equal(
    assignmentValueText(fixture.source, rootClass, "value"),
    "initial",
  );
});

test("reserves the root-location class against authored file bindings", () => {
  const fixture = checkedPointerFixture(`
import { allocatePointer } from "./markers.js";

class $RootLocation {}
const first = allocatePointer(1);
const second = allocatePointer(2);
export const result = [$RootLocation, first, second];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  classNamed(fixture.source, result.sourceFile, "$RootLocation");
  classNamed(fixture.source, result.sourceFile, "$RootLocation2");
  assert.equal(
    countConstructionsNamed(
      fixture.source,
      result.sourceFile,
      "$RootLocation2",
    ),
    2,
  );
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "location"), 0);
  assert.deepEqual(importModules(fixture.source, result.sourceFile), []);
});

test("omits the root-location class when no allocation retains it", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
export type NumberPointer = Pointer<number>;
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(
    countClassesNamed(fixture.source, result.sourceFile, "$RootLocation"),
    0,
  );
});

function classNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): Node {
  let found: Node | undefined;
  visit(source, sourceFile, (node) => {
    if (
      IsClassDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === name
    ) {
      assert.equal(found, undefined, `duplicate class '${name}'`);
      found = node;
    }
  });
  assert.ok(found !== undefined, `missing class '${name}'`);
  return found;
}

function countClassesNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (
      IsClassDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === name
    ) {
      count += 1;
    }
  });
  return count;
}

function countConstructionsNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (!IsNewExpression(node)) {
      return;
    }
    const expression = AsNewExpression(node)?.Expression;
    if (expression !== undefined && source.ast.text(expression) === name) {
      count += 1;
    }
  });
  return count;
}

function assignmentValueKind(
  source: TargetSourceProgram,
  root: Node,
  propertyName: string,
): string {
  return source.ast.kindName(assignmentValue(source, root, propertyName));
}

function assignmentValueText(
  source: TargetSourceProgram,
  root: Node,
  propertyName: string,
): string {
  return source.ast.text(assignmentValue(source, root, propertyName));
}

function assignmentValue(
  source: TargetSourceProgram,
  root: Node,
  propertyName: string,
): Node {
  let found: Node | undefined;
  visit(source, root, (node) => {
    if (
      !IsBinaryExpression(node) ||
      source.ast.operatorKindName(node) !== "KindEqualsToken"
    ) {
      return;
    }
    const binary = AsBinaryExpression(node);
    const left = binary?.Left;
    if (
      left === undefined ||
      !IsPropertyAccessExpression(left) ||
      source.ast.text(AsPropertyAccessExpression(left)?.name) !== propertyName
    ) {
      return;
    }
    assert.equal(found, undefined, `duplicate assignment '${propertyName}'`);
    found = binary?.Right;
  });
  assert.ok(found !== undefined, `missing assignment '${propertyName}'`);
  return found;
}
