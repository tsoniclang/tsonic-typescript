import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type {
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsBinaryExpression,
  KindEqualsEqualsEqualsToken,
} from "@tsonic/tsts/target-ast";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan as createClosedPointerFlowPlan,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses one direct object representation across a closed class family", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder { pointer: Pointer<Box> | undefined = undefined; }
function read(pointer: Pointer<Box> | undefined): number {
  return pointer === undefined ? 0 : loadPointer(pointer).value;
}
function invoke(
  callback: (pointer: Pointer<Box> | undefined) => number,
  pointer: Pointer<Box> | undefined,
): number {
  return callback(pointer);
}
const holder = new Holder();
holder.pointer = allocatePointer(new Box());
export const result = invoke(read, holder.pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
  const lowered = lowerPointers(
    fixture.source,
    fixture.sourceFile,
    plan,
  );
  assert.equal(lowered.runtimeAlias, undefined);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("keeps a class family canonical when pointee storage is replaced", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer(new Box());
storePointer(pointer, new Box());
export const result = loadPointer(pointer).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps a class family canonical for an unstable addressed variable", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer } from "./markers.js";
class Box { value = 1; }
let box = new Box();
const pointer: Pointer<Box> = addressOf(box);
box = new Box();
export const result = loadPointer(pointer).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps a class family canonical across an ambient boundary", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
import { observe } from "./external.js";
export class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer(new Box());
observe(pointer);
export const result = loadPointer(pointer).value;
`, {
    "/src/external.d.ts": `import type { Pointer } from "./markers.js";
import type { Box } from "./index.js";
export declare function observe(pointer: Pointer<Box>): void;
`,
  });

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps a class family canonical across a representation-bearing generic call", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
function singleton<T>(value: Pointer<T>): Array<Pointer<T>> {
  return [value];
}
const pointer: Pointer<Box> = allocatePointer(new Box());
export const result = loadPointer(singleton(pointer)[0]!).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("blocks a generic pointer call reached through concrete family storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder { pointer: Pointer<Box> | undefined = undefined; }
function singleton<T>(value: Pointer<T>): Array<Pointer<T>> {
  return [value];
}
const holder = new Holder();
holder.pointer = allocatePointer(new Box());
export const values = singleton(holder.pointer);
export const result = loadPointer(holder.pointer).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("allows a class family through a representation-neutral generic call", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
function identity<T>(value: T): T {
  return value;
}
const pointer: Pointer<Box> = allocatePointer(new Box());
export const result = loadPointer(identity(pointer)).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
  assert.equal(
    plan.familyFallbackReasons.some((entry) =>
      entry.reason === "generic-call" || entry.reason === "generic-storage"
    ),
    false,
  );
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("uses direct objects for a generic nominal pointee family", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box<T> { constructor(public value: T) {} }
function read<T>(pointer: Pointer<Box<T>>): T {
  return loadPointer(pointer).value;
}
const pointer: Pointer<Box<number>> = allocatePointer(new Box(42));
export const result = read(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(
    countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"),
    0,
  );
});

test("keeps representation-varying generic pointees canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
function read<T>(pointer: Pointer<T>): T {
  return loadPointer(pointer);
}
const pointer: Pointer<Box> = allocatePointer(new Box());
export const result = read(pointer).value;
`);

  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "generic-call" || entry.reason === "generic-storage"
  ));
});

test("uses direct objects through generic nominal storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box<T> { constructor(public value: T) {} }
class Holder<T> { pointer: Pointer<Box<T>> | undefined = undefined; }
const holder = new Holder<number>();
holder.pointer = allocatePointer(new Box(42));
export const result = loadPointer(holder.pointer).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
});

test("keeps generic nominal pointees canonical when storage is replaced", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box<T> { constructor(public value: T) {} }
function replace<T>(pointer: Pointer<Box<T>>, value: T): void {
  storePointer(pointer, new Box(value));
}
const pointer: Pointer<Box<number>> = allocatePointer(new Box(1));
replace(pointer, 42);
export const result = loadPointer(pointer).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "pointee-replacement"
    )?.count,
    1,
  );
});

test("keeps a class family canonical through generic pointer storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
class Holder<T> { pointer: Pointer<T> | undefined = undefined; }
const holder = new Holder<Box>();
holder.pointer = allocatePointer(new Box());
export const result = loadPointer(holder.pointer!).value;
`);

  assertAllOperations(
    fixture.source,
    createClosedPointerFlowPlan(fixture.source),
    "location",
  );
});

test("keeps distinct pointer identity when one object is allocated twice", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, loadPointer } from "./markers.js";
class Box { value = 1; }
const box = new Box();
const left: Pointer<Box> = allocatePointer(box);
const right: Pointer<Box> = allocatePointer(box);
export const same = equalPointer(left, right);
export const result = loadPointer(left).value + loadPointer(right).value;
`);

  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  const identity = plan.familyFallbackReasons.find((entry) =>
    entry.reason === "non-bijective-identity"
  );
  assert.equal(identity?.count, 1);
  assert.ok(identity.examples.length > 0);
});

