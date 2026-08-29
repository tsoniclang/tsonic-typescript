import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerFactKey, pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";
import { lowerPointers } from "./transform.js";

const closedProjection = `import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  get value(): number { return this.storage.value; }
}
let storage = new Storage(42);
const source: Pointer<Storage> = addressOf(storage);
export const result = loadPointer(projectPointer<Storage, Box>(
  source,
  (value) => new Box(value),
  (value) => value.storage,
)!).value;
`;

test("fuses an immediate projected-object read", () => {
  const fixture = checkedPointerFixture(closedProjection);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentation(fixture.source, plan, "address-of", "location");
  assert.equal(plan.optimizedProjectionReadCount, 1);

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
  assert.equal(countArrowFunctions(fixture.source, lowered.sourceFile), 3);
});

test("fuses an immediate projected-scalar read", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
let storage = 21;
const source: Pointer<number> = addressOf(storage);
export const result = loadPointer(projectPointer<number, string>(
  source,
  (value) => String(value * 2),
  (value) => Number(value) / 2,
)!);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentation(fixture.source, plan, "address-of", "location");
  assert.equal(plan.optimizedProjectionReadCount, 1);
});

test("fuses an immediate projected store", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, projectPointer, storePointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
storePointer(projectPointer<Storage, Box>(
  source,
  (value) => new Box(value),
  (value) => value.storage,
)!, new Box(new Storage(2)));
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedProjectionStoreCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "storePointer"), 0);
  assert.equal(countArrowFunctions(fixture.source, lowered.sourceFile), 3);
});

test("keeps an identity-observed projection canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, hashPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
export const result = hashPointer(projected);
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.projectionCallables.exactProjectionCount, 1);
  assert.equal(plan.optimizedStoredProjectionCount, 0);
  assert.equal(plan.optimizedProjectionReadCount, 0);
  assert.equal(plan.optimizedProjectionStoreCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("keeps nonliteral projection callbacks canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
function fromStorage(value: Storage): Box { return new Box(value); }
function toStorage(value: Box): Storage { return value.storage; }
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
export const result = loadPointer(projectPointer<Storage, Box>(
  source,
  fromStorage,
  toStorage,
)!).storage.value;
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedProjectionReadCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("keeps function-expression projection callbacks canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
export const result = loadPointer(projectPointer<Storage, Box>(
  source,
  function (value: Storage): Box { return new Box(value); },
  function (value: Box): Storage { return value.storage; },
)!).storage.value;
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedProjectionReadCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("fuses a nullable projected read without moving observable work", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
export function read(source: Pointer<Storage> | undefined): number {
  return loadPointer(projectPointer<Storage, Box>(
    source,
    (value) => new Box(value),
    (value) => value.storage,
  )!).storage.value;
}
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedProjectionReadCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 0);
});

test("keeps nullable projected stores canonical to preserve value evaluation", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { projectPointer, storePointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
export function write(source: Pointer<Storage> | undefined): void {
  storePointer(projectPointer<Storage, Box>(
    source,
    (value) => new Box(value),
    (value) => value.storage,
  )!, new Box(new Storage(2)));
}
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedProjectionStoreCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("keeps generic possibly-null projected stores canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { projectPointer, storePointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
export function write<P extends Pointer<Storage> | undefined>(source: P): void {
  storePointer(projectPointer<Storage, Box>(
    source,
    (value) => new Box(value),
    (value) => value.storage,
  )!, new Box(new Storage(2)));
}
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  assert.equal(plan.optimizedProjectionStoreCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("keeps a stored projection live and canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
storage = new Storage(2);
export const result = loadPointer(projected).storage.value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.projectionCallables.exactProjectionCount, 1);
  assert.equal(plan.optimizedStoredProjectionCount, 0);
  assert.equal(plan.optimizedProjectionReadCount, 0);
  assert.equal(plan.optimizedProjectionStoreCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("keeps a nested storage contract coherent with a canonical projection", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
class Holder { pointer: Pointer<Box> | undefined = undefined; }
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
storage = new Storage(2);
const holder = new Holder();
holder.pointer = projected;
export const result = holder.pointer === undefined
  ? 0
  : loadPointer(holder.pointer).storage.value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.deepEqual(
    new Set(pointerRepresentationsFor(fixture.source, plan, "Box")),
    new Set(["location"]),
  );
  assert.ok(plan.fallbackReasons.some((entry) =>
    entry.reason === "representation-contract"
  ));
  assert.equal(plan.optimizedFamilyCount, 0);
  assert.ok(plan.retainedFamilyCount >= 1);
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "representation-contract" && entry.count === 1
  ));
  assert.ok(plan.retainedFamilyHotspots.some((family) =>
    family.reasons.some((entry) => entry.reason === "representation-contract")
  ));
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

test("keeps a callable pointer contract coherent with a canonical argument", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
function invoke(
  callback: (value: Pointer<Box>) => number,
  value: Pointer<Box>,
): number {
  return callback(value);
}
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
storage = new Storage(2);
export const result = invoke(
  (value) => loadPointer(value).storage.value,
  projected,
);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.deepEqual(
    new Set(pointerRepresentationsFor(fixture.source, plan, "Box")),
    new Set(["location"]),
  );
  assert.ok(plan.fallbackReasons.some((entry) =>
    entry.reason === "representation-contract"
  ));
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "representation-contract" && entry.count === 1
  ));
});

test("contracts an exact stored read-only projection over stable storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
function read(projected: Pointer<Box>): number {
  return loadPointer(projected).storage.value;
}
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
export const result = read(projected);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.projectionCallables.exactProjectionCount, 1);
  assert.equal(plan.optimizedStoredProjectionCount, 1);
  assertRepresentation(fixture.source, plan, "project-pointer", "direct-object");
  assertRepresentation(fixture.source, plan, "load", "direct-object");
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("settles chained exact projections in source dependency order", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
class Outer {
  constructor(readonly box: Box) {}
  static fromBox(value: Box): Outer { return new Outer(value); }
  static toBox(value: Outer): Box { return value.box; }
}
function read(projected: Pointer<Outer>): number {
  return loadPointer(projected).box.storage.value;
}
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const box: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
const outer: Pointer<Outer> = projectPointer<Box, Outer>(
  box,
  (value) => Outer.fromBox(value),
  (value) => Outer.toBox(value),
)!;
export const result = read(outer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.projectionCallables.exactProjectionCount, 2);
  assert.equal(plan.optimizedStoredProjectionCount, 2);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("propagates a retained representation contract through dependent projections", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
class Outer {
  constructor(readonly box: Box) {}
  static fromBox(value: Box): Outer { return new Outer(value); }
  static toBox(value: Outer): Box { return value.box; }
}
class Holder { pointer: Pointer<Box> | undefined = undefined; }
let unstableStorage = new Storage(1);
const unstableSource: Pointer<Storage> = addressOf(unstableStorage);
const retainedBox: Pointer<Box> = projectPointer<Storage, Box>(
  unstableSource,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
unstableStorage = new Storage(2);
const holder = new Holder();
holder.pointer = retainedBox;
let stableStorage = new Storage(3);
const stableSource: Pointer<Storage> = addressOf(stableStorage);
const box: Pointer<Box> = projectPointer<Storage, Box>(
  stableSource,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
const outer: Pointer<Outer> = projectPointer<Box, Outer>(
  box,
  (value) => Outer.fromBox(value),
  (value) => Outer.toBox(value),
)!;
export const result = loadPointer(outer).box.storage.value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const projections = pointerOperations(fixture.source).filter((operation) =>
    operation.operation === "project-pointer"
  );

  assert.equal(projections.length, 3);
  for (const projection of projections) {
    assert.equal(plan.representationFor(projection.call), "location");
  }
  assert.equal(plan.optimizedStoredProjectionCount, 0);
  assert.ok(plan.fallbackReasons.some((entry) =>
    entry.reason === "projection-observed"
  ));
});

test("keeps an observable projected constructor canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box {
  static created = 0;
  constructor(readonly storage: Storage) { Box.created += 1; }
  static fromStorage(value: Storage): Box { return new Box(value); }
  static toStorage(value: Box): Storage { return value.storage; }
}
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => Box.fromStorage(value),
  (value) => Box.toStorage(value),
)!;
export const result = loadPointer(projected).storage.value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.projectionCallables.exactProjectionCount, 0);
  assert.equal(plan.optimizedStoredProjectionCount, 0);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
});

