import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTsonicCoreSourceExtension,
  tsonicCoreSourceSemanticsModules,
} from "@tsonic/source-core";
import {
  tsonicAttributeBuilderFactKey,
} from "@tsonic/source-core/facts";
import {
  createCompilerSessionFromFiles,
  createSourceSemanticsExtension,
  type Node,
  type SourceFile,
} from "@tsonic/tsts";
import {
  AsCallExpression,
  AsImportClause,
  AsImportDeclaration,
  AsNamedImports,
  AsPropertyAccessExpression,
  IsCallExpression,
  IsClassDeclaration,
  IsImportClause,
  IsImportDeclaration,
  IsNamedImports,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { canonicalTypeScriptOptimizationProfile } from "../profile.js";
import { prepareTypeScriptLowering } from "../transform.js";
import { createTargetProgramIndex } from "../program-index.js";
import { createSourceAttributeSelection } from "./plan.js";
import { createSourceAttributeRewriter } from "./transform.js";

const sourceText = `import { attribute as coreAttribute } from "@tsonic/core/lang.js";
import { Fact, live } from "./facts.js";
class User { value = "λ"; }
class LocalFact {}
function attribute<T>() {
  return { add(..._values: readonly object[]): void {} };
}
coreAttribute<User>().add(Fact, "one"); coreAttribute<User>().property(value => value.value).add(Fact, "two");
attribute<User>().add(LocalFact);
export const retained = live;
`;

test("erases every exact finalized source attribute and no same-spelled call", () => {
  const fixture = checkedSource(sourceText);
  const selection = createSourceAttributeSelection(fixture.source);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
    excludeSubtreeRoot: selection.excludeSubtreeRoot,
  });
  const plan = selection.finish();
  assert.equal(plan.applicationCount, 2);
  assert.equal(plan.removableImportBindingCount, 2);
  assert.equal(plan.removableDeclarationCount, 1);
  assert.equal(finalizedApplicationCount(fixture.source, program.nodes), 0);

  const preparation = prepareTypeScriptLowering(
    fixture.source,
    fixture.source.navigation.sourceFiles,
    canonicalTypeScriptOptimizationProfile(),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    return;
  }
  let erased = 0;
  let erasedImports = 0;
  let erasedDeclarations = 0;
  let lowered: SourceFile | undefined;
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const result = preparation.transaction.lower(sourceFile);
    erased += result.sourceAttributes.erasedApplicationCount;
    erasedImports += result.sourceAttributes.erasedImportBindingCount;
    erasedDeclarations += result.sourceAttributes.erasedDeclarationCount;
    if (sourceFile === fixture.sourceFile) {
      lowered = result.sourceFile;
    }
  }
  preparation.transaction.finish();
  assert.equal(erased, 2);
  assert.equal(erasedImports, 2);
  assert.equal(erasedDeclarations, 1);
  assert.ok(lowered !== undefined);
  assert.equal(addCallCount(fixture.source, lowered), 1);
  assert.deepEqual(importModules(fixture.source, lowered), ["./facts.js"]);
  assert.deepEqual(
    namedImportBindings(fixture.source, lowered, "./facts.js"),
    ["live"],
  );
});

test("retains an exact import binding that has a live non-attribute reference", () => {
  const fixture = checkedSource(`${sourceText}\nexport const retainedFact = Fact;\n`);
  const preparation = prepareTypeScriptLowering(
    fixture.source,
    fixture.source.navigation.sourceFiles,
    canonicalTypeScriptOptimizationProfile(),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    return;
  }
  let lowered: SourceFile | undefined;
  let erasedDeclarations = 0;
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const result = preparation.transaction.lower(sourceFile);
    erasedDeclarations += result.sourceAttributes.erasedDeclarationCount;
    if (sourceFile === fixture.sourceFile) {
      lowered = result.sourceFile;
      assert.equal(result.sourceAttributes.erasedImportBindingCount, 1);
    }
  }
  preparation.transaction.finish();
  assert.ok(lowered !== undefined);
  assert.deepEqual(
    namedImportBindings(fixture.source, lowered, "./facts.js"),
    ["Fact", "live"],
  );
  assert.equal(erasedDeclarations, 0);
});

test("preserves module evaluation when the last metadata binding is erased", () => {
  const fixture = checkedSource(`
import { attribute as coreAttribute } from "@tsonic/core/lang.js";
import { Fact } from "./facts.js";
class User {}
coreAttribute<User>().add(Fact, "metadata");
`, `
export const observed = (() => 1)();
export class Fact {}
`);
  const lowered = lowerFixture(fixture);
  assert.deepEqual(sideEffectImportModules(fixture.source, lowered), ["./facts.js"]);
  assert.deepEqual(
    namedImportBindings(fixture.source, lowered, "./facts.js"),
    [],
  );
});

