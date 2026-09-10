import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsVariableDeclaration,
  IsVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import { checkedPointerFixture, visit } from "../pointer.test-support.js";
import {
  prepareTypeScriptLowering,
  type TypeScriptLoweringTransaction,
} from "../../transform.js";

const stableSource = `function panic(): never { throw new Error("nil"); }
interface Box { value: number }
export function increment(box: Box | undefined): number {
  (box ?? panic()).value = (box ?? panic()).value + 1;
  return (box ?? panic()).value;
}
`;

test("reuses one dominating nil check for an immutable binding", () => {
  const fixture = checkedPointerFixture(stableSource);
  const result = lowerFixture(fixture);
  const lowered = result.sourceFile;

  assert.deepEqual(variableNames(fixture.source, lowered), ["checkedBox"]);
  assert.equal(countNilChecks(fixture.source, lowered), 1);
  assert.deepEqual(nilCheckEvidence(result.transaction), {
    profile: "closed-direct",
    analyzed: true,
    candidateGuardCount: 3,
    optimizedBindingCount: 1,
    optimizedGuardCount: 3,
    eliminatedGuardCount: 2,
    retainedGuardCount: 0,
    fallbackReasons: [],
  });
});

test("recognizes an exact load erased by closed pointer lowering", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function panic(): never { throw new Error("nil"); }
class Box { value = 1; }
function make(): Pointer<Box> { return allocatePointer(new Box()); }
function run(): number {
  const box: Pointer<Box> | undefined = make();
  loadPointer(box ?? panic()).value = loadPointer(box ?? panic()).value + 1;
  return loadPointer(box ?? panic()).value;
}
export const result = run();
`);
  const result = lowerFixture(fixture);

  assert.deepEqual(
    variableNames(fixture.source, result.sourceFile),
    ["checkedBox"],
  );
  assert.equal(countNilChecks(fixture.source, result.sourceFile), 1);
  assert.equal(nilCheckEvidence(result.transaction).eliminatedGuardCount, 2);
});

test("retains guards for mutable and conditional-first bindings", () => {
  const fixture = checkedPointerFixture(`function panic(): never { throw new Error("nil"); }
interface Box { value: number }
declare function replacement(): Box | undefined;
declare function use(value: number): void;
export function mutable(box: Box | undefined): number {
  box = replacement();
  (box ?? panic()).value = (box ?? panic()).value + 1;
  return (box ?? panic()).value;
}
export function conditional(box: Box | undefined, enabled: boolean): number {
  if (enabled) use((box ?? panic()).value);
  return (box ?? panic()).value;
}
`);
  const lowered = lowerIndex(fixture);

  assert.deepEqual(variableNames(fixture.source, lowered), []);
  assert.equal(countNilChecks(fixture.source, lowered), 5);
});

test("retains dominating guards through first-declarator value snapshots", () => {
  const fixture = checkedPointerFixture(`function panic(): never { throw new Error("nil"); }
interface Box { value: number }
declare function effect(): number;
export function read(box: Box | undefined): number {
  let value: number = (box ?? panic()).value;
  return value + (box ?? panic()).value;
}
export function first(box: Box | undefined): number {
  const value = (box ?? panic()).value, other = effect();
  return value + other + (box ?? panic()).value;
}
`);
  const result = lowerFixture(fixture);
  assert.equal(countNilChecks(fixture.source, result.sourceFile), 2);
  assert.equal(nilCheckEvidence(result.transaction).optimizedBindingCount, 2);
  assert.equal(nilCheckEvidence(result.transaction).eliminatedGuardCount, 2);
});

test("snapshot anchors cannot cross earlier effects or conditional evaluation", () => {
  const fixture = checkedPointerFixture(`function panic(): never { throw new Error("nil"); }
interface Box { value: number }
declare function effect(): number;
declare function call(): (value: number) => number;
export function later(box: Box | undefined): number {
  const first = effect(), value = (box ?? panic()).value;
  return first + value + (box ?? panic()).value;
}
export function conditional(box: Box | undefined, enabled: boolean): number {
  const value = enabled ? (box ?? panic()).value : 0;
  return value + (box ?? panic()).value;
}
export function argument(box: Box | undefined): number {
  const value = call()((box ?? panic()).value);
  return value + (box ?? panic()).value;
}
export function loop(box: Box | undefined): number {
  for (let index = (box ?? panic()).value; index < 1; index++) effect();
  return (box ?? panic()).value;
}
`);
  const result = lowerFixture(fixture);
  assert.equal(countNilChecks(fixture.source, result.sourceFile), 8);
  assert.equal(nilCheckEvidence(result.transaction).eliminatedGuardCount, 0);
});

test("does not cross a nested callable and reserves a collision-free name", () => {
  const fixture = checkedPointerFixture(`function panic(): never { throw new Error("nil"); }
interface Box { value: number }
export function read(box: Box | undefined): number {
  const checkedBox = 0;
  (box ?? panic()).value = (box ?? panic()).value + 1;
  const nested = () => (box ?? panic()).value;
  return checkedBox + nested();
}
`);
  const result = lowerFixture(fixture);
  const lowered = result.sourceFile;

  assert.deepEqual(
    variableNames(fixture.source, lowered),
    ["checkedBox", "checkedBox2"],
  );
  assert.equal(countNilChecks(fixture.source, lowered), 2);
  const evidence = nilCheckEvidence(result.transaction);
  assert.equal(evidence.eliminatedGuardCount, 1);
  assert.deepEqual(
    evidence.fallbackReasons.map(({ reason, count }) => ({ reason, count })),
    [{ reason: "no-direct-block-owner", count: 1 }],
  );
});

function lowerIndex(
  fixture: ReturnType<typeof checkedPointerFixture>,
): SourceFile {
  return lowerFixture(fixture).sourceFile;
}

function lowerFixture(
  fixture: ReturnType<typeof checkedPointerFixture>,
): {
  readonly sourceFile: SourceFile;
  readonly transaction: TypeScriptLoweringTransaction;
} {
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      representationProjections: "closed-direct",
    },
    (sourceFile) => fixture.source.ast.getFileName(sourceFile),
  ));
  let lowered: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      lowered = result.sourceFile;
    }
  }
  transaction.finish();
  assert.ok(lowered !== undefined);
  return { sourceFile: lowered, transaction };
}

function nilCheckEvidence(transaction: TypeScriptLoweringTransaction) {
  const pointer = transaction.evidence.pointer;
  assert.equal(pointer.profile, "closed-direct");
  if (pointer.profile !== "closed-direct") {
    assert.fail("closed-direct nil-check evidence was not produced");
  }
  const evidence = pointer.dominatingNilChecks;
  assert.equal(evidence.profile, "closed-direct");
  if (evidence.profile !== "closed-direct") {
    assert.fail("closed-direct nil-check evidence was not produced");
  }
  return evidence;
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

function countNilChecks(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
): number {
  let count = 0;
  visit(source, root, (node) => {
    if (
      source.ast.is.IsBinaryExpression(node) &&
      source.ast.operatorKindName(node) === "KindQuestionQuestionToken"
    ) {
      count += 1;
    }
  });
  return count;
}

function variableNames(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
): readonly string[] {
  const names: string[] = [];
  visit(source, root, (node) => {
    if (!IsVariableDeclaration(node)) {
      return;
    }
    const declaration = AsVariableDeclaration(node);
    const name = declaration === undefined
      ? undefined
      : source.ast.text(declaration.name);
    if (name?.startsWith("checkedBox") === true) {
      names.push(name);
    }
  });
  return names;
}
