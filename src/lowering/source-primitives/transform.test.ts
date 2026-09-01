import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCompilerSessionFromFiles,
  createSourceSemanticsExtension,
  sourcePrimitive,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  Node,
  SourceFile,
  SourceAnalysisContext,
  SourceSemanticsModule,
} from "@tsonic/tsts";
import {
  AsImportDeclaration,
  AsTypeAliasDeclaration,
  IsImportDeclaration,
  IsTypeAliasDeclaration,
} from "@tsonic/tsts/target-ast";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { canonicalTypeScriptOptimizationProfile } from "../profile.js";
import { createTargetProgramIndex } from "../program-index.js";
import { prepareTypeScriptLowering } from "../transform.js";
import { createSourcePrimitiveLoweringPlan } from "./plan.js";
import { createSourcePrimitiveRewriter } from "./transform.js";

const sourcePrimitiveModule = {
  moduleSpecifier: "./markers.js",
  capabilities: ["primitive"],
  exports: [
    sourcePrimitive("flag", "bool", "boolean"),
    sourcePrimitive("wide", "int64", "bigint", true, 64),
    sourcePrimitive("narrow", "int32", "number", true, 32),
    sourcePrimitive("character", "char", "string", false, 16),
    sourcePrimitive("opaque", "decimal", "object", true, 128),
  ],
} satisfies SourceSemanticsModule;

const markerDeclarations = `export type flag = boolean;
export type wide = bigint;
export type narrow = number;
export type character = string;
export type opaque = object;
export interface ordinary { readonly value: number }
`;

test("lowers every exact source primitive runtime base and erases its type imports", () => {
  const fixture = checkedFixture(`import type {
  flag as SelectedFlag,
  wide as SelectedWide,
  narrow as SelectedNarrow,
  character as SelectedCharacter,
  opaque as SelectedOpaque,
} from "./markers.js";
type wide = number;
export type FlagValue = SelectedFlag;
export type WideValue = SelectedWide;
export type NarrowValue = SelectedNarrow;
export type CharacterValue = SelectedCharacter;
export type OpaqueValue = SelectedOpaque;
export type SameSpelledLocal = wide;
`);
  const lowered = lowerFixture(fixture);

  assert.equal(lowered.typeReferenceCount, 5);
  assert.equal(lowered.erasedImportBindingCount, 5);
  assert.deepEqual(importModules(fixture.source, lowered.sourceFile), []);
  assert.equal(aliasTypeKind(fixture.source, lowered.sourceFile, "FlagValue"), "KindBooleanKeyword");
  assert.equal(aliasTypeKind(fixture.source, lowered.sourceFile, "WideValue"), "KindBigIntKeyword");
  assert.equal(aliasTypeKind(fixture.source, lowered.sourceFile, "NarrowValue"), "KindNumberKeyword");
  assert.equal(aliasTypeKind(fixture.source, lowered.sourceFile, "CharacterValue"), "KindStringKeyword");
  assert.equal(aliasTypeKind(fixture.source, lowered.sourceFile, "OpaqueValue"), "KindObjectKeyword");
  assert.equal(aliasTypeKind(fixture.source, lowered.sourceFile, "SameSpelledLocal"), "KindTypeReference");
});

test("reports the exact required-lowering denominator", () => {
  const fixture = checkedFixture(`import type { wide, narrow } from "./markers.js";
export type WideValue = wide;
export type NarrowValue = narrow;
`);
  const preparation = prepareFixture(fixture);
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    return;
  }
  assert.deepEqual(preparation.transaction.evidence.sourcePrimitives, {
    typeReferenceCount: 2,
    removableImportBindingCount: 2,
  });
  assert.ok(Object.isFrozen(preparation.transaction.evidence.sourcePrimitives));
});

test("rejects namespace primitive imports without exact binding references", () => {
  for (const sourceText of [
    `import type * as markerTypes from "./markers.js";
export type WideValue = markerTypes.wide;
`,
    `import type * as markerTypes from "./markers.js";
export type WideValue = markerTypes.wide;
export type OrdinaryValue = markerTypes.ordinary;
`,
  ]) {
    const fixture = checkedFixture(sourceText);
    assert.throws(
      () => prepareFixture(fixture),
      /requires exact namespace-binding references/u,
    );
  }
});