test("removes an import whose complete project module is inert metadata", () => {
  const fixture = checkedSource(`
import { attribute as coreAttribute } from "@tsonic/core/lang.js";
import { Fact } from "./facts.js";
class User {}
coreAttribute<User>().add(Fact, "metadata");
`, "export class Fact {}\n");
  const lowered = lowerFixture(fixture);
  assert.deepEqual(importModules(fixture.source, lowered), []);
});

test("retains a metadata declaration with runtime class initialization", () => {
  const fixture = checkedSource(`
import { attribute as coreAttribute } from "@tsonic/core/lang.js";
class User {}
class LocalFact { static value = 1; }
coreAttribute<User>().add(LocalFact, "metadata");
`);
  const lowered = lowerFixture(fixture);
  assert.equal(countNodes(fixture.source, lowered, IsClassDeclaration), 2);
});

test("rejects duplicate selection of one exact source attribute", () => {
  const fixture = checkedSource(sourceText);
  const selection = createSourceAttributeSelection(fixture.source);
  const statement = (fixture.sourceFile.Statements?.Nodes ?? []).find(
    (candidate) => {
      const call = fixture.source.ast.as.AsExpressionStatement(candidate)
        ?.Expression;
      return call !== undefined && call !== null &&
        fixture.source.sourceFacts.getFact(
          call,
          tsonicAttributeBuilderFactKey,
        )?.kind === "application";
    },
  );
  assert.ok(statement !== undefined);
  assert.equal(selection.excludeSubtreeRoot(statement), true);
  assert.throws(
    () => selection.excludeSubtreeRoot(statement),
    /selected more than once/u,
  );
});

test("fails closed when a planned source attribute is not consumed", () => {
  const fixture = checkedSource(sourceText);
  const selection = createSourceAttributeSelection(fixture.source);
  createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
    excludeSubtreeRoot: selection.excludeSubtreeRoot,
  });
  const plan = selection.finish();
  const rewriter = createSourceAttributeRewriter(plan, fixture.sourceFile);
  assert.throws(
    () => rewriter.finish(fixture.sourceFile),
    /planned 2, consumed 0/,
  );
});

test("fails closed when a planned metadata import is not consumed", () => {
  const fixture = checkedSource(sourceText);
  const binding = firstNamedImportBinding(
    fixture.source,
    fixture.sourceFile,
    "@tsonic/core/lang.js",
  );
  const plan = {
    applicationCount: 0,
    removableImportBindingCount: 1,
    removableDeclarationCount: 0,
    applicationsFor: () => [],
    removableImportBindingsFor: (sourceFile: SourceFile) =>
      sourceFile === fixture.sourceFile
        ? new Set<Node>([binding])
        : new Set<Node>(),
    deferredImportBindingsFor: () => new Set<Node>(),
    removableDeclarationsFor: () => new Set<Node>(),
    moduleEvaluationImportsFor: () => new Set<Node>(),
  };
  const rewriter = createSourceAttributeRewriter(plan, fixture.sourceFile);
  assert.throws(
    () => rewriter.finish(fixture.sourceFile),
    /import consumption mismatch: planned 1, consumed 0/,
  );
});

test("fails closed when module-evaluation import preservation is not consumed", () => {
  const fixture = checkedSource(sourceText);
  const declaration = firstImportDeclaration(
    fixture.source,
    fixture.sourceFile,
    "./facts.js",
  );
  const plan = {
    applicationCount: 0,
    removableImportBindingCount: 0,
    removableDeclarationCount: 0,
    applicationsFor: () => [],
    removableImportBindingsFor: () => new Set<Node>(),
    deferredImportBindingsFor: () => new Set<Node>(),
    removableDeclarationsFor: () => new Set<Node>(),
    moduleEvaluationImportsFor: (sourceFile: SourceFile) =>
      sourceFile === fixture.sourceFile
        ? new Set<Node>([declaration])
        : new Set<Node>(),
  };
  const rewriter = createSourceAttributeRewriter(plan, fixture.sourceFile);
  assert.throws(
    () => rewriter.finish(fixture.sourceFile),
    /module-evaluation import consumption mismatch/u,
  );
});

test("fails closed when a planned fact declaration is not consumed", () => {
  const fixture = checkedSource(sourceText);
  const selection = createSourceAttributeSelection(fixture.source);
  createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
    excludeSubtreeRoot: selection.excludeSubtreeRoot,
  });
  const plan = selection.finish();
  const factSourceFile = fixture.source.navigation.sourceFiles.find(
    (sourceFile) => fixture.source.ast.getFileName(sourceFile) === "/src/facts.ts",
  );
  assert.ok(factSourceFile !== undefined);
  assert.equal(plan.removableDeclarationsFor(factSourceFile).size, 1);
  const rewriter = createSourceAttributeRewriter(plan, factSourceFile);
  assert.throws(
    () => rewriter.finish(factSourceFile),
    /declaration consumption mismatch: planned 1, consumed 0/u,
  );
});

