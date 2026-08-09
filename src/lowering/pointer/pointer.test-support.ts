import assert from "node:assert/strict";

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
  AsExportDeclaration,
  AsImportClause,
  AsImportDeclaration,
  AsNamedImports,
  AsPropertyAccessExpression,
  AsVariableDeclaration,
  IsCallExpression,
  IsExportDeclaration,
  IsImportClause,
  IsImportDeclaration,
  IsNamedImports,
  IsPropertyAccessExpression,
  IsVariableDeclaration,
} from "@tsonic/tsts/target-ast";
import { createTargetSourceProgram } from "@tsonic/target-api";
import type { TargetSourceProgram } from "@tsonic/target-api";

export const pointerMarkerModule = "./markers.js";

const pointerMarkerSemantics = [{
  moduleSpecifier: pointerMarkerModule,
  capabilities: ["type-marker", "call-marker"],
  exports: [
    { kind: "type-marker", exportName: "Pointer", marker: "pointer" },
    { kind: "type-marker", exportName: "RawPointer", marker: "raw-pointer" },
    { kind: "call-marker", exportName: "addressOf", marker: "address-of" },
    { kind: "call-marker", exportName: "allocatePointer", marker: "allocate" },
    { kind: "call-marker", exportName: "loadPointer", marker: "load" },
    { kind: "call-marker", exportName: "storePointer", marker: "store" },
    { kind: "call-marker", exportName: "equalPointer", marker: "equal-pointer" },
    { kind: "call-marker", exportName: "hashPointer", marker: "hash-pointer" },
    { kind: "call-marker", exportName: "bindPointer", marker: "bind-pointer" },
    { kind: "call-marker", exportName: "projectPointer", marker: "project-pointer" },
    { kind: "call-marker", exportName: "bindRawPointer", marker: "bind-raw-pointer" },
    { kind: "call-marker", exportName: "equalRawPointer", marker: "equal-raw-pointer" },
    { kind: "call-marker", exportName: "hashRawPointer", marker: "hash-raw-pointer" },
  ],
}] satisfies readonly SourceSemanticsModule[];

const pointerMarkerDeclarations = `export interface Pointer<T> { value: T }
export interface RawPointer { readonly identity: unique symbol }
export declare function addressOf<T>(storage: T): Pointer<T>;
export declare function allocatePointer<T>(initial: T): Pointer<T>;
export declare function loadPointer<T>(pointer: Pointer<T>): T;
export declare function storePointer<T>(pointer: Pointer<T>, value: T): void;
export declare function equalPointer<T>(left: Pointer<T> | undefined, right: Pointer<T> | undefined): boolean;
export declare function hashPointer<T>(pointer: Pointer<T> | undefined): number;
export declare function bindPointer<T>(identity: object, read: () => T, write: (value: T) => void): Pointer<T>;
export declare function projectPointer<F, T>(pointer: Pointer<F> | undefined, fromSource: (value: F) => T, toSource: (value: T) => F): Pointer<T> | undefined;
export declare function bindRawPointer(identity: object): RawPointer;
export declare function equalRawPointer(left: RawPointer | undefined, right: RawPointer | undefined): boolean;
export declare function hashRawPointer(pointer: RawPointer | undefined): number;
export declare const ordinary: number;
`;

export interface CheckedPointerFixture {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}

export function checkedPointerFixture(
  sourceText: string,
  additionalFiles: Readonly<Record<string, string>> = {},
): CheckedPointerFixture {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": sourceText,
      "/src/markers.ts": pointerMarkerDeclarations,
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
      extensions: [createSourceSemanticsExtension({
        modules: pointerMarkerSemantics,
      })],
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  return {
    source,
    sourceFile: sourceFileNamed(source, "/src/index.ts"),
  };
}

export function sourceFileNamed(
  source: TargetSourceProgram,
  fileName: string,
): SourceFile {
  const sourceFile = source.navigation.sourceFiles.find(
    (candidate) => source.ast.getFileName(candidate) === fileName,
  );
  assert.ok(sourceFile !== undefined, `Missing checked source file '${fileName}'.`);
  return sourceFile;
}

export function visit(
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

export function containsNode(
  source: TargetSourceProgram,
  root: Node,
  expected: Node,
): boolean {
  let found = false;
  visit(source, root, (node) => {
    found ||= node === expected;
  });
  return found;
}

export function variableDeclarationNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): NonNullable<ReturnType<typeof AsVariableDeclaration>> {
  let found: ReturnType<typeof AsVariableDeclaration>;
  visit(source, sourceFile, (node) => {
    if (!IsVariableDeclaration(node)) {
      return;
    }
    const declaration = AsVariableDeclaration(node);
    if (declaration !== undefined && source.ast.text(declaration.name) === name) {
      found = declaration;
    }
  });
  assert.ok(found !== undefined, `Missing variable declaration '${name}'.`);
  return found;
}

export function importModules(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly string[] {
  return moduleSpecifiers(source, sourceFile, false);
}

export function moduleSpecifiers(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  includeExports = true,
): readonly string[] {
  return (sourceFile.Statements?.Nodes ?? []).flatMap((statement) => {
    if (IsImportDeclaration(statement)) {
      const declaration = AsImportDeclaration(statement);
      return declaration?.ModuleSpecifier === undefined
        ? []
        : [source.ast.text(declaration.ModuleSpecifier)];
    }
    if (includeExports && IsExportDeclaration(statement)) {
      const declaration = AsExportDeclaration(statement);
      return declaration?.ModuleSpecifier === undefined
        ? []
        : [source.ast.text(declaration.ModuleSpecifier)];
    }
    return [];
  });
}

export function namedImportBindings(
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

export function countCallsNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const expression = AsCallExpression(node)?.Expression;
    if (expression === undefined) {
      return;
    }
    const property = IsPropertyAccessExpression(expression)
      ? AsPropertyAccessExpression(expression)
      : undefined;
    const actual = property?.name === undefined
      ? source.ast.text(expression)
      : source.ast.text(property.name);
    if (actual === name) {
      count += 1;
    }
  });
  return count;
}
