import assert from "node:assert/strict";
import test from "node:test";
import { readTsonicKeepAlive, tsonicKeepAliveFactKey } from "@tsonic/source-core/facts";
import { AsImportClause, AsImportDeclaration, KindUnknown } from "@tsonic/tsts/target-ast";
import { canonicalTypeScriptOptimizationProfile } from "../../profile.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { countCallsNamed, importModules, visit } from "../pointer.test-support.js";
import { memoryFixture, lowerMemoryFixture } from "./memory.test-support.js";

for (const optimize of [false, true]) {
  test(`keepAlive retains one exact call and operand, optimize=${optimize}`, () => {
    const fixture = memoryFixture(`
      function owner() { return { count: 1 }; }
      keepAlive(owner());
    `);
    const lowered = lowerMemoryFixture(fixture, optimize);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "keepAlive"), 1);
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "owner"), 1);
    assert.deepEqual(importModules(fixture.source, lowered.sourceFile), ["@tsonic/typescript-runtime", "test:memory"]);
    const declaration = lowered.sourceFile.Statements?.Nodes[0];
    assert.ok(declaration);
    const clause = AsImportDeclaration(declaration)?.ImportClause;
    assert.ok(clause);
    assert.equal(AsImportClause(clause)?.PhaseModifier, KindUnknown);
  });
}

test("a missing lexical lifetime fact fails before printing", () => {
  const fixture = memoryFixture("keepAlive({ count: 1 });");
  const facts = fixture.source.sourceFacts;
  const source = { ...fixture.source, sourceFacts: {
    ...facts,
    getFact<T>(subject: Parameters<typeof facts.getFact>[0], key: import("@tsonic/tsts").ExtensionFactKey<T>): T | undefined {
      return Object.is(key, tsonicKeepAliveFactKey) ? undefined : facts.getFact(subject, key);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
});

test("lifetime operand drift fails its exact-call join", () => {
  const fixture = memoryFixture("keepAlive({ count: 1 });");
  let count = 0;
  visit(fixture.source, fixture.sourceFile, node => {
    if (readTsonicKeepAlive(fixture.source.sourceFacts, node)?.call === node) count++;
  });
  assert.equal(count, 1);
  const ast = fixture.source.ast;
  const source = { ...fixture.source, ast: {
    ...ast,
    arguments(node: Parameters<typeof ast.arguments>[0]) {
      return readTsonicKeepAlive(fixture.source.sourceFacts, node)?.call === node ? [] : ast.arguments(node);
    },
  } };
  const prepared = prepareTypeScriptLowering(source, source.navigation.sourceFiles, canonicalTypeScriptOptimizationProfile(),
    file => source.documents.forFile(file).identity);
  assert.equal(prepared.kind, "rejected");
  if (prepared.kind === "rejected") assert.match(prepared.failures[0]?.message ?? "", /lifetime fact/);
});
