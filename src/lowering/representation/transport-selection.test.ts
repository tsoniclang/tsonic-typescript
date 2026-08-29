import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  visit,
} from "../pointer/pointer.test-support.js";
import { createRepresentationTransportContract } from "./transport-contract.js";

const kernelModule = "./generic-kernel.js";
const kernelContract = createRepresentationTransportContract([{
  kind: "generic-kernel",
  moduleSpecifier: kernelModule,
  exportName: "Transport",
}]);

test("admits only a certified kernel's generic-owned pointer parameter", () => {
  const fixture = transportFixture();
  const canonical = createFixturePointerFlowPlan(fixture.source);
  const transported = createFixturePointerFlowPlan(
    fixture.source,
    kernelContract,
  );

  assert.equal(transported.representationTransportCallCount, 1);
  assert.equal(canonical.representationTransportCallCount, 0);
  assert.deepEqual(operationRepresentations(fixture, canonical), [
    "location",
    "location",
    "location",
    "location",
  ]);
  assert.deepEqual(operationRepresentations(fixture, transported), [
    "direct-object",
    "direct-object",
    "location",
    "location",
  ]);
});

test("rejects a wrong module, wrong export, and local same-spelled call", () => {
  const fixture = transportFixture(true);
  const exact = createFixturePointerFlowPlan(fixture.source, kernelContract);
  assert.equal(exact.representationTransportCallCount, 1);
  for (const contract of [
    createRepresentationTransportContract([{
      kind: "generic-kernel",
      moduleSpecifier: "./other.js",
      exportName: "Transport",
    }]),
    createRepresentationTransportContract([{
      kind: "generic-kernel",
      moduleSpecifier: kernelModule,
      exportName: "Other",
    }]),
  ]) {
    const plan = createFixturePointerFlowPlan(fixture.source, contract);
    assert.equal(plan.representationTransportCallCount, 0);
    assert.ok(operationRepresentations(fixture, plan).every(
      (representation) => representation === "location",
    ));
  }
});

test("transport contracts are immutable, ordered, and duplicate-free", () => {
  const input = [{
    kind: "generic-kernel" as const,
    moduleSpecifier: "./a.js",
    exportName: "A",
  }];
  const contract = createRepresentationTransportContract(input);
  input[0] = {
    kind: "generic-kernel",
    moduleSpecifier: "./mutated.js",
    exportName: "Mutated",
  };
  assert.equal(contract.callables[0]?.moduleSpecifier, "./a.js");
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.callables));
  assert.ok(Object.isFrozen(contract.callables[0]));
  assert.throws(
    () => createRepresentationTransportContract([
      contract.callables[0]!,
      contract.callables[0]!,
    ]),
    /uniquely and canonically ordered/u,
  );
  assert.throws(
    () => createRepresentationTransportContract([{
      kind: "generic-kernel",
      moduleSpecifier: "./z.js",
      exportName: "Z",
    }, {
      kind: "generic-kernel",
      moduleSpecifier: "./a.js",
      exportName: "A",
    }]),
    /uniquely and canonically ordered/u,
  );
});

function transportFixture(includeLookalike = false) {
  return checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
import * as kernel from "${kernelModule}";
class Box { constructor(readonly value: number) {} }
const genericPointer: Pointer<Box> = allocatePointer(new Box(1));
const concretePointer: Pointer<number> = allocatePointer(2);
kernel.Transport(genericPointer, concretePointer);
${includeLookalike
    ? "const lookalike = { Transport<T>(value: T): void { void value; } };\nlookalike.Transport(genericPointer);"
    : ""}
export const result = [
  loadPointer(genericPointer).value,
  loadPointer(concretePointer),
];
`, {
    "/src/generic-kernel.d.ts": `import type { Pointer } from "./markers.js";
export declare function Transport<T>(
  genericValue: T,
  concreteValue: Pointer<number>,
): void;
`,
  });
}

function operationRepresentations(
  fixture: ReturnType<typeof transportFixture>,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
): readonly string[] {
  const operations: PointerOperationFact[] = [];
  visit(fixture.source, fixture.sourceFile, (node) => {
    const operation = fixture.source.sourceFacts.getFact(
      node,
      pointerOperationFactKey,
    );
    if (operation !== undefined) {
      operations.push(operation);
    }
  });
  return operations
    .map((operation) => plan.representationFor(operation.call))
    .sort();
}
