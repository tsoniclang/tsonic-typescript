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
  KindArrowFunction,
  KindCallExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindIdentifier,
  KindMethodDeclaration,
  KindReturnStatement,
  KindTypeReference,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { createTargetProgramIndex } from "../program-index.js";
import { censusPointerFlows } from "./flow-census.js";
import { buildPointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { PointerFlowComponent } from "./flow-graph.js";
import { assertPointerCensusTotality } from "./flow-type-census.js";
import {
  PointerPlanningLedger,
  type PointerPlanningPhase,
} from "./planning-ledger.js";
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

test("rejects an omitted unowned pointer-type classifier row", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
type Nested = readonly Pointer<number>[];
declare const values: Nested;
export const result = values.length;
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
  });
  const facts = buildPointerTypedFactLedger(
    fixture.source,
    program,
    new PointerPlanningLedger(),
  );
  const expected = new Set(facts.pointerTypeEntries.map(({ node }) => node));
  assert.deepEqual(expected, new Set(pointerTypeNodes(fixture.source)));
  const census = censusPointerFlows(
    fixture.source,
    program,
    new PointerPlanningLedger(),
  );
  const omitted = expected.values().next().value;
  assert.ok(omitted !== undefined);
  assert.ok(census.components.some((component) =>
    component.pointerTypes.includes(omitted)
  ));
  const mutated = census.components.map((component): PointerFlowComponent =>
    Object.freeze({
      ...component,
      pointerTypes: Object.freeze(
        component.pointerTypes.filter((node) => node !== omitted),
      ),
    })
  );

  assert.throws(
    () => assertPointerCensusTotality(
      mutated,
      new Set(pointerOperationFacts(fixture.source).keys()),
      expected,
    ),
    /classified \d+ pointer types, expected \d+/,
  );
});

test("rejects an omitted pointer-operation classifier row", () => {
  const fixture = checkedPointerFixture(`
import { allocatePointer, loadPointer } from "./markers.js";
const pointer = allocatePointer(1);
export const result = loadPointer(pointer);
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
  });
  const facts = buildPointerTypedFactLedger(
    fixture.source,
    program,
    new PointerPlanningLedger(),
  );
  const expected = new Set(facts.operationEntries.map(({ node }) => node));
  assert.deepEqual(
    expected,
    new Set(pointerOperationFacts(fixture.source).keys()),
  );
  const census = censusPointerFlows(
    fixture.source,
    program,
    new PointerPlanningLedger(),
  );
  const omitted = expected.values().next().value;
  assert.ok(omitted !== undefined);
  assert.ok(census.components.some((component) =>
    component.operations.includes(omitted)
  ));
  const mutated = census.components.map((component): PointerFlowComponent =>
    Object.freeze({
      ...component,
      operations: Object.freeze(
        component.operations.filter((node) => node !== omitted),
      ),
    })
  );

  assert.throws(
    () => assertPointerCensusTotality(
      mutated,
      expected,
      facts.pointerTypeEntries.map(({ node }) => node),
    ),
    /classified \d+ pointer operations, expected \d+/,
  );
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

test("bounds the complete pointer planner by deterministic work", () => {
  const baseline = representativePointerPlan(0);
  const small = representativePointerPlan(8);
  const large = representativePointerPlan(16);
  const smallWork = small.planningOperationCount - baseline.planningOperationCount;
  const largeWork = large.planningOperationCount - baseline.planningOperationCount;
  assert.ok(
    largeWork <= smallWork * 2.2,
    `${smallWork} -> ${largeWork}`,
  );
  const phases: readonly PointerPlanningPhase[] = [
    "flow-census",
    "direct-family",
    "representation",
    "projection",
    "evidence",
  ];
  for (const phase of phases) {
    const smallPhase = small.planningOperations[phase] -
      baseline.planningOperations[phase];
    const largePhase = large.planningOperations[phase] -
      baseline.planningOperations[phase];
    assert.ok(smallPhase > 0, `${phase} did not enter the operation ledger`);
    assert.ok(
      largePhase <= smallPhase * 2.2,
      `${phase}: ${smallPhase} -> ${largePhase}`,
    );
  }
});

test("conserves every indexed production candidate in the planning ledger", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const pointer: Pointer<number> = allocatePointer(1);
export const result = read(pointer);
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
  });
  const plan = createFixturePointerFlowPlan(fixture.source);
  const expected = {
    "typed-fact-node": program.nodes.length,
    "binding-type": program.nodesOfKind(KindTypeReference).length,
    "function-result": program.nodesOfKinds([
      KindFunctionDeclaration,
      KindMethodDeclaration,
      KindFunctionExpression,
      KindArrowFunction,
    ]).length,
    "unowned-type": pointerTypeNodes(fixture.source).length,
    "callable-alias-declaration": program.nodesOfKind(KindVariableDeclaration).length,
    "callable-alias-reference": program.nodesOfKind(KindIdentifier).length,
    "result-call": program.nodesOfKind(KindCallExpression).length,
    "variable-initializer": program.nodesOfKind(KindVariableDeclaration).length,
    "pointer-reference": program.nodesOfKind(KindIdentifier).length,
    "pointer-call": program.nodesOfKind(KindCallExpression).length,
    "pointer-return": program.nodesOfKind(KindReturnStatement).length,
    "pointer-audit-reference": program.nodesOfKind(KindIdentifier).length,
  } as const;
  assert.deepEqual(plan.planningCandidates, expected);

  const omitted = new PointerPlanningLedger();
  for (const node of omitted.candidates(
    "flow-census",
    "typed-fact-node",
    program.nodes.slice(1),
  )) {
    void node;
  }
  assert.throws(
    () => omitted.assertCandidateCount("typed-fact-node", program.nodes.length),
    /recorded \d+ candidates, expected \d+/,
  );
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

function representativePointerPlan(
  count: number,
): ReturnType<typeof createFixturePointerFlowPlan> {
  const declarations = Array.from({ length: count }, (_, index) => `
class Box${index} { constructor(readonly value: number) {} }
function read${index}<T>(pointer: Pointer<T>): T { return loadPointer(pointer); }
const objectPointer${index} = allocatePointer(new Box${index}(${index}));
const scalarPointer${index} = allocatePointer(${index});
const projected${index} = projectPointer<number, string>(
  scalarPointer${index},
  String,
  Number,
);
export const value${index} = read${index}(objectPointer${index}).value +
  hashPointer(objectPointer${index}) + loadPointer(projected${index}!).length;`).join("\n");
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import {
  allocatePointer,
  hashPointer,
  loadPointer,
  projectPointer,
} from "./markers.js";
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
