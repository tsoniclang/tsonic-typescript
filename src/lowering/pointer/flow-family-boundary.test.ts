import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("keeps only the generic callback flow canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
import { GenericInvoker } from "./generic.js";
class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer(new Box());
const replace = (value: Pointer<Box>): void => storePointer(value, new Box());
GenericInvoker.invoke<Box>(replace);
export const result = loadPointer(pointer).value;
`, {
    "/src/generic.ts": `import type { Pointer } from "./markers.js";
export class GenericInvoker {
  static invoke<T>(callback: (pointer: Pointer<T>) => void): void {
    void callback;
  }
}
`,
  });

  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations = pointerOperations(fixture.source);
  const byOperation = new Map(
    operations.map((operation) => [operation.operation, operation]),
  );
  assert.equal(plan.representationFor(byOperation.get("allocate")?.call), "direct-object");
  assert.equal(plan.representationFor(byOperation.get("load")?.call), "direct-object");
  assert.equal(plan.representationFor(byOperation.get("store")?.call), "location");
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "generic-call"
  ));
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("keeps checker-never pointer expressions behind the canonical load", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box { value = 1; }
function stop(): never { throw new Error("missing callback result"); }
function deliver(callback: (pointer: Pointer<Box>) => void): void {
  callback(allocatePointer(new Box()));
}
let result: [Pointer<Box>] | undefined = undefined;
deliver((pointer) => { result = [pointer]; });
if (result === undefined) stop();
storePointer<Box>(result[0], new Box());
export const value = loadPointer<Box>(result[0]).value;
`);

  const plan = createFixturePointerFlowPlan(fixture.source);
  const neverExpressions = pointerOperations(fixture.source)
    .filter((operation) =>
      operation.operation === "load" || operation.operation === "store"
    )
    .map((operation) => operation.pointerExpression)
    .filter((expression) => {
      const semantics = fixture.source.semantics.forNode(expression);
      const type = semantics.types.expressionType(expression);
      return type !== undefined && semantics.types.isNever(type);
    });
  assert.ok(neverExpressions.length > 0);

  assertAllOperations(fixture.source, plan, "location");
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "checker-never"
  ));
});

test("keeps only the projected pointer flow canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, allocatePointer, loadPointer, projectPointer } from "./markers.js";
class Storage { constructor(public value: number) {} }
class Box { constructor(readonly storage: Storage) {} }
let storage = new Storage(1);
const source: Pointer<Storage> = addressOf(storage);
const projected: Pointer<Box> = projectPointer<Storage, Box>(
  source,
  (value) => new Box(value),
  (value) => value.storage,
)!;
const independent: Pointer<Box> = allocatePointer(new Box(new Storage(2)));
export const result = [
  loadPointer(projected).storage.value,
  loadPointer(independent).storage.value,
];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations = pointerOperations(fixture.source);
  const projection = operations.find((operation) =>
    operation.operation === "project-pointer"
  );
  const allocation = operations.find((operation) =>
    operation.operation === "allocate"
  );
  const loads = operations.filter((operation) => operation.operation === "load");
  assert.ok(projection !== undefined);
  assert.ok(allocation !== undefined);
  assert.equal(loads.length, 2);
  assert.equal(plan.representationFor(projection.call), "location");
  assert.equal(plan.representationFor(allocation.call), "direct-object");
  assert.deepEqual(
    loads.map((operation) => plan.representationFor(operation.call)).sort(),
    ["direct-object", "location"],
  );
});

function assertAllOperations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  expected: "location",
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
