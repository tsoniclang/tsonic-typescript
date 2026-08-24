import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const modelRoot = join(repositoryRoot, "src", "lowering", "effect", "model");
const effectRoot = join(repositoryRoot, "src", "lowering", "effect");

test("exact source semantic membership has one model owner", () => {
  const membership = readFileSync(
    join(modelRoot, "source-membership.ts"),
    "utf8",
  );
  const invocation = readFileSync(
    join(modelRoot, "exact-source-invocation.ts"),
    "utf8",
  );
  const contracts = readFileSync(
    join(modelRoot, "callable-contract.ts"),
    "utf8",
  );

  assert.match(membership, /source\.semantics\.includes\(sourceFile\)/u);
  assert.match(membership, /source\.navigation\.isProjectDeclaration/u);
  assert.match(membership, /certified\?\.\(declaration\) === true/u);
  assert.match(membership, /WeakMap<\s*TargetSourceProgram/u);
  assert.match(invocation, /nodeHasExactSourceSemantics\(source, contract\)/u);
  assert.match(
    contracts,
    /nodeHasExactSourceSemantics\(source, declaration\)/u,
  );
  assert.match(contracts, /nodeHasExactSourceSemantics\(source, node\)/u);
  assert.doesNotMatch(invocation, /source\.semantics\.includes/u);
  assert.doesNotMatch(contracts, /source\.semantics\.includes/u);
  assert.equal(
    productionTypeScriptFiles(modelRoot).some((file) =>
      file.endsWith("project-invocation.ts")
    ),
    false,
  );

  for (const file of productionTypeScriptFiles(effectRoot)) {
    if (file === join(modelRoot, "source-membership.ts")) {
      continue;
    }
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /\.semantics\.includes\(/u,
      file,
    );
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /resolveProjectInvocation|projectCallableImplementation/u,
      file,
    );
  }
});

function productionTypeScriptFiles(directory: string): readonly string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...productionTypeScriptFiles(path));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test-support.ts")
    ) {
      result.push(path);
    }
  }
  return result;
}
