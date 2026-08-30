import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
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

const inlineStoreContract = createRepresentationTransportContract([{
  kind: "inline-generic-method-call",
  moduleSpecifier: "./map-runtime.js",
  exportName: "goMapStore",
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
      moduleSpecifier: "./a.js",
      exportName: "A",
    }, {
      kind: "inline-generic-method-call",
      moduleSpecifier: "./a.js",
      exportName: "A",
    }]),
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

test("inlines an exact named generic method transport after pointer lowering", () => {
  const fixture = inlineStoreFixture();
  const plan = createFixturePointerFlowPlan(
    fixture.source,
    inlineStoreContract,
  );

  assert.equal(plan.representationTransportCallCount, 1);
  assert.equal(plan.representationTransportInlineCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(lowered.representationTransportInlineCount, 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "goMapStore"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "set"), 1);
  assert.equal(countNodesOfKind(fixture, lowered.sourceFile, "KindVoidExpression"), 1);
});

test("rejects inline transport body drift and local or wrong-module lookalikes", () => {
  assert.throws(
    () => createFixturePointerFlowPlan(
      inlineStoreFixture(true).source,
      inlineStoreContract,
    ),
    /single generic method-call body/u,
  );
  const fixture = inlineStoreFixture(false, true);
  const wrongModule = createRepresentationTransportContract([{
    kind: "inline-generic-method-call",
    moduleSpecifier: "./other.js",
    exportName: "goMapStore",
  }]);
  assert.equal(
    createFixturePointerFlowPlan(fixture.source, wrongModule)
      .representationTransportCallCount,
    0,
  );
  assert.equal(
    createFixturePointerFlowPlan(fixture.source, inlineStoreContract)
      .representationTransportCallCount,
    1,
  );
  assert.equal(
    createFixturePointerFlowPlan(localInlineStoreFixture().source, inlineStoreContract)
      .representationTransportCallCount,
    0,
  );
});

test("preserves one receiver-to-argument evaluation in source order", () => {
  const fixture = inlineStoreEvaluationFixture();
  const plan = createFixturePointerFlowPlan(fixture.source, inlineStoreContract);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  for (const name of ["selectValues", "selectKey", "selectValue"]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, name), 1);
  }
  assert.deepEqual(
    inlineMethodOperandCalls(fixture, lowered.sourceFile),
    ["selectValues", "selectKey", "selectValue"],
  );
});

test("rejects aliases, overloads, optional parameters, and concrete transport slots", () => {
  assert.equal(
    createFixturePointerFlowPlan(
      aliasedInlineStoreFixture().source,
      inlineStoreContract,
    ).representationTransportCallCount,
    0,
  );
  for (const declaration of [
    `export function goMapStore<K, V>(values: Map<K, V>, key: K, value: V): void;
export function goMapStore<K, V>(values: Map<K, V>, key: K, value: V): void {
  values.set(key, value);
}`,
    `export function goMapStore<K, V>(values: Map<K, V>, key: K, value?: V): void {
  values.set(key, value!);
}`,
    `export function goMapStore<K, V>(values: Map<K, V>, key: string, value: V): void {
  values.set(key as K, value);
}`,
  ]) {
    assert.throws(
      () => createFixturePointerFlowPlan(
        inlineStoreFixtureWithDeclaration(declaration).source,
        inlineStoreContract,
      ),
      /single generic method-call body/u,
    );
  }
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

function inlineStoreFixture(bodyDrift = false, includeLookalike = false) {
  return inlineStoreFixtureWithDeclaration(`export function goMapStore<K, V>(
  values: Map<K, V>,
  key: K,
  value: V,
): void {
  ${bodyDrift ? "const selected = values;\n  selected.set(key, value);" : "values.set(key, value);"}
}
`, includeLookalike);
}

function inlineStoreFixtureWithDeclaration(
  declaration: string,
  includeLookalike = false,
) {
  return checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
import { goMapStore } from "./map-runtime.js";
class Box { constructor(readonly value: number) {} }
const values = new Map<string, Pointer<Box>>();
const pointer = allocatePointer(new Box(1));
goMapStore(values, "answer", pointer);
${includeLookalike
    ? "function localStore<K, V>(values: Map<K, V>, key: K, value: V): void { values.set(key, value); }\nlocalStore(values, \"local\", pointer);"
    : ""}
export const result = loadPointer(values.get("answer")!).value;
`, {
    "/src/map-runtime.ts": declaration,
  });
}

function inlineStoreEvaluationFixture() {
  return checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
import { goMapStore } from "./map-runtime.js";
class Box { constructor(readonly value: number) {} }
const values = new Map<string, Pointer<Box>>();
const pointer = allocatePointer(new Box(1));
function selectValues(): Map<string, Pointer<Box>> { return values; }
function selectKey(): string { return "answer"; }
function selectValue(): Pointer<Box> { return pointer; }
goMapStore(selectValues(), selectKey(), selectValue());
`, {
    "/src/map-runtime.ts": `export function goMapStore<K, V>(
  values: Map<K, V>, key: K, value: V,
): void { values.set(key, value); }
`,
  });
}

function localInlineStoreFixture() {
  return checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
function goMapStore<K, V>(values: Map<K, V>, key: K, value: V): void {
  values.set(key, value);
}
const values = new Map<string, Pointer<number>>();
goMapStore(values, "answer", allocatePointer(1));
`);
}

function aliasedInlineStoreFixture() {
  return checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
import { goMapStore } from "./map-runtime.js";
const values = new Map<string, Pointer<number>>();
const store = goMapStore;
store(values, "answer", allocatePointer(1));
`, {
    "/src/map-runtime.ts": `export function goMapStore<K, V>(
  values: Map<K, V>, key: K, value: V,
): void { values.set(key, value); }
`,
  });
}

function countNodesOfKind(
  fixture: ReturnType<typeof inlineStoreFixture>,
  root: Parameters<typeof visit>[1],
  kind: string,
): number {
  let count = 0;
  visit(fixture.source, root, (node) => {
    if (fixture.source.ast.kindName(node) === kind) {
      count += 1;
    }
  });
  return count;
}

function inlineMethodOperandCalls(
  fixture: ReturnType<typeof inlineStoreEvaluationFixture>,
  root: Parameters<typeof visit>[1],
): readonly string[] {
  let result: readonly string[] = [];
  visit(fixture.source, root, (node) => {
    if (!fixture.source.ast.is.IsVoidExpression(node)) {
      return;
    }
    const voidExpression = fixture.source.ast.as.AsVoidExpression(node);
    const call = voidExpression?.Expression === undefined ||
        !fixture.source.ast.is.IsCallExpression(voidExpression.Expression)
      ? undefined
      : fixture.source.ast.as.AsCallExpression(voidExpression.Expression);
    const access = call?.Expression === undefined
        || !fixture.source.ast.is.IsPropertyAccessExpression(call.Expression)
      ? undefined
      : fixture.source.ast.as.AsPropertyAccessExpression(call.Expression);
    if (access?.Expression === undefined) {
      return;
    }
    result = [access.Expression, ...(call?.Arguments?.Nodes ?? [])].map(
      (operand) => {
        const operandCall = operand === undefined ||
            !fixture.source.ast.is.IsCallExpression(operand)
          ? undefined
          : fixture.source.ast.as.AsCallExpression(operand);
        return operandCall?.Expression === undefined ||
            !fixture.source.ast.is.IsIdentifier(operandCall.Expression)
          ? ""
          : fixture.source.ast.text(operandCall.Expression);
      },
    );
  });
  return result;
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
