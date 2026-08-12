import assert from "node:assert/strict";
import test from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  createTargetProgramIndex,
  type TargetProgramIndex,
} from "../program-index.js";
import { analyzePointerCallableAliases } from "./flow-callable-aliases.js";
import type { PointerFlowBlocker } from "./flow-graph.js";
import { createFixturePointerFlowPlan } from "./pointer.test-support.js";
import {
  checkedPointerFixture,
  countCallsNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("settles an exact immutable callable-alias chain transactionally", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const first = read;
const second = first;
const pointer: Pointer<number> = allocatePointer(41);
export const result = second(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "direct-snapshot");
  assert.equal(aliasAnalysis(fixture.source, "read").optimizedAliasCount, 2);
  assert.equal(settledOperationComponentCount(plan), 1);
  assert.equal(operationReasonCount(plan, "indirect-call"), 0);

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const loweredRead = findCallableWithin(
    fixture.source,
    lowered.sourceFile,
    "read",
  );
  const loweredParameter = fixture.source.ast.parameters(loweredRead)[0];
  assert.equal(lowered.runtimeAlias, undefined);
  assert.equal(
    fixture.source.ast.kindName(fixture.source.ast.typeNode(loweredParameter)),
    "KindNumberKeyword",
  );
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("keeps static-member aliases canonical without complete member flow", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Reader {
  static read(pointer: Pointer<number>): number { return loadPointer(pointer); }
}
const read = Reader.read;
const pointer: Pointer<number> = allocatePointer(41);
export const result = read(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "location");
  assert.equal(aliasAnalysis(fixture.source, "read").optimizedAliasCount, 0);
  assert.equal(settledOperationComponentCount(plan), 0);
  assert.equal(operationReasonCount(plan, "indirect-call"), 1);
});

test("keeps the whole family canonical when one alias escapes", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
function consume(callback: (pointer: Pointer<number>) => number): number {
  return callback(allocatePointer(1));
}
const alias = read;
const pointer: Pointer<number> = allocatePointer(41);
read(pointer);
export const result = consume(alias);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "location");
  assert.equal(aliasAnalysis(fixture.source, "read").optimizedAliasCount, 0);
  assert.equal(settledOperationComponentCount(plan), 0);
  assert.equal(operationReasonCount(plan, "indirect-call"), 1);
});

test("settles an exact alias that transports a pointer result", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function create(): Pointer<number> { return allocatePointer(41); }
const alias = create;
const pointer: Pointer<number> = alias();
export const result = loadPointer(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "direct-snapshot");
  assert.equal(aliasAnalysis(fixture.source, "create").optimizedAliasCount, 1);
  assert.equal(settledOperationComponentCount(plan), 1);
  assert.equal(operationReasonCount(plan, "indirect-call"), 0);

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(lowered.runtimeAlias, undefined);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("fails closed when the alias call loses its exact selected signature", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const alias = read;
const pointer: Pointer<number> = allocatePointer(41);
export const result = alias(pointer);
`);
  const aliasCall = findCall(fixture.source, "alias");
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    semantics: Object.freeze({
      ...fixture.source.semantics,
      forNode(node: Node) {
        const semantics = fixture.source.semantics.forNode(node);
        return node === aliasCall
          ? Object.freeze({
              ...semantics,
              getResolvedCallInfo: () => undefined,
            })
          : semantics;
      },
    }),
  });
  const plan = createFixturePointerFlowPlan(source);

  assertRepresentations(source, plan, "location");
  assert.equal(aliasAnalysis(source, "read").optimizedAliasCount, 0);
  assert.equal(settledOperationComponentCount(plan), 0);
  assert.equal(operationReasonCount(plan, "indirect-call"), 1);
});

test("keeps exported callable aliases canonical at the module boundary", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
import { read } from "./reader.js";
const alias = read;
const pointer: Pointer<number> = allocatePointer(41);
export const result = alias(pointer);
`, {
    "/src/reader.ts": `import type { Pointer } from "./markers.js";
import { loadPointer } from "./markers.js";
export function read(pointer: Pointer<number>): number {
  return loadPointer(pointer);
}
`,
  });
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "location");
  assert.equal(aliasAnalysis(fixture.source, "read").optimizedAliasCount, 0);
  assert.equal(settledOperationComponentCount(plan), 0);
  assert.equal(operationReasonCount(plan, "indirect-call"), 1);
});