function assertRepresentation(
  source: Parameters<typeof visit>[0],
  plan: ClosedPointerFlowPlan,
  operationKind: PointerOperationFact["operation"],
  expected: ReturnType<ClosedPointerFlowPlan["representationFor"]>,
): void {
  const operation = operationOfKind(source, operationKind);
  assert.equal(plan.representationFor(operation.call), expected);
}

function pointerRepresentationsFor(
  source: Parameters<typeof visit>[0],
  plan: ClosedPointerFlowPlan,
  pointeeName: string,
): readonly ReturnType<ClosedPointerFlowPlan["representationFor"]>[] {
  const representations: ReturnType<
    ClosedPointerFlowPlan["representationFor"]
  >[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const fact = source.sourceFacts.getFact(node, pointerFactKey);
      const pointee = fact === undefined
        ? undefined
        : source.ast.as.AsTypeReferenceNode(fact.pointee)?.TypeName ?? fact.pointee;
      if (
        source.ast.is.IsTypeReferenceNode(node) &&
        fact !== undefined &&
        source.ast.text(pointee) === pointeeName
      ) {
        representations.push(plan.representationFor(node));
      }
    });
  }
  assert.ok(representations.length > 1);
  return representations;
}

function countArrowFunctions(
  source: Parameters<typeof visit>[0],
  root: Node,
): number {
  let count = 0;
  visit(source, root, (node) => {
    if (source.ast.is.IsArrowFunction(node)) {
      count += 1;
    }
  });
  return count;
}

function operationOfKind(
  source: Parameters<typeof visit>[0],
  operationKind: PointerOperationFact["operation"],
): PointerOperationFact {
  const selected = pointerOperations(source).filter((operation) =>
    operation.operation === operationKind
  );
  assert.equal(selected.length, 1, `expected one ${operationKind} operation`);
  const operation = selected[0];
  assert.ok(operation !== undefined, `missing ${operationKind} operation`);
  return operation;
}

function pointerOperations(
  source: Parameters<typeof visit>[0],
): readonly PointerOperationFact[] {
  const selected: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node: Node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        selected.push(operation);
      }
    });
  }
  return selected;
}
