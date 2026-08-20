import assert from "node:assert/strict";

import {
  createCompilerSessionFromFiles,
} from "@tsonic/tsts";
import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  createTargetSourceProgram,
} from "@tsonic/target-api";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { createTargetProgramIndex } from "../../program-index.js";
import type { TypeScriptInterfaceDispatchProfile } from "../../profile.js";
import {
  createClosedCooperativeEffectPlan,
  type CooperativeEffectPlan,
} from "../planning/plan.js";

export interface CheckedEffectFixture {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}

export function checkedEffectFixture(
  sourceText: string,
  additionalFiles: Readonly<Record<string, string>> = {},
): CheckedEffectFixture {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": sourceText,
      ...additionalFiles,
    },
    rootFiles: ["/src/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.sourceFiles.find(
    (candidate) => source.ast.getFileName(candidate) === "/src/index.ts",
  );
  assert.ok(sourceFile !== undefined);
  return { source, sourceFile };
}

export function createFixtureEffectPlan(
  source: TargetSourceProgram,
  interfaceDispatch: TypeScriptInterfaceDispatchProfile = "open-structural",
): CooperativeEffectPlan {
  return createClosedCooperativeEffectPlan(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: true,
      memberDispatch: true,
      declarationReferences: true,
    }),
    (sourceFile) => source.documents.forFile(sourceFile).identity,
    undefined,
    undefined,
    interfaceDispatch,
  );
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

export function countNodes(
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

export function countAsyncCallables(
  source: TargetSourceProgram,
  root: Node,
): number {
  return countNodes(source, root, (node) =>
    source.ast.hasModifierKind(node, "async")
  );
}
