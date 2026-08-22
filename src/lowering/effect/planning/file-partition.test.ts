import assert from "node:assert/strict";
import { test } from "node:test";

import type { AstReader } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  checkedEffectFixture,
  createFixtureEffectPlan,
} from "../test-support/fixture.test-support.js";

test("partitions effect nodes by file with linear source-file lookups", () => {
  const fileCount = 24;
  const additionalFiles = Object.fromEntries(
    Array.from({ length: fileCount }, (_, index) => [
      `/src/file-${index}.ts`,
      `export async function value${index}(): Promise<number> { return ${index}; }\n` +
        `export async function call${index}(): Promise<number> { return await value${index}(); }\n`,
    ]),
  );
  const imports = Array.from(
    { length: fileCount },
    (_, index) => `import "./file-${index}.js";`,
  ).join("\n");
  const fixture = checkedEffectFixture(imports, additionalFiles);
  let sourceFileLookups = 0;
  const ast: AstReader = Object.freeze({
    ...fixture.source.ast,
    getSourceFile(node: Parameters<AstReader["getSourceFile"]>[0]) {
      sourceFileLookups += 1;
      return fixture.source.ast.getSourceFile(node);
    },
  });
  const source: TargetSourceProgram = Object.freeze({
    ast,
    sourceFiles: fixture.source.sourceFiles,
    documents: fixture.source.documents,
    sourceFacts: fixture.source.sourceFacts,
    navigation: fixture.source.navigation,
    semantics: fixture.source.semantics,
  });

  const plan = createFixtureEffectPlan(source);

  assert.equal(plan.summary.candidateCount, fileCount * 2);
  assert.ok(
    sourceFileLookups < fileCount * 12,
    `effect planning performed ${sourceFileLookups} source-file lookups for ${fileCount} files`,
  );
});
