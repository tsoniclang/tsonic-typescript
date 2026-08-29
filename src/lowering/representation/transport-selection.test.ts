import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  sourceFileNamed,
  visit,
} from "../pointer/pointer.test-support.js";
import { lowerPointers } from "../pointer/transform.js";
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

test("settles an imported concrete receiver before a certified generic kernel", () => {
  const fixture = checkedPointerFixture(`import { addressOf, equalPointer } from "./markers.js";
import { Box } from "./box.js";
import { Read } from "./concrete.js";
class Owner { constructor(public box: Box) {} }
const owner = new Owner(new Box(41));
const shared = new Box(42);
let leftValue = shared;
let rightValue = shared;
export const same = equalPointer(addressOf(leftValue), addressOf(rightValue));
export const result = Read(addressOf(owner.box));
`, {
    "/src/concrete.ts": `import type { Pointer } from "./markers.js";
import type { Box } from "./box.js";
import * as kernel from "${kernelModule}";
export function Read(value: Pointer<Box>): number {
  return kernel.Transport(value);
}
`,
    "/src/box.ts": `export class Box { constructor(readonly value: number) {} }`,
    "/src/generic-kernel.d.ts": `export declare function Transport<T>(value: T): number;`,
  });
  const plan = createFixturePointerFlowPlan(fixture.source, kernelContract);
  const address = pointerOperations(fixture)
    .filter((operation) => operation.operation === "address-of")
    .at(-1);
  assert.ok(address !== undefined);
  assert.equal(plan.representationFor(address.call), "direct-object");

  const loweredCaller = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(
    fixture.source,
    loweredCaller.sourceFile,
    "propertyLocation",
  ), 0);
  const concrete = sourceFileNamed(fixture.source, "/src/concrete.ts");
  const loweredConcrete = lowerPointers(fixture.source, concrete, plan);
  assert.equal(countCallsNamed(
    fixture.source,
    loweredConcrete.sourceFile,
    "loadPointer",
  ), 0);
});

test("selects generated function and member kernels by exact source declaration", () => {
  const fixture = checkedPointerFixture(`import { addressOf } from "./markers.js";
import { ReadFunction, ReadMember } from "./concrete.js";
import { Box } from "./box.js";
class Owner { constructor(public box: Box) {} }
const owner = new Owner(new Box(41));
export const functionResult = ReadFunction(addressOf(owner.box));
export const memberResult = ReadMember(addressOf(owner.box));
`, {
    "/src/concrete.ts": `import type { Pointer } from "./markers.js";
import type { Box } from "./box.js";
import { FunctionKernel, KernelOwner } from "./generated-kernels.js";
export function ReadFunction(value: Pointer<Box>): number {
  return FunctionKernel(value);
}
export function ReadMember(value: Pointer<Box>): number {
  return KernelOwner.MemberKernel(value);
}
`,
    "/src/box.ts": `export class Box { constructor(readonly value: number) {} }`,
    "/src/generated-kernels.ts": `export function FunctionKernel<T>(value: T): number {
  return value === undefined ? 0 : 1;
}
export class KernelOwner {
  static MemberKernel<T>(value: T): number {
    return value === undefined ? 0 : 1;
  }
}`,
  });
  const contract = createRepresentationTransportContract([{
    kind: "generated-generic-function-kernel",
    sourcePath: "/src/generated-kernels.ts",
    exportName: "FunctionKernel",
  }, {
    kind: "generated-generic-member-kernel",
    sourcePath: "/src/generated-kernels.ts",
    exportName: "KernelOwner",
    memberName: "MemberKernel",
  }]);
  const plan = createFixturePointerFlowPlan(fixture.source, contract);
  assert.equal(plan.representationTransportCallCount, 2);
  const loweredCaller = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(
    fixture.source,
    loweredCaller.sourceFile,
    "propertyLocation",
  ), 0);
});

test("rejects a generated kernel contract with a wrong source identity", () => {
  const fixture = checkedPointerFixture(`import "./generated-kernels.js";
export const value = 1;`, {
    "/src/generated-kernels.ts": `export function FunctionKernel<T>(value: T): T {
  return value;
}
export function Ordinary(value: number): number { return value; }
export class KernelOwner {
  static MemberKernel<T>(value: T): T { return value; }
}`,
  });
  const contract = createRepresentationTransportContract([{
    kind: "generated-generic-function-kernel",
    sourcePath: "/src/wrong.ts",
    exportName: "FunctionKernel",
  }]);
  assert.throws(
    () => createFixturePointerFlowPlan(fixture.source, contract),
    /source.*not selected/u,
  );
  for (const [callable, message] of [
    [{
      kind: "generated-generic-function-kernel" as const,
      sourcePath: "/src/generated-kernels.ts",
      exportName: "Missing",
    }, /resolved 0 declarations/u],
    [{
      kind: "generated-generic-function-kernel" as const,
      sourcePath: "/src/generated-kernels.ts",
      exportName: "Ordinary",
    }, /is not generic/u],
    [{
      kind: "generated-generic-member-kernel" as const,
      sourcePath: "/src/generated-kernels.ts",
      exportName: "KernelOwner",
      memberName: "Missing",
    }, /resolved 0 declarations/u],
  ] as const) {
    assert.throws(
      () => createFixturePointerFlowPlan(
        fixture.source,
        createRepresentationTransportContract([callable]),
      ),
      message,
    );
  }
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
  const retained = contract.callables[0];
  assert.equal(retained?.kind, "generic-kernel");
  assert.equal(
    retained?.kind === "generic-kernel" ? retained.moduleSpecifier : undefined,
    "./a.js",
  );
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

function pointerOperations(
  fixture: ReturnType<typeof checkedPointerFixture>,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      const operation = fixture.source.sourceFacts.getFact(
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
