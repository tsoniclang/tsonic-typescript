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

import { lowerTypedLocations } from "./transform.js";

const markerSemantics = [{
  moduleSpecifier: "./markers.js",
  capabilities: ["call-marker"],
  exports: [
    { kind: "call-marker", exportName: "addressOf", marker: "address-of" },
    { kind: "call-marker", exportName: "equalPointer", marker: "equal-pointer" },
  ],
}] satisfies readonly SourceSemanticsModule[];

const markerDeclarations = `export interface Pointer<T> { value: T }
export declare function addressOf<T>(storage: T): Pointer<T>;
export declare function equalPointer<T>(left: Pointer<T> | undefined, right: Pointer<T> | undefined): boolean;
`;

test("compares repeated property addresses by storage identity", () => {
  const fixture = checkedFixture(`import { addressOf, equalPointer } from "./markers.js";

const record = { value: 10, other: 10 };
export const same = equalPointer(
  addressOf(record.value),
  addressOf(record.value),
);
export const different = equalPointer(
  addressOf(record.value),
  addressOf(record.other),
);
export const nils = equalPointer<number>(undefined, undefined);
`);
  const result = lowerTypedLocations(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 7);
  assert.equal(countCallsNamed(fixture, result.sourceFile, "propertyLocation"), 4);
  assert.equal(countCallsNamed(fixture, result.sourceFile, "sameLocation"), 3);
  assert.equal(countCallsNamed(fixture, result.sourceFile, "equalPointer"), 0);
});

interface CheckedFixture {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}

function checkedFixture(sourceText: string): CheckedFixture {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": sourceText,
      "/src/markers.ts": markerDeclarations,
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
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(checked.extensionDiagnostics, []);
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.navigation.sourceFiles.find(
    (candidate) => source.ast.getFileName(candidate) === "/src/index.ts",
  );
  assert.ok(sourceFile !== undefined);
  return { source, sourceFile };
}

function countCallsNamed(
  fixture: CheckedFixture,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(fixture.source, sourceFile, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const call = AsCallExpression(node);
    if (call?.Expression === undefined) {
      return;
    }
    const expression = call.Expression;
    const property = IsPropertyAccessExpression(expression)
      ? AsPropertyAccessExpression(expression)
      : undefined;
    const actual = property?.name === undefined
      ? fixture.source.ast.text(expression)
      : fixture.source.ast.text(property.name);
    if (actual === name) {
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