test("preserves dynamic instance-method dispatch and mutable aliases", () => {
  const fixtures = [
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Base {
  read(pointer: Pointer<number>): number { return loadPointer(pointer); }
}
class Derived extends Base {
  override read(pointer: Pointer<number>): number { return loadPointer(pointer) + 1; }
}
const reader: Base = new Derived();
const pointer: Pointer<number> = allocatePointer(41);
export const result = reader.read(pointer);
`),
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
function other(pointer: Pointer<number>): number { return loadPointer(pointer) + 1; }
let alias = read;
alias = other;
const pointer: Pointer<number> = allocatePointer(41);
export const result = alias(pointer);
`),
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const alias: (pointer: Pointer<number>) => number = read;
const pointer: Pointer<number> = allocatePointer(41);
export const result = alias(pointer);
`),
  ];

  for (const fixture of fixtures) {
    assertRepresentations(
      fixture.source,
      createFixturePointerFlowPlan(fixture.source),
      "location",
    );
  }
});

test("proves callable-alias analysis has bounded linear construction work", () => {
  const small = aliasWork(64);
  const large = aliasWork(128);

  assert.equal(small.optimizedAliasCount, 64);
  assert.equal(large.optimizedAliasCount, 128);
  assert.ok(small.traversalOperations <= small.nodeCount * 4);
  assert.ok(large.traversalOperations <= large.nodeCount * 4);
  assert.ok(
    large.traversalOperations <= small.traversalOperations * 2 + 32,
    `${small.traversalOperations} -> ${large.traversalOperations}`,
  );
  assert.ok(128 ** 2 > 64 ** 2 * 3);
});

function assertRepresentations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  expected: "direct-snapshot" | "location",
): void {
  const operations = pointerOperations(source);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), expected);
  }
}

function operationReasonCount(
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  reason: PointerFlowBlocker,
): number {
  return plan.components.filter((component) =>
    component.operationCount > 0 && component.blockers.includes(reason)
  ).length;
}

function settledOperationComponentCount(
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
): number {
  return plan.components.filter((component) =>
    component.operationCount > 0 && component.representation !== "location"
  ).length;
}

function pointerOperations(source: TargetSourceProgram): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }
  return operations;
}

function findCall(source: TargetSourceProgram, name: string): Node {
  let result: Node | undefined;
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      if (!source.ast.is.IsCallExpression(node)) {
        return;
      }
      const expression = source.ast.as.AsCallExpression(node)?.Expression;
      if (
        expression !== undefined &&
        source.ast.text(source.ast.name(expression) ?? expression) === name
      ) {
        result = node;
      }
    });
  }
  assert.ok(result !== undefined);
  return result;
}

function aliasWork(aliasCount: number): {
  readonly nodeCount: number;
  readonly optimizedAliasCount: number;
  readonly traversalOperations: number;
} {
  const aliases = Array.from({ length: aliasCount }, (_, index) =>
    `const alias${index} = ${index === 0 ? "read" : `alias${index - 1}`};`
  ).join("\n");
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
${aliases}
const pointer: Pointer<number> = allocatePointer(41);
export const result = alias${aliasCount - 1}(pointer);
`);
  const program = pointerProgramIndex(fixture.source);
  const analysis = aliasAnalysis(fixture.source, "read", program);
  return {
    nodeCount: program.nodes.length,
    optimizedAliasCount: analysis.optimizedAliasCount,
    traversalOperations: analysis.traversalOperations,
  };
}

function aliasAnalysis(
  source: TargetSourceProgram,
  name: string,
  program: TargetProgramIndex = pointerProgramIndex(source),
): ReturnType<typeof analyzePointerCallableAliases> {
  return analyzePointerCallableAliases(
    source,
    program,
    new Set([findCallable(source, name)]),
  );
}

function pointerProgramIndex(source: TargetSourceProgram): TargetProgramIndex {
  return createTargetProgramIndex(source, {
    bindingWrites: true,
    memberDispatch: false,
  });
}

function findCallable(source: TargetSourceProgram, name: string): Node {
  let result: Node | undefined;
  for (const sourceFile of source.navigation.sourceFiles) {
    const candidate = findCallableInRoot(source, sourceFile, name);
    result ??= candidate;
  }
  assert.ok(result !== undefined);
  return result;
}

function findCallableWithin(
  source: TargetSourceProgram,
  root: Node,
  name: string,
): Node {
  const result = findCallableInRoot(source, root, name);
  assert.ok(result !== undefined);
  return result;
}

function findCallableInRoot(
  source: TargetSourceProgram,
  root: Node,
  name: string,
): Node | undefined {
  let result: Node | undefined;
  visit(source, root, (node) => {
    if (
      (source.ast.is.IsFunctionDeclaration(node) ||
        source.ast.is.IsMethodDeclaration(node)) &&
      source.ast.text(source.ast.name(node)) === name
    ) {
      result = node;
    }
  });
  return result;
}
