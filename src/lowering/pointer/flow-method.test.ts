import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  AsParameterDeclaration,
  IsMethodDeclaration,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  createClosedPointerFlowPlan,
  type PointerFlowRepresentation,
} from "./flow-plan.js";
import {
  checkedPointerFixture,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("contracts an exact closed instance-method pointer flow", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Reader {
  read(pointer: Pointer<number>): number { return loadPointer(pointer); }
}
const reader = new Reader();
const pointer = allocatePointer(41);
export const result = reader.read(pointer) + 1;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "direct-snapshot");
  const result = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const method = methodNamed(fixture.source, result.sourceFile, "read");
  const parameter = AsParameterDeclaration(
    fixture.source.ast.parameters(method)[0],
  );
  assert.equal(fixture.source.ast.kindName(parameter?.Type), "KindNumberKeyword");
});

test("keeps an override family on the canonical pointer representation", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Reader {
  read(pointer: Pointer<number>): number { return loadPointer(pointer); }
}
class DerivedReader extends Reader {
  override read(pointer: Pointer<number>): number { return loadPointer(pointer) + 1; }
}
const reader: Reader = Math.random() > 0.5 ? new Reader() : new DerivedReader();
const pointer = allocatePointer(41);
export const result = reader.read(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertAllOperations(fixture.source, plan, "location");
  assert.ok(plan.components.some((component) =>
    component.blockers.includes("open-call")
  ));
});

test("dispatch-evidence mutation forces the exact instance method to fallback", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Reader {
  read(pointer: Pointer<number>): number { return loadPointer(pointer); }
}
const pointer = allocatePointer(41);
export const result = new Reader().read(pointer);
`);
  const declaration = methodNamed(fixture.source, fixture.sourceFile, "read");
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      memberDispatch(node: Node | undefined) {
        const dispatch = fixture.source.navigation.memberDispatch(node);
        return node === declaration && dispatch !== undefined
          ? Object.freeze({ ...dispatch, hasDerivedOverride: true })
          : dispatch;
      },
    }),
  });

  assertAllOperations(source, createClosedPointerFlowPlan(source), "location");
});

function assertAllOperations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createClosedPointerFlowPlan>,
  expected: PointerFlowRepresentation,
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
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }
  return operations;
}

function methodNamed(
  source: TargetSourceProgram,
  root: Node,
  name: string,
): Node {
  let result: Node | undefined;
  visit(source, root, (node) => {
    if (
      result === undefined &&
      IsMethodDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === name
    ) {
      result = node;
    }
  });
  assert.ok(result !== undefined);
  return result;
}