test("rejects a finalized source attribute outside a standalone statement", () => {
  const fixture = checkedSource(`
import { attribute as coreAttribute } from "@tsonic/core/lang.js";
import { Fact } from "./facts.js";
class User {}
export const invalid = coreAttribute<User>().add(Fact, "nested");
`);
  const selection = createSourceAttributeSelection(fixture.source);
  assert.throws(
    () => createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      excludeSubtreeRoot: selection.excludeSubtreeRoot,
    }),
    /finalized source attribute application is not a standalone expression statement/u,
  );
});

function checkedSource(
  text: string,
  factsText = "export class Fact {}\nexport const live = 1;\n",
): {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
} {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": text,
      "/src/facts.ts": factsText,
    },
    rootFiles: ["/src/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: [
        createSourceSemanticsExtension({
          modules: tsonicCoreSourceSemanticsModules(),
        }),
        createTsonicCoreSourceExtension(),
      ],
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

function lowerFixture(fixture: {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}): SourceFile {
  const preparation = prepareTypeScriptLowering(
    fixture.source,
    fixture.source.navigation.sourceFiles,
    canonicalTypeScriptOptimizationProfile(),
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    throw new Error("source-attribute fixture did not plan");
  }
  let lowered: SourceFile | undefined;
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const result = preparation.transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      lowered = result.sourceFile;
    }
  }
  preparation.transaction.finish();
  assert.ok(lowered !== undefined);
  return lowered;
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
    if (clause?.NamedBindings === undefined || !IsNamedImports(clause.NamedBindings)) {
      return [];
    }
    return AsNamedImports(clause.NamedBindings)?.Elements?.Nodes.map((specifier) =>
      source.ast.text(source.ast.name(specifier))
    ) ?? [];
  }
  return [];
}

function sideEffectImportModules(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly string[] {
  return (sourceFile.Statements?.Nodes ?? []).flatMap((statement) => {
    if (!IsImportDeclaration(statement)) {
      return [];
    }
    const declaration = AsImportDeclaration(statement);
    return declaration !== undefined &&
        declaration.ImportClause === undefined &&
        declaration.ModuleSpecifier !== undefined
      ? [source.ast.text(declaration.ModuleSpecifier)]
      : [];
  });
}

function firstNamedImportBinding(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  moduleName: string,
): Node {
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
    if (clause?.NamedBindings === undefined || !IsNamedImports(clause.NamedBindings)) {
      continue;
    }
    const binding = AsNamedImports(clause.NamedBindings)?.Elements?.Nodes[0];
    if (binding !== undefined) {
      return binding;
    }
  }
  throw new Error(`missing named import from ${moduleName}`);
}

function firstImportDeclaration(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  moduleName: string,
): Node {
  for (const statement of sourceFile.Statements?.Nodes ?? []) {
    if (!IsImportDeclaration(statement)) {
      continue;
    }
    const declaration = AsImportDeclaration(statement);
    if (
      statement !== undefined &&
      declaration?.ModuleSpecifier !== undefined &&
      source.ast.text(declaration.ModuleSpecifier) === moduleName
    ) {
      return statement;
    }
  }
  throw new Error(`missing import from ${moduleName}`);
}

function finalizedApplicationCount(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): number {
  return nodes.filter((node) =>
    source.sourceFacts.getFact(node, tsonicAttributeBuilderFactKey)?.kind ===
      "application"
  ).length;
}

function addCallCount(source: TargetSourceProgram, root: Node): number {
  let count = 0;
  visit(source, root, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const call = AsCallExpression(node);
    const expression = call?.Expression;
    if (expression === undefined || !IsPropertyAccessExpression(expression)) {
      return;
    }
    const property = AsPropertyAccessExpression(expression);
    if (property !== undefined && source.ast.text(property.name) === "add") {
      count += 1;
    }
  });
  return count;
}

function visit(
  source: TargetSourceProgram,
  node: Node,
  callback: (node: Node) => void,
): void {
  callback(node);
  for (const child of source.ast.children(node)) {
    if (child !== undefined) {
      visit(source, child, callback);
    }
  }
}

function countNodes(
  source: TargetSourceProgram,
  root: Node,
  predicate: (node: Node) => boolean,
): number {
  let count = 0;
  visit(source, root, (node) => {
    if (predicate(node)) {
      count += 1;
    }
  });
  return count;
}
