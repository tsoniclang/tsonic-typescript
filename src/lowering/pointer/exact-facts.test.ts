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
  AsAsExpression,
  AsImportClause,
  AsImportDeclaration,
  AsNamedImports,
  AsQualifiedName,
  AsTypeReferenceNode,
  IsAsExpression,
  IsImportClause,
  IsImportDeclaration,
  IsNamedImports,
  IsQualifiedName,
  IsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";
import { createTargetSourceProgram } from "@tsonic/target-api";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { lowerPointers } from "./transform.js";

const markerModule = "./markers.js";
const markerSemantics = [{
  moduleSpecifier: markerModule,
  capabilities: ["type-marker", "call-marker"],
  exports: [
    { kind: "type-marker", exportName: "Pointer", marker: "pointer" },
    { kind: "call-marker", exportName: "loadPointer", marker: "load" },
  ],
}] satisfies readonly SourceSemanticsModule[];

const markerDeclarations = `export interface Pointer<T> { value: T }
export declare function loadPointer<T>(pointer: Pointer<T>): T;
export declare const ordinary: number;
`;

test("preserves explicit pointer result typing across control-flow opaque expressions", () => {
  const fixture = checkedFixture(`import type { Pointer } from "./markers.js";
import { loadPointer } from "./markers.js";

interface Box { value: number }
declare function fail(): never;
let pointer: Pointer<Box> | undefined = undefined;
export const value = loadPointer<Box>(pointer ?? fail()).value;
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);
  const assertions: Node[] = [];
  visit(fixture.source, result.sourceFile, (node) => {
    if (IsAsExpression(node)) {
      assertions.push(node);
    }
  });

  assert.equal(assertions.length, 1);
  const assertionType = AsAsExpression(assertions[0])?.Type;
  assert.equal(
    qualifiedTypeName(fixture.source, assertionType),
    "tsonicTypeScriptRuntime.Location",
  );
});

test("removes exact unused pointer markers without adding the target runtime", () => {
  const fixture = checkedFixture(`import { loadPointer, ordinary } from "./markers.js";

export const value = ordinary;
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.operationCount, 0);
  assert.equal(result.runtimeAlias, undefined);
  assert.deepEqual(
    namedImportBindings(fixture.source, result.sourceFile, markerModule),
    ["ordinary"],
  );
  assert.deepEqual(importModules(fixture.source, result.sourceFile), [
    markerModule,
  ]);
});

function checkedFixture(sourceText: string): {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
} {
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
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.navigation.sourceFiles.find(
    (candidate) => source.ast.getFileName(candidate) === "/src/index.ts",
  );
  assert.ok(sourceFile !== undefined);
  return { source, sourceFile };
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

function qualifiedTypeName(
  source: TargetSourceProgram,
  node: Node | undefined,
): string {
  assert.ok(node !== undefined && IsTypeReferenceNode(node));
  const reference = AsTypeReferenceNode(node);
  assert.ok(reference?.TypeName !== undefined);
  return entityName(source, reference.TypeName);
}

function entityName(source: TargetSourceProgram, node: Node): string {
  if (!IsQualifiedName(node)) {
    return source.ast.text(node);
  }
  const qualified = AsQualifiedName(node);
  assert.ok(qualified?.Left !== undefined && qualified.Right !== undefined);
  return `${entityName(source, qualified.Left)}.${entityName(source, qualified.Right)}`;
}

function importModules(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly string[] {
  return (sourceFile.Statements?.Nodes ?? []).flatMap((statement) => {
    if (!IsImportDeclaration(statement)) {
      return [];
    }
    const declaration = AsImportDeclaration(statement);
    return declaration?.ModuleSpecifier === undefined
      ? []
      : [source.ast.text(declaration.ModuleSpecifier)];
  });
}

function namedImportBindings(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  moduleName: string,
): readonly string[] {
  for (const statement of sourceFile.Statements?.Nodes ?? []) {
    if (!IsImportDeclaration(statement)) {
      continue;
    }
    const declaration = AsImportDeclaration(statement);
    if (
      declaration?.ModuleSpecifier === undefined ||
      source.ast.text(declaration.ModuleSpecifier) !== moduleName ||
      declaration.ImportClause === undefined ||
      !IsImportClause(declaration.ImportClause)
    ) {
      continue;
    }
    const clause = AsImportClause(declaration.ImportClause);
    if (
      clause?.NamedBindings === undefined ||
      !IsNamedImports(clause.NamedBindings)
    ) {
      return [];
    }
    const named = AsNamedImports(clause.NamedBindings);
    return Object.freeze((named?.Elements?.Nodes ?? []).map((element) =>
      source.ast.text(source.ast.name(element))
    ));
  }
  return [];
}