test("rejects a source primitive imported through a runtime binding", () => {
  assert.throws(() => checkedFixture(`import { wide as SelectedWide } from "./markers.js";
export type WideValue = SelectedWide;
`), /Cannot commit an extension fact transaction after a fact write failed/u);
});

test("rejects an external source primitive re-export before printing", () => {
  const fixture = checkedFixture(`export type { wide as WideValue } from "./markers.js";
`);
  assert.throws(
    () => prepareFixture(fixture),
    /does not yet materialize external primitive re-exports/u,
  );
});

test("fails closed when planned primitive nodes are not consumed", () => {
  const fixture = checkedFixture(`import type { wide as SelectedWide } from "./markers.js";
export type WideValue = SelectedWide;
`);
  const plan = createSourcePrimitiveLoweringPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, { bindingWrites: false }),
  );
  const rewriter = createSourcePrimitiveRewriter(plan, fixture.sourceFile);
  assert.throws(
    () => rewriter.finish(fixture.sourceFile),
    /planned 1, consumed 0/u,
  );
});

test("rejects a primitive fact fabricated on an unsupported syntax node", () => {
  assert.throws(
    () => checkedFixture(
      "export const value = 1;\n",
      fabricatedPrimitiveExtension("KindNumericLiteral"),
    ),
    /Cannot commit an extension fact transaction after a fact write failed/u,
  );
});

interface CheckedFixture {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}

function fabricatedPrimitiveExtension(kindName: string): CompilerExtension {
  return Object.freeze({
    identity: Object.freeze({
      id: `source-primitive-fixture/${kindName}`,
      version: "1",
    }),
    analyzeSource(context: SourceAnalysisContext): void {
      const subject = findSourceNode(context, kindName);
      context.facts.set(subject, sourcePrimitiveFactKey, {
        kind: "int32",
        runtimeBase: "number",
        signed: true,
        width: 32,
      });
    },
  });
}

function checkedFixture(
  text: string,
  extension: CompilerExtension = createSourceSemanticsExtension({
    modules: [sourcePrimitiveModule],
  }),
): CheckedFixture {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": text,
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
      extensions: [extension],
    },
  });
  const checked = session.checkSource();
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(checked.extensionDiagnostics, []);
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.navigation.sourceFiles.find((candidate) =>
    source.ast.getFileName(candidate) === "/src/index.ts"
  );
  assert.ok(sourceFile !== undefined);
  return { source, sourceFile };
}

function findSourceNode(
  context: SourceAnalysisContext,
  kindName: string,
): Node {
  const pending: Array<Node | undefined> = [
    ...context.source.getSourceFiles(),
  ];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (context.source.ast.kindName(node) === kindName) {
      return node;
    }
    pending.push(...context.source.ast.children(node));
  }
  throw new Error(`fixture has no ${kindName}`);
}

function prepareFixture(fixture: CheckedFixture) {
  return prepareTypeScriptLowering(
    fixture.source,
    fixture.source.navigation.sourceFiles,
    canonicalTypeScriptOptimizationProfile(),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );
}

function lowerFixture(fixture: CheckedFixture) {
  const preparation = prepareFixture(fixture);
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    throw new Error("source primitive fixture did not plan");
  }
  let selected: ReturnType<typeof preparation.transaction.lower> | undefined;
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const result = preparation.transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      selected = result;
    }
  }
  preparation.transaction.finish();
  assert.ok(selected !== undefined);
  return selected.sourcePrimitives;
}

function aliasTypeKind(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): string {
  const declaration = (sourceFile.Statements?.Nodes ?? []).find((statement) =>
    IsTypeAliasDeclaration(statement) &&
    source.ast.text(source.ast.name(statement)) === name
  );
  const alias = AsTypeAliasDeclaration(declaration);
  assert.ok(alias?.Type !== undefined);
  return source.ast.kindName(alias.Type);
}

function importModules(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly string[] {
  return (sourceFile.Statements?.Nodes ?? []).flatMap((statement: Node | undefined) => {
    if (!IsImportDeclaration(statement)) {
      return [];
    }
    const declaration = AsImportDeclaration(statement);
    return declaration?.ModuleSpecifier === undefined
      ? []
      : [source.ast.text(declaration.ModuleSpecifier)];
  });
}
