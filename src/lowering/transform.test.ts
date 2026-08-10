import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeTargetSourceFileForPrinting,
  IsAsExpression,
  IsNewExpression,
} from "@tsonic/tsts/target-ast";
import type { Node, SourceFile } from "@tsonic/tsts";

import { canonicalTypeScriptOptimizationProfile } from "./profile.js";
import {
  checkedPointerFixture,
  countCallsNamed,
  visit,
} from "./pointer/pointer.test-support.js";
import { lowerPointers } from "./pointer/transform.js";
import {
  prepareTypeScriptLowering,
  type TypeScriptLoweringTransaction,
} from "./transform.js";

const composedSource = `import {
  allocatePointer,
  loadPointer,
} from "./markers.js";
class Scalar {
  constructor(readonly value: number) {}
}
export const result = new Scalar(
  loadPointer(allocatePointer(41)),
).value;
`;

test("composes pointer and scalar lowering in one target-AST traversal", () => {
  const fixture = checkedPointerFixture(composedSource);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      cooperativeEffects: "preserve",
    },
    sourceIdentity(fixture),
  ));
  const results = files.map((sourceFile) => transaction.lower(sourceFile));
  transaction.finish();

  const result = results.find((candidate) =>
    fixture.source.ast.getFileName(candidate.sourceFile) === "/src/index.ts"
  );
  assert.ok(result !== undefined);
  assert.equal(result.pointer.operationCount, 2);
  assert.equal(result.pointer.runtimeAlias, undefined);
  assert.equal(result.scalar.projectionCount, 1);
  assert.equal(
    countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"),
    0,
  );
  assert.equal(
    countCallsNamed(fixture.source, result.sourceFile, "loadPointer"),
    0,
  );
  assert.equal(countNodes(result.sourceFile, fixture.source, IsNewExpression), 0);
  assert.equal(countNodes(result.sourceFile, fixture.source, IsAsExpression), 1);
});

test("canonical transaction is byte-identical to canonical pointer lowering", () => {
  const fixture = checkedPointerFixture(composedSource);
  const canonical = lowerPointers(fixture.source, fixture.sourceFile);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    canonicalTypeScriptOptimizationProfile(),
    sourceIdentity(fixture),
  ));
  let transformed: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      transformed = result.sourceFile;
    }
  }
  transaction.finish();
  assert.ok(transformed !== undefined);
  assert.deepEqual(
    encodeTargetSourceFileForPrinting(transformed),
    encodeTargetSourceFileForPrinting(canonical.sourceFile),
  );
});

test("requires one exact complete source membership", () => {
  const fixture = checkedPointerFixture(composedSource);
  const files = [...fixture.source.navigation.sourceFiles];
  assert.ok(files.length > 1);
  assert.throws(
    () => prepareTypeScriptLowering(
      fixture.source,
      files.slice(1),
      canonicalTypeScriptOptimizationProfile(),
      sourceIdentity(fixture),
    ),
    /every exact checked project source file once/,
  );
  assert.throws(
    () => prepareTypeScriptLowering(
      fixture.source,
      [...files, files[0] as SourceFile],
      canonicalTypeScriptOptimizationProfile(),
      sourceIdentity(fixture),
    ),
    /every exact checked project source file once/,
  );
});

test("seals one lowering transaction after exact consumption", () => {
  const fixture = checkedPointerFixture(composedSource);
  const files = [...fixture.source.navigation.sourceFiles];

  const duplicate = newTransaction(fixture, files);
  duplicate.lower(files[0] as SourceFile);
  assert.throws(
    () => duplicate.lower(files[0] as SourceFile),
    /visited a source file twice/,
  );

  const incomplete = newTransaction(fixture, files);
  incomplete.lower(files[0] as SourceFile);
  assert.throws(
    () => incomplete.finish(),
    /consumed 1 source files, expected 2/,
  );

  const complete = newTransaction(fixture, files);
  for (const sourceFile of files) {
    complete.lower(sourceFile);
  }
  complete.finish();
  assert.throws(
    () => complete.finish(),
    /sealed twice/,
  );
});

function newTransaction(
  fixture: ReturnType<typeof checkedPointerFixture>,
  files: readonly SourceFile[],
): TypeScriptLoweringTransaction {
  return requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    canonicalTypeScriptOptimizationProfile(),
    sourceIdentity(fixture),
  ));
}

function sourceIdentity(
  fixture: ReturnType<typeof checkedPointerFixture>,
): (sourceFile: SourceFile) => string {
  return (sourceFile) => fixture.source.documents.forFile(sourceFile).identity;
}

function requireTransaction(
  preparation: ReturnType<typeof prepareTypeScriptLowering>,
): TypeScriptLoweringTransaction {
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    assert.fail("TypeScript lowering preparation was rejected");
  }
  return preparation.transaction;
}

function countNodes(
  root: Node,
  source: ReturnType<typeof checkedPointerFixture>["source"],
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
