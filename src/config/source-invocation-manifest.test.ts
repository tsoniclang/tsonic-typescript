import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  readSourceInvocationManifest,
  readSourceInvocationManifests,
} from "./source-invocation-manifest.js";

const scratch = resolve(".temp/source-invocation-manifest-tests");
mkdirSync(scratch, { recursive: true });

test("reads one digest-bound exact source invocation contract", () => {
  const invocations = [
    invocation("goApply", "runtime/apply.ts", "source:apply", [0], [0]),
    invocation("goVisit", "runtime/visit.ts", "source:visit", [0, 1], [1]),
  ];
  const path = writeManifest("valid.json", invocations);

  const manifest = readSourceInvocationManifest(path);

  assert.equal(manifest.contracts.length, 2);
  assert.equal(
    manifest.contracts[0]?.file.sourceFileName,
    resolve(scratch, "runtime/apply.ts"),
  );
  assert.equal(manifest.contracts[1]?.exactImplementation, true);
  assert.equal(manifest.contracts[1]?.file.exact, true);
  assert.deepEqual(manifest.contracts[1]?.inputParameters, [0, 1]);
  assert.deepEqual(manifest.contracts[1]?.resultOriginParameters, [1]);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.files));
  assert.ok(Object.isFrozen(manifest.files[0]));
  assert.ok(Object.isFrozen(manifest.contracts));
  assert.ok(Object.isFrozen(manifest.contracts[0]));
});

test("rejects an exact file with an inexact selected implementation", () => {
  const selected = invocation(
    "goApply",
    "runtime/apply.ts",
    "source:apply",
    [0],
    [],
  );
  selected["exactImplementation"] = false;

  assert.throws(
    () => readSourceInvocationManifest(writeManifest("inexact.json", [selected])),
    /must be true for an exact source file/u,
  );
});

test("rejects invocations without one canonical source-file owner", () => {
  const exact = invocation(
    "goApply",
    "runtime/apply.ts",
    "source:apply",
    [0],
    [],
  );
  const document = manifest([exact]);
  document.sourceInvocationContract.files = [];
  assert.throws(
    () => readSourceInvocationManifest(writeDocument("missing-file.json", document)),
    /files must be non-empty/u,
  );

  const duplicate = manifest([exact]);
  duplicate.sourceInvocationContract.files = [
    ...duplicate.sourceInvocationContract.files,
    ...duplicate.sourceInvocationContract.files,
  ];
  duplicate.sourceInvocationContract.contractDigest = sourceInvocationDigest(
    duplicate.sourceInvocationContract.files,
    duplicate.sourceInvocationContract.invocations,
  );
  assert.throws(
    () => readSourceInvocationManifest(writeDocument("duplicate-file.json", duplicate)),
    /source invocation files are not strictly ordered/u,
  );

  const orphaned = manifest([exact]);
  orphaned.sourceInvocationContract.files = [{
    sourcePath: "runtime/other.ts",
    sourceDigest: "a".repeat(64),
    exact: true,
  }];
  orphaned.sourceInvocationContract.contractDigest = sourceInvocationDigest(
    orphaned.sourceInvocationContract.files,
    orphaned.sourceInvocationContract.invocations,
  );
  assert.throws(
    () => readSourceInvocationManifest(writeDocument("orphaned-invocation.json", orphaned)),
    /has no source-file owner/u,
  );
});

test("accepts exact source-file authority without an invocation row", () => {
  const document = manifest([]);
  document.sourceInvocationContract.files = [{
    sourcePath: "runtime/exact.ts",
    sourceDigest: "a".repeat(64),
    exact: true,
  }];
  document.sourceInvocationContract.contractDigest = sourceInvocationDigest(
    document.sourceInvocationContract.files,
    document.sourceInvocationContract.invocations,
  );

  const selected = readSourceInvocationManifest(
    writeDocument("exact-file-only.json", document),
  );

  assert.equal(selected.files.length, 1);
  assert.equal(selected.contracts.length, 0);
  assert.equal(selected.files[0]?.exact, true);
});

