import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";

test("keeps a class family canonical through a generic callback contract", () => {
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

  assertAllOperations(fixture.source, plan, "location");
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "generic-call"
  ));
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
      const type = semantics.getTypeAtLocation(expression);
      return type !== undefined && semantics.isNever(type);
    });
  assert.ok(neverExpressions.length > 0);

  assertAllOperations(fixture.source, plan, "location");
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "checker-never"
  ));
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