test("uses fresh object identity for equality and hashing", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, hashPointer, loadPointer } from "./markers.js";
class Box { value = 1; }
const first: Pointer<Box> = allocatePointer(new Box());
const alias = first;
const second: Pointer<Box> = allocatePointer(new Box());
export const result = [
  loadPointer(first).value,
  equalPointer(first, alias),
  equalPointer(first, second),
  hashPointer(first) === hashPointer(alias),
];
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.ok(lowered.runtimeAlias !== undefined);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "equalPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "rawPointer"), 2);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashRawPointer"), 2);
});

test("uses exact fresh static factories for pointer identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, loadPointer } from "./markers.js";
class Box {
  private constructor(public value: number) {}
  static create(value: number): Box { return new Box(value); }
  static zero(): Box { return Box.create(0); }
}
const first: Pointer<Box> = allocatePointer(Box.zero());
const alias = first;
const second: Pointer<Box> = allocatePointer(Box.create(1));
export const result = [
  loadPointer(first).value,
  equalPointer(first, alias),
  equalPointer(first, second),
];
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertAllOperations(fixture.source, plan, "direct-object");
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "equalPointer"), 0);
});

test("rejects static factories whose result can share identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box {
  static readonly shared = new Box();
  static create(): Box { return Box.shared; }
}
const left: Pointer<Box> = allocatePointer(Box.create());
const right: Pointer<Box> = allocatePointer(Box.create());
export const same = equalPointer(left, right);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.examples.length,
    2,
  );
});

test("rejects a fresh factory when its exact member binding changes", () => {
  const unchanged = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box {
  static readonly shared = new Box();
  static create(): Box { return new Box(); }
}
const left: Pointer<Box> = allocatePointer(Box.create());
const right: Pointer<Box> = allocatePointer(Box.create());
export const same = equalPointer(left, right);
`);
  assertAllOperations(
    unchanged.source,
    createClosedPointerFlowPlan(unchanged.source),
    "direct-object",
  );

  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box {
  static readonly shared = new Box();
  static create(): Box { return new Box(); }
}
Box.create = () => Box.shared;
const left: Pointer<Box> = allocatePointer(Box.create());
const right: Pointer<Box> = allocatePointer(Box.create());
export const same = equalPointer(left, right);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.examples.length,
    2,
  );
});

test("rejects recursive factory proofs without guessing freshness", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box {
  static first(): Box { return Box.second(); }
  static second(): Box { return Box.first(); }
}
const left: Pointer<Box> = allocatePointer(Box.first());
const right: Pointer<Box> = allocatePointer(Box.second());
export const same = equalPointer(left, right);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});

test("emits direct pointer equality as strict object identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box { value = 1; }
const left: Pointer<Box> = allocatePointer(new Box());
const right: Pointer<Box> = allocatePointer(new Box());
export const same = equalPointer(left, right);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const initializer = variableDeclarationNamed(
    fixture.source,
    lowered.sourceFile,
    "same",
  ).Initializer;
  const comparison = AsBinaryExpression(initializer);

  assert.equal(comparison?.OperatorToken?.Kind, KindEqualsEqualsEqualsToken);
  assert.equal(fixture.source.ast.text(comparison?.Left), "left");
  assert.equal(fixture.source.ast.text(comparison?.Right), "right");
});

test("evaluates a nullable direct pointer once while hashing", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer } from "./markers.js";
class Box { value = 1; }
let evaluations = 0;
function nextPointer(): Pointer<Box> | undefined {
  evaluations += 1;
  return evaluations === 1 ? allocatePointer(new Box()) : undefined;
}
export const result = [hashPointer(nextPointer()), evaluations];
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "direct-object");
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "nextPointer"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "rawPointer"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashRawPointer"), 1);
});

test("keeps addressed identity in the canonical location representation", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { value = 1; }
let first = new Box();
let second = first;
const left: Pointer<Box> = addressOf(first);
const right: Pointer<Box> = addressOf(second);
export const same = equalPointer(left, right);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});

test("keeps replacement-returning constructors in canonical locations", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
class Box {
  value = 1;
  constructor(existing?: Box) {
    if (existing !== undefined) return existing;
  }
}
const shared = new Box();
const left: Pointer<Box> = allocatePointer(new Box(shared));
const right: Pointer<Box> = allocatePointer(new Box(shared));
export const same = equalPointer(left, right);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});

function assertAllOperations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createClosedPointerFlowPlan>,
  expected: "direct-object" | "location",
): void {
  const operations = pointerOperations(source);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), expected);
  }
}

function pointerOperations(
  source: TargetSourceProgram,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }
  return operations;
}
