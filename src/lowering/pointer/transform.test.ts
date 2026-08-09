import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  AsBinaryExpression,
  AsCallExpression,
  AsExpressionStatement,
  AsImportClause,
  AsImportDeclaration,
  AsPropertyAccessExpression,
  AsQualifiedName,
  AsParameterDeclaration,
  AsTypeReferenceNode,
  encodeTargetSourceFileForPrinting,
  IsArrowFunction,
  IsBinaryExpression,
  IsCallExpression,
  IsExpressionStatement,
  IsFunctionDeclaration,
  IsImportClause,
  IsImportDeclaration,
  IsPropertyAccessExpression,
  IsQualifiedName,
  IsStringLiteral,
  IsTypeReferenceNode,
  KindTypeKeyword,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedPointerFixture as checkedFixture,
  containsNode,
  importModules,
  namedImportBindings,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("lowers exact pointer facts on the checked TS-Go AST", () => {
  const fixture = checkedFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";

function increment(pointer: Pointer<number>): void {
  storePointer(pointer, loadPointer(pointer) + 1);
}

const pointer = allocatePointer<number>(10);
increment(pointer);
console.log(loadPointer(pointer));
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 4);
  assert.equal(result.pointerTypeCount, 1);
  assert.equal(result.locationBindingCount, 0);
  assert.equal(result.runtimeAlias, "tsonicTypeScriptRuntime");
  assert.deepEqual(importModules(fixture.source, result.sourceFile), [
    "@tsonic/typescript-runtime",
  ]);
  assert.equal(countTypeReferencesNamed(fixture.source, result.sourceFile, "Location"), 1);
  assert.equal(countPropertyAccessesNamed(fixture.source, result.sourceFile, "value"), 3);
  assert.equal(countBinaryAssignments(fixture.source, result.sourceFile), 1);
  assert.ok(encodeTargetSourceFileForPrinting(result.sourceFile).byteLength > 0);
});

test("preserves an addressed local value and binds one live location companion", () => {
  const fixture = checkedFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, storePointer } from "./markers.js";

function increment(pointer: Pointer<number>): void {
  storePointer(pointer, loadPointer(pointer) + 1);
}

export function run(): [number, number, { value: number }] {
  let value: number = 10;
  const alias = addressOf(value);
  increment(alias);
  value += 1;
  return [value, loadPointer(alias), { value }];
}
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 1);
  const valueDeclaration = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "value",
  );
  assert.equal(
    fixture.source.ast.kindName(valueDeclaration.Type),
    "KindNumberKeyword",
  );
  assert.equal(fixture.source.ast.text(valueDeclaration.Initializer), "10");
  const locationDeclaration = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "value$location",
  );
  assert.equal(
    callName(fixture.source, locationDeclaration.Initializer),
    "tsonicTypeScriptRuntime.boundLocation",
  );
  assert.equal(
    countPropertyAccessesNamed(fixture.source, result.sourceFile, "value"),
    3,
  );
});

test("preserves a public parameter while binding its live location flow", () => {
  const fixture = checkedFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, storePointer } from "./markers.js";

export function update(
  value: number,
  value$location: string,
): [number, number, string] {
  const pointer: Pointer<number> = addressOf(value);
  value += 1;
  storePointer(pointer, loadPointer(pointer) + 1);
  return [value, loadPointer(pointer), value$location];
}
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 1);
  const location = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "value$location2",
  );
  assert.equal(
    callName(fixture.source, location.Initializer),
    "tsonicTypeScriptRuntime.boundLocation",
  );
  assert.equal(
    countPropertyAccessesNamed(fixture.source, result.sourceFile, "value"),
    3,
  );
});

test("keeps parameter defaults outside the promoted body", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer } from "./markers.js";

export function read(value: number, before = value): [number, number] {
  const pointer = addressOf(value);
  value += 1;
  return [before, loadPointer(pointer)];
}
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);
  const declaration = functionDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "read",
  );
  const defaultValue = AsParameterDeclaration(
    fixture.source.ast.parameters(declaration)[1],
  )?.Initializer;
  assert.ok(defaultValue !== undefined);
  assert.equal(fixture.source.ast.text(defaultValue), "value");
});

test("inserts parameter locations after directive prologues", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer } from "./markers.js";

export function read(value: number): number {
  "use strict";
  const pointer = addressOf(value);
  return loadPointer(pointer);
}
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);
  const declaration = functionDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "read",
  );
  const body = fixture.source.ast.body(declaration);
  assert.ok(body !== undefined);
  const statements = fixture.source.ast.statements(body);
  const first = statements[0];
  assert.ok(first !== undefined && IsExpressionStatement(first));
  const directive = AsExpressionStatement(first)?.Expression;
  assert.ok(directive !== undefined && IsStringLiteral(directive));
  assert.equal(fixture.source.ast.text(directive), "use strict");
  const location = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "value$location",
  );
  assert.equal(
    callName(fixture.source, location.Initializer),
    "tsonicTypeScriptRuntime.boundLocation",
  );
  assert.ok(statements[1] !== undefined);
  assert.ok(containsNode(fixture.source, statements[1], location));
});

