import assert from "node:assert/strict";
import { test } from "node:test";

import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import {
  defaultTargetAstEncodingLimits,
  encodeTargetSourceFileForPrinting,
  KindSourceFile,
  NewArrayLiteralExpression,
  NewEmptyStatement,
  NewExpressionStatement,
  NewIdentifier,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateSourceFile,
  transformTargetSourceFile,
  type Node,
} from "@tsonic/tsts/target-ast";

import { encodeTargetSourceFile, targetAstEncodingLimits } from "./ast-encoding.js";
import { FramedPayloadBudget, printerProtocolLimits } from "./protocol-budget.js";

test("target encoding selects finite node and string capacity within its frame budget", () => {
  assert.deepEqual(targetAstEncodingLimits, {
    ...defaultTargetAstEncodingLimits,
    maximumNodeRows: 4_194_304,
    maximumStringCount: 2_097_152,
    maximumEncodedBytes: printerProtocolLimits.maximumFrameBytes,
  });
  assert.ok(Object.isFrozen(targetAstEncodingLimits));
  assert.equal(Reflect.set(targetAstEncodingLimits, "maximumNodeRows", Infinity), false);
  assert.equal(defaultTargetAstEncodingLimits.maximumNodeRows, 2_097_152);
  assert.equal(defaultTargetAstEncodingLimits.maximumStringCount, 1_048_576);
  assert.equal(printerProtocolLimits.maximumFrameBytes, 160 * 1024 * 1024);
  assert.equal(printerProtocolLimits.maximumPayloadBytes, 320 * 1024 * 1024);
});

test("selected target encoding leaves ordinary source bytes unchanged", () => {
  const sourceFile = checkedFile("export const value = 42;");
  assert.deepEqual(encodeTargetSourceFile(sourceFile), encodeTargetSourceFileForPrinting(sourceFile));
});

test("target encodes a real source above the unchanged shared default node ceiling", () => {
  const sourceFile = checkedFile(";");
  const expanded = transformTargetSourceFile(sourceFile, (original, updated, factory) => {
    if (original.Kind !== KindSourceFile) return updated;
    const statement = NewEmptyStatement(factory);
    assert.ok(statement);
    const statements = new Array<Node>(defaultTargetAstEncodingLimits.maximumNodeRows).fill(statement);
    return NodeFactory_UpdateSourceFile(factory, sourceFile,
      NodeFactory_NewNodeList(factory, statements), sourceFile.EndOfFileToken);
  });
  assert.throws(() => encodeTargetSourceFileForPrinting(expanded),
    /node rows 2097153 exceeds limit 2097152/u);
  const encoded = encodeTargetSourceFile(expanded);
  assert.ok(encoded.byteLength > 0);
  assert.ok(encoded.byteLength < targetAstEncodingLimits.maximumEncodedBytes);
  const budget = new FramedPayloadBudget(0, printerProtocolLimits, "encoded source");
  budget.reserveFrame(encoded.byteLength);
  assert.equal(budget.payloadLength, encoded.byteLength + 8);
});

test("target admits actual strings above the shared default without changing ordinary wire encoding", () => {
  const expanded = stringSource(defaultTargetAstEncodingLimits.maximumStringCount + 1);
  assert.throws(() => encodeTargetSourceFileForPrinting(expanded),
    /strings 1048577 exceeds limit 1048576/u);
  const encoded = encodeTargetSourceFile(expanded);
  assert.ok(encoded.byteLength > 0);
  assert.ok(encoded.byteLength < targetAstEncodingLimits.maximumEncodedBytes);
  new FramedPayloadBudget(0, printerProtocolLimits, "string source").reserveFrame(encoded.byteLength);
});

test("target rejects actual strings above its selected finite ceiling", () => {
  const expanded = stringSource(targetAstEncodingLimits.maximumStringCount + 1);
  assert.throws(() => encodeTargetSourceFile(expanded),
    /strings 2097153 exceeds limit 2097152/u);
});

function stringSource(count: number) {
  const sourceFile = checkedFile(";");
  return transformTargetSourceFile(sourceFile, (original, updated, factory) => {
    if (original.Kind !== KindSourceFile) return updated;
    const identifier = NewIdentifier(factory, "value");
    assert.ok(identifier);
    const array = NewArrayLiteralExpression(factory,
      NodeFactory_NewNodeList(factory, new Array<Node>(count).fill(identifier)), false);
    assert.ok(array);
    const statement = NewExpressionStatement(factory, array);
    assert.ok(statement);
    return NodeFactory_UpdateSourceFile(factory, sourceFile,
      NodeFactory_NewNodeList(factory, [statement]), sourceFile.EndOfFileToken);
  });
}

function checkedFile(text: string) {
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: { "/project/encoded.ts": text },
    rootFiles: ["/project/encoded.ts"],
    compilerOptions: {
      module: "esnext", moduleResolution: "bundler", strict: true, target: "es2022",
    },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  const sourceFile = checked.getSourceFile("/project/encoded.ts");
  assert.ok(sourceFile);
  return sourceFile;
}
