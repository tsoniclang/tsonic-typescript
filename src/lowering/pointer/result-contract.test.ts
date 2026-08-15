import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pointerOperationFactKey,
  rawPointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  RawPointerOperationFact,
} from "@tsonic/tsts";

import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { createPointerResultContract } from "./result-contract.js";

test("classifies every canonical pointer operation by its lowered result", () => {
  const fixture = checkedPointerFixture(`
import {
  addressOf,
  allocatePointer,
  bindPointer,
  bindRawPointer,
  equalPointer,
  equalRawPointer,
  hashPointer,
  hashRawPointer,
  loadPointer,
  projectPointer,
  storePointer,
} from "./markers.js";
let value = 1;
const addressed = addressOf(value);
const allocated = allocatePointer(2);
const bound = bindPointer({}, () => value, next => { value = next; });
const projected = projectPointer(bound, current => String(current), Number);
loadPointer(addressed);
storePointer(allocated, 3);
equalPointer(addressed, allocated);
hashPointer(projected);
const raw = bindRawPointer({});
equalRawPointer(raw, raw);
hashRawPointer(raw);
`);
  const contract = createPointerResultContract(fixture.source, undefined);

  for (const operation of pointerOperations(fixture.source, fixture.sourceFile)) {
    assert.equal(
      contract.isDefinitelyNonThenable(operation.call, () => false),
      operation.operation !== "load",
      operation.operation,
    );
  }
  for (const operation of rawPointerOperations(
    fixture.source,
    fixture.sourceFile,
  )) {
    assert.equal(
      contract.isDefinitelyNonThenable(operation.call, () => false),
      true,
      operation.operation,
    );
  }
});

test("uses exact inputs for direct pointer-result representations", () => {
  const fixture = checkedPointerFixture(`
import { addressOf, loadPointer } from "./markers.js";
let value = 41;
const pointer = addressOf(value);
export const result = loadPointer(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const contract = createPointerResultContract(fixture.source, plan);
  const operations = pointerOperations(fixture.source, fixture.sourceFile);
  const address = requireAddressOperation(operations);
  const load = requireLoadOperation(operations);
  assert.equal(plan.representationFor(address.call), "direct-snapshot");
  assert.equal(plan.representationFor(load.call), "direct-snapshot");

  assert.equal(
    contract.isDefinitelyNonThenable(
      address.call,
      (input) => input === address.storageExpression,
    ),
    true,
  );
  assert.equal(
    contract.isDefinitelyNonThenable(
      load.call,
      (input) => input === load.pointerExpression,
    ),
    true,
  );
  assert.equal(contract.isDefinitelyNonThenable(load.call, () => false), false);
});

test("classifies exact pointer values without classifying their pointees", () => {
  const fixture = checkedPointerFixture(`
import { allocatePointer, loadPointer } from "./markers.js";
declare function expose(pointer: import("./markers.js").Pointer<number>): void;
const pointer = allocatePointer(41);
expose(pointer);
const pointee = loadPointer(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const contract = createPointerResultContract(fixture.source, plan);
  const pointer = variableDeclarationNamed(
    fixture.source,
    fixture.sourceFile,
    "pointer",
  );
  const pointee = variableDeclarationNamed(
    fixture.source,
    fixture.sourceFile,
    "pointee",
  );
  const pointerName = pointer.name;
  const pointeeName = pointee.name;
  assert.ok(pointerName !== undefined && pointeeName !== undefined);
  assert.equal(plan.valueRepresentationFor(pointerName), "location");
  assert.equal(
    contract.isDefinitelyNonThenable(pointerName, () => false),
    true,
  );
  assert.equal(plan.valueRepresentationFor(pointeeName), undefined);
  assert.equal(
    contract.isDefinitelyNonThenable(pointeeName, () => false),
    false,
  );
});

test("rejects a pointer flow plan from another checked program", () => {
  const first = checkedPointerFixture(`
import { allocatePointer } from "./markers.js";
export const pointer = allocatePointer(1);
`);
  const second = checkedPointerFixture(`
import { allocatePointer } from "./markers.js";
export const pointer = allocatePointer(2);
`);
  assert.throws(
    () => createPointerResultContract(
      second.source,
      createFixturePointerFlowPlan(first.source),
    ),
    /another checked program/,
  );
});

function pointerOperations(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  visit(source, root, (node) => {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation !== undefined) {
      operations.push(operation);
    }
  });
  return operations;
}

function rawPointerOperations(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
): readonly RawPointerOperationFact[] {
  const operations: RawPointerOperationFact[] = [];
  visit(source, root, (node) => {
    const operation = source.sourceFacts.getFact(
      node,
      rawPointerOperationFactKey,
    );
    if (operation !== undefined) {
      operations.push(operation);
    }
  });
  return operations;
}

function requireAddressOperation(
  operations: readonly PointerOperationFact[],
): Extract<PointerOperationFact, { readonly operation: "address-of" }> {
  const operation = operations.find((candidate) =>
    candidate.operation === "address-of"
  );
  assert.ok(operation !== undefined);
  return operation;
}

function requireLoadOperation(
  operations: readonly PointerOperationFact[],
): Extract<PointerOperationFact, { readonly operation: "load" }> {
  const operation = operations.find((candidate) => candidate.operation === "load");
  assert.ok(operation !== undefined);
  return operation;
}
