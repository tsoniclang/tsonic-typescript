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

import { createTargetProgramIndex } from "../program-index.js";
import {
  createScalarRepresentationPlan,
  type ScalarRepresentationPlan,
  type ScalarRepresentationProfile,
} from "./plan.js";

export interface CheckedScalarFixture {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
}

export function createFixtureScalarRepresentationPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
): ScalarRepresentationPlan {
  return createScalarRepresentationPlan(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: true,
      memberDispatch: false,
      declarationReferences: true,
    }),
    profile,
    fixtureSourceIdentityFor(source),
  );
}

export function fixtureSourceIdentityFor(
  source: TargetSourceProgram,
): (sourceFile: SourceFile) => string {
  return (sourceFile) => {
    const fileName = source.ast.getFileName(sourceFile);
    return fileName.startsWith("/src/") ? fileName.slice(5) : fileName;
  };
}

export function checkedScalarFixture(
  sourceText: string,
  options: {
    readonly experimentalDecorators?: boolean;
    readonly additionalFiles?: Readonly<Record<string, string>>;
  } = {},
): CheckedScalarFixture {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      ...options.additionalFiles,
      "/src/index.ts": sourceText,
    },
    rootFiles: ["/src/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
      experimentalDecorators: options.experimentalDecorators,
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
