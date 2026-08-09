import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCompilerSessionFromFiles,
  createSourceSemanticsExtension,
} from "@tsonic/tsts";
import type {
  Node,
  SourceFile,
  SourceSemanticsModule,
} from "@tsonic/tsts";
import {
  AsCallExpression,
  AsPropertyAccessExpression,
  IsCallExpression,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import { createTargetSourceProgram } from "@tsonic/target-api";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { lowerPointers } from "./transform.js";

const markerSemantics = [{
  moduleSpecifier: "./markers.js",
  capabilities: ["call-marker"],
  exports: [
    { kind: "call-marker", exportName: "addressOf", marker: "address-of" },
    { kind: "call-marker", exportName: "allocatePointer", marker: "allocate" },
    { kind: "call-marker", exportName: "loadPointer", marker: "load" },
    { kind: "call-marker", exportName: "storePointer", marker: "store" },
  ],
}] satisfies readonly SourceSemanticsModule[];

const markerDeclarations = `export interface Pointer<T> { value: T }
export declare function addressOf<T>(storage: T): Pointer<T>;
export declare function allocatePointer<T>(initial: T): Pointer<T>;
export declare function loadPointer<T>(pointer: Pointer<T>): T;
export declare function storePointer<T>(pointer: Pointer<T>, value: T): void;
`;

test("interior value-field locations follow whole-root replacement", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer, storePointer } from "./markers.js";

let record = { inner: { value: 1 } };
const field = addressOf(record.inner.value);
record = { inner: { value: 2 } };
storePointer(field, 3);
export const result = [record.inner.value, loadPointer(field)];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 1);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 0);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    2,
  );
});

test("interior value-element locations follow whole-root replacement", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer, storePointer } from "./markers.js";

let values = [1];
const element = addressOf(values[0]);
values = [2];
storePointer(element, 3);
export const result = [values[0], loadPointer(element)];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 1);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 0);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    1,
  );
});

test("mixed element and field paths follow whole-root replacement", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer, storePointer } from "./markers.js";

let records = [{ value: 1 }];
const field = addressOf(records[0].value);
records = [{ value: 2 }];
storePointer(field, 3);
export const result = [records[0].value, loadPointer(field)];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 1);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 0);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    2,
  );
});

test("interior pointer-root locations retain the selected pointee", () => {
  const fixture = checkedFixture(`import { addressOf, allocatePointer, loadPointer, storePointer } from "./markers.js";

let selected = allocatePointer({ value: 1 });
const original = selected;
const field = addressOf(loadPointer(selected).value);
selected = allocatePointer({ value: 2 });
storePointer(field, 3);
export const result = [loadPointer(original).value, loadPointer(selected).value];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 0);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 0);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    1,
  );
});

test("interior pointer-root locations follow pointee replacement", () => {
  const fixture = checkedFixture(`import { addressOf, allocatePointer, loadPointer, storePointer } from "./markers.js";

const selected = allocatePointer({ value: 1 });
const field = addressOf(loadPointer(selected).value);
storePointer(selected, { value: 2 });
storePointer(field, 3);
export const result = [loadPointer(selected).value, loadPointer(field)];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 0);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 0);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    1,
  );
});

test("interior external-property locations follow property replacement", () => {
  const fixture = checkedFixture(
    `import { addressOf, loadPointer, storePointer } from "./markers.js";
import { state } from "./state.js";

const field = addressOf(state.record.inner.value);
state.record = { inner: { value: 2 } };
storePointer(field, 3);
export const result = [state.record.inner.value, loadPointer(field)];
`,
    {
      "/src/state.ts": "export const state = { record: { inner: { value: 1 } } };\n",
    },
  );
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 0);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 1);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    2,
  );
});

test("immutable roots use direct locations while mutable child paths stay live", () => {
  const fixture = checkedFixture(`import { addressOf, loadPointer, storePointer } from "./markers.js";

const record = { inner: { value: 1 } };
const field = addressOf(record.inner.value);
record.inner = { value: 2 };
storePointer(field, 3);
export const result = [record.inner.value, loadPointer(field)];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 0);
  assert.equal(countRuntimeCalls(fixture, result.sourceFile, "propertyLocation"), 1);
  assert.equal(
    countRuntimeCalls(fixture, result.sourceFile, "nestedPropertyLocation"),
    1,
  );
});

interface CheckedFixture {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}

function checkedFixture(
  sourceText: string,
  additionalFiles: Readonly<Record<string, string>> = {},
): CheckedFixture {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": sourceText,
      "/src/markers.ts": markerDeclarations,
      ...additionalFiles,
    },
    rootFiles: ["/src/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: [createSourceSemanticsExtension({ modules: markerSemantics })],
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.navigation.sourceFiles.find(
    (candidate) => source.ast.getFileName(candidate) === "/src/index.ts",
  );
  assert.ok(sourceFile !== undefined);
  return { source, sourceFile };
}

function countRuntimeCalls(
  fixture: CheckedFixture,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(fixture.source, sourceFile, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const target = AsCallExpression(node)?.Expression;
    const property = target !== undefined && IsPropertyAccessExpression(target)
      ? AsPropertyAccessExpression(target)
      : undefined;
    if (property?.name !== undefined && fixture.source.ast.text(property.name) === name) {
      count += 1;
    }
  });
  return count;
}

function visit(
  source: TargetSourceProgram,
  root: Node,
  callback: (node: Node) => void,
): void {
  callback(root);
  for (const child of source.ast.children(root)) {
    if (child !== undefined) {
      visit(source, child, callback);
    }
  }
}