test("rejects conflicting source-file authority across manifests", () => {
  const first = invocation(
    "goApply",
    "runtime/apply.ts",
    "source:apply",
    [],
    [],
  );
  const second = invocation(
    "goVisit",
    "runtime/apply.ts",
    "source:visit",
    [],
    [],
  );
  const firstPath = writeManifest("cross-first.json", [first]);
  const secondDocument = manifest([second]);
  secondDocument.sourceInvocationContract.files[0]!["exact"] = false;
  secondDocument.sourceInvocationContract.contractDigest = sourceInvocationDigest(
    secondDocument.sourceInvocationContract.files,
    secondDocument.sourceInvocationContract.invocations,
  );
  const secondPath = writeDocument("cross-second.json", secondDocument);

  assert.throws(
    () => readSourceInvocationManifests(scratch, [firstPath, secondPath]),
    /conflicting exactness across manifests/u,
  );

  const changedDocument = manifest([second]);
  changedDocument.sourceInvocationContract.files[0]!["sourceDigest"] =
    "c".repeat(64);
  changedDocument.sourceInvocationContract.contractDigest = sourceInvocationDigest(
    changedDocument.sourceInvocationContract.files,
    changedDocument.sourceInvocationContract.invocations,
  );
  const changedPath = writeDocument("cross-digest.json", changedDocument);
  assert.throws(
    () => readSourceInvocationManifests(scratch, [firstPath, changedPath]),
    /conflicting digests across manifests/u,
  );
});

test("rejects stale payloads and non-canonical ordering", () => {
  const rows = [
    invocation("goVisit", "runtime/visit.ts", "source:visit", [], []),
    invocation("goApply", "runtime/apply.ts", "source:apply", [], []),
  ];
  assert.throws(
    () => readSourceInvocationManifest(writeManifest("unordered.json", rows)),
    /not strictly ordered/u,
  );

  const valid = [
    invocation("goApply", "runtime/apply.ts", "source:apply", [], []),
  ];
  const document = manifest(valid);
  document.sourceInvocationContract.contractDigest = "d".repeat(64);
  const path = resolve(scratch, "stale.json");
  writeFileSync(path, `${JSON.stringify(document, undefined, 2)}\n`);
  assert.throws(
    () => readSourceInvocationManifest(path),
    /contract digest does not match payload/u,
  );
});

type InvocationDocument = Record<string, unknown>;
type SourceFileDocument = Record<string, unknown>;

function invocation(
  exportName: string,
  sourcePath: string,
  sourceIdentity: string,
  inputParameters: readonly number[],
  resultOriginParameters: readonly number[],
): InvocationDocument {
  return {
    sourceIdentity,
    sourcePath,
    export: exportName,
    exactImplementation: true,
    inputParameters: [...inputParameters],
    resultOriginParameters: [...resultOriginParameters],
  };
}

function writeManifest(
  name: string,
  invocations: readonly InvocationDocument[],
): string {
  return writeDocument(name, manifest(invocations));
}

function manifest(invocations: readonly InvocationDocument[]): {
  schemaVersion: number;
  semanticDigest: string;
  sourceInvocationContract: {
    schemaVersion: number;
    contractDigest: string;
    files: SourceFileDocument[];
    invocations: InvocationDocument[];
  };
} {
  const selectedInvocations = [...invocations];
  const files = [...new Set(selectedInvocations.map((invocation) =>
    String(invocation["sourcePath"])
  ))].sort().map((sourcePath) => ({
    sourcePath,
    sourceDigest: "a".repeat(64),
    exact: true,
  }));
  return {
    schemaVersion: 1,
    semanticDigest: "b".repeat(64),
    sourceInvocationContract: {
      schemaVersion: 3,
      contractDigest: sourceInvocationDigest(files, selectedInvocations),
      files,
      invocations: selectedInvocations,
    },
  };
}

function sourceInvocationDigest(
  files: readonly SourceFileDocument[],
  invocations: readonly InvocationDocument[],
): string {
  const hash = createHash("sha256");
  hash.update("gotots-source-invocation-v3\0");
  for (const file of files) {
    for (const key of ["sourcePath", "sourceDigest"]) {
      hash.update(String(file[key]));
      hash.update("\0");
    }
    hash.update(file["exact"] ? "\x01" : "\x00");
  }
  for (const invocation of invocations) {
    for (const key of [
      "sourceIdentity",
      "sourcePath",
      "export",
    ]) {
      hash.update(String(invocation[key]));
      hash.update("\0");
    }
    hash.update(invocation["exactImplementation"] ? "\x01" : "\x00");
    writeIndexes(hash, invocation["inputParameters"]);
    writeIndexes(hash, invocation["resultOriginParameters"]);
  }
  return hash.digest("hex");
}

function writeDocument(
  name: string,
  document: ReturnType<typeof manifest>,
): string {
  const path = resolve(scratch, name);
  writeFileSync(path, `${JSON.stringify(document, undefined, 2)}\n`);
  return path;
}

function writeIndexes(
  hash: ReturnType<typeof createHash>,
  value: unknown,
): void {
  for (const index of value as readonly number[]) {
    hash.update(`${index},`);
  }
  hash.update("\0");
}
