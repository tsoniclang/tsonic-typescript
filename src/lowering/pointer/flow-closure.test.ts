import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pointerFactKey,
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
} from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("classifies the complete pointer fact denominator exactly once", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import {
  addressOf,
  allocatePointer,
  bindPointer,
  equalPointer,
  hashPointer,
  loadPointer,
  projectPointer,
  storePointer,
} from "./markers.js";
let value = 1;
const addressed = addressOf(value);
const allocated = allocatePointer(2);
storePointer(allocated, 3);
loadPointer(addressed);
equalPointer(addressed, allocated);
const bound = bindPointer({}, () => value, next => { value = next; });
const projected = projectPointer(bound, current => String(current), Number);
hashPointer(projected);
declare const nested: readonly Pointer<number>[];
export const result = [nested.length, loadPointer(allocated)];
  `);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operationFacts = pointerOperationFacts(fixture.source);
  const pointerTypes = pointerTypeNodes(fixture.source);

  assert.equal(operationFacts.size, 9);
  assert.ok(pointerTypes.length > 0);
  assert.equal(
    plan.components.reduce((count, component) => count + component.operationCount, 0),
    operationFacts.size,
  );
  assert.equal(
    plan.components.reduce((count, component) => count + component.pointerTypeCount, 0),
    pointerTypes.length,
  );
  assert.equal(
    Object.values(plan.representationCounts).reduce((sum, count) => sum + count, 0),
    plan.components.length,
  );
  for (const [node, operation] of operationFacts) {
    assert.equal(node, operation.call);
    assert.ok(plan.componentFor(node) !== undefined, operation.operation);
  }
  for (const pointerType of pointerTypes) {
    assert.ok(plan.componentFor(pointerType) !== undefined, "pointer type");
  }
  for (const component of plan.components) {
    assert.equal(
      component.representation === "location",
      component.retentionReasons.length > 0,
    );
    assert.equal(Object.isFrozen(component.retentionReasons), true);
    for (const retention of component.retentionReasons) {
      assert.ok(retention.occurrences.length > 0, retention.reason);
      assert.equal(Object.isFrozen(retention), true);
      assert.equal(Object.isFrozen(retention.occurrences), true);
      assert.throws(() =>
        (retention.occurrences as typeof retention.occurrences[number][]).push(
          retention.occurrences[0]!,
        )
      );
    }
  }
});

test("joins hash, provider binding, and projection into one retained component", () => {
  const fixture = checkedPointerFixture(`
import {
  bindPointer,
  hashPointer,
  projectPointer,
} from "./markers.js";
let value = 1;
const bound = bindPointer({}, () => value, next => { value = next; });
const projected = projectPointer(bound, current => String(current), Number);
export const result = hashPointer(projected);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations = pointerOperations(fixture.source);
  const components = new Set(operations.map((operation) =>
    plan.componentFor(operation.call)
  ));

  assert.equal(components.size, 1);
  const component = plan.componentFor(operations[0]?.call);
  assert.ok(component !== undefined);
  assert.equal(component.representation, "location");
  assert.deepEqual(
    component.retentionReasons.map((entry) => entry.reason).sort(),
    ["identity-observed", "projection-observed", "provider-binding"],
  );
});

test("retains a scalar component when an exact undefined value enters it", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
let pointer: Pointer<number> | undefined = allocatePointer(1);
pointer = undefined;
pointer = allocatePointer(2);
export const result = loadPointer(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const operations = pointerOperations(fixture.source);

  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components.some((component) =>
    component.retentionReasons.some((entry) => entry.reason === "nil-capable")
  ));
});

test("retains a nullable pointer result when an exact return is undefined", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function create(flag: boolean): Pointer<number> | undefined {
  if (flag) return allocatePointer(1);
  return undefined;
}
const pointer = create(true);
export const result = loadPointer(pointer!);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components.some((component) =>
    component.retentionReasons.some((entry) => entry.reason === "nil-capable")
  ));
});

test("removes a disproved nil guard from a complete scalar call flow", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function panic(): never { throw new Error("nil"); }
function read(pointer: Pointer<number> | undefined): number {
  return loadPointer(pointer ?? panic());
}
const pointer = allocatePointer(41);
export const result = read(pointer) + 1;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "direct-snapshot");
  }
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "panic"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "loadPointer"), 0);
});

test("scales pointer component construction linearly by deterministic work", () => {
  const baseline = independentScalarPlan(0);
  const small = independentScalarPlan(24);
  const large = independentScalarPlan(48);

  assert.equal(small.components.length - baseline.components.length, 24);
  assert.equal(large.components.length - baseline.components.length, 48);
  assert.equal(small.representationCounts["direct-snapshot"], 24);
  assert.equal(large.representationCounts["direct-snapshot"], 48);
  const smallWork = small.analysisOperationCount - baseline.analysisOperationCount;
  const largeWork = large.analysisOperationCount - baseline.analysisOperationCount;
  assert.ok(
    largeWork <= smallWork * 2.2,
    `${smallWork} -> ${largeWork}`,
  );
  const quadraticFoil = (size: number): number => size * size;
  assert.equal(quadraticFoil(48) / quadraticFoil(24), 4);
});

function pointerOperations(
  source: ReturnType<typeof checkedPointerFixture>["source"],
): readonly PointerOperationFact[] {
  return Object.freeze([...pointerOperationFacts(source).values()]);
}

function pointerOperationFacts(
  source: ReturnType<typeof checkedPointerFixture>["source"],
): ReadonlyMap<Node, PointerOperationFact> {
  const operations = new Map<Node, PointerOperationFact>();
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        operations.set(node, operation);
      }
    });
  }
  return operations;
}

function independentScalarPlan(
  count: number,
): ReturnType<typeof createFixturePointerFlowPlan> {
  const declarations = Array.from({ length: count }, (_, index) => `
const pointer${index}: Pointer<number> = allocatePointer(${index});
export const value${index} = loadPointer(pointer${index});`).join("\n");
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
${declarations}
`);
  return createFixturePointerFlowPlan(fixture.source);
}

function pointerTypeNodes(
  source: ReturnType<typeof checkedPointerFixture>["source"],
): readonly Node[] {
  const nodes = new Set<Node>();
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      if (source.sourceFacts.getFact(node, pointerFactKey) !== undefined) {
        nodes.add(node);
      }
    });
  }
  return Object.freeze([...nodes]);
}