test("binds addressed parameters in expression-bodied arrows", () => {
  const fixture = checkedFixture(`import { addressOf, storePointer } from "./markers.js";

export const update = (value: number, before = value): [number, number] =>
  (storePointer(addressOf(value), value + 1), [before, value]);
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);
  const declaration = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "update",
  );
  assert.ok(declaration.Initializer !== undefined);
  assert.ok(IsArrowFunction(declaration.Initializer));
  const body = fixture.source.ast.body(declaration.Initializer);
  assert.ok(body !== undefined && fixture.source.ast.is.IsBlock(body));
  assert.equal(result.locationBindingCount, 1);
});

test("addresses properties and elements without reevaluating bases or keys", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer, storePointer } from "./markers.js";

const record = { value: 10 };
const values = [20];
const field = addressOf(record.value);
const element = addressOf(values[0]);
storePointer(field, loadPointer(element));
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(
    countCallsNamed(fixture.source, result.sourceFile, "propertyLocation"),
    2,
  );
  assert.equal(
    countCallsNamed(fixture.source, result.sourceFile, "nestedPropertyLocation"),
    0,
  );
});

test("does not lower a same-spelled local function", () => {
  const fixture = checkedFixture(`import { allocatePointer } from "./markers.js";

function loadPointer(value: number): number { return value + 1; }
const pointer = allocatePointer(10);
export const result = loadPointer(10);
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 1);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "loadPointer"), 1);
});

test("retains a selected namespace import when ordinary members still use it", () => {
  const fixture = checkedFixture(`import * as markers from "./markers.js";

const pointer = markers.allocatePointer(10);
export const ordinary = markers.ordinary;
export const value = markers.loadPointer(pointer);
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 2);
  assert.deepEqual(importModules(fixture.source, result.sourceFile), [
    "@tsonic/typescript-runtime",
    "./markers.js",
  ]);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "loadPointer"), 0);
});

test("removes only selected marker specifiers from a mixed named import", () => {
  const fixture = checkedFixture(`import { allocatePointer, ordinary } from "./markers.js";

const pointer = allocatePointer(10);
export const value = ordinary;
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.deepEqual(
    namedImportBindings(fixture.source, result.sourceFile, "./markers.js"),
    ["ordinary"],
  );
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"), 0);
});

test("selects a collision-free runtime namespace", () => {
  const fixture = checkedFixture(`import { allocatePointer } from "./markers.js";

const tsonicTypeScriptRuntime = "source binding";
const pointer = allocatePointer(10);
export const value = [tsonicTypeScriptRuntime, pointer];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.runtimeAlias, "tsonicTypeScriptRuntime2");
});

test("uses a type-only runtime import when only Pointer<T> is lowered", () => {
  const fixture = checkedFixture(`import type { Pointer } from "./markers.js";

export type NumberPointer = Pointer<number>;
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 0);
  assert.equal(result.pointerTypeCount, 1);
  assert.equal(
    runtimeImportPhase(fixture.source, result.sourceFile),
    KindTypeKeyword,
  );
});

function functionDeclarationNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
) {
  let found: Node | undefined;
  visit(source, sourceFile, (node) => {
    if (!IsFunctionDeclaration(node)) {
      return;
    }
    if (source.ast.text(source.ast.name(node)) === name) {
      found = node;
    }
  });
  assert.ok(found !== undefined);
  return found;
}

function runtimeImportPhase(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): number | undefined {
  for (const statement of sourceFile.Statements?.Nodes ?? []) {
    if (!IsImportDeclaration(statement)) {
      continue;
    }
    const declaration = AsImportDeclaration(statement);
    if (
      declaration?.ModuleSpecifier === undefined ||
      source.ast.text(declaration.ModuleSpecifier) !==
        "@tsonic/typescript-runtime" ||
      declaration.ImportClause === undefined ||
      !IsImportClause(declaration.ImportClause)
    ) {
      continue;
    }
    const clause = AsImportClause(declaration.ImportClause);
    return clause?.PhaseModifier;
  }
  return undefined;
}

function countTypeReferencesNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (!IsTypeReferenceNode(node)) {
      return;
    }
    const reference = AsTypeReferenceNode(node);
    if (
      reference?.TypeName !== undefined &&
      entityName(source, reference.TypeName).endsWith(name)
    ) {
      count += 1;
    }
  });
  return count;
}

function countPropertyAccessesNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (!IsPropertyAccessExpression(node)) {
      return;
    }
    const access = AsPropertyAccessExpression(node);
    if (access !== undefined && source.ast.text(access.name) === name) {
      count += 1;
    }
  });
  return count;
}

function countBinaryAssignments(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (
      IsBinaryExpression(node) &&
      AsBinaryExpression(node) !== undefined &&
      source.ast.operatorKindName(node) === "KindEqualsToken"
    ) {
      count += 1;
    }
  });
  return count;
}

function countCallsNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const call = AsCallExpression(node);
    if (call !== undefined && callName(source, node).endsWith(name)) {
      count += 1;
    }
  });
  return count;
}

function qualifiedTypeName(
  source: TargetSourceProgram,
  node: Node | undefined,
): string {
  assert.ok(node !== undefined && IsTypeReferenceNode(node));
  const reference = AsTypeReferenceNode(node);
  assert.ok(reference?.TypeName !== undefined);
  return entityName(source, reference.TypeName);
}

function callName(source: TargetSourceProgram, node: Node | undefined): string {
  assert.ok(node !== undefined && IsCallExpression(node));
  const call = AsCallExpression(node);
  assert.ok(call?.Expression !== undefined);
  if (!IsPropertyAccessExpression(call.Expression)) {
    return source.ast.text(call.Expression);
  }
  const property = AsPropertyAccessExpression(call.Expression);
  assert.ok(property?.Expression !== undefined && property.name !== undefined);
  return `${source.ast.text(property.Expression)}.${source.ast.text(property.name)}`;
}

function entityName(source: TargetSourceProgram, node: Node): string {
  if (!IsQualifiedName(node)) {
    return source.ast.text(node);
  }
  const qualified = AsQualifiedName(node);
  assert.ok(qualified?.Left !== undefined && qualified.Right !== undefined);
  return `${entityName(source, qualified.Left)}.${entityName(source, qualified.Right)}`;
}
