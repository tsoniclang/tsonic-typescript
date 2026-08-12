import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";

import { createProgramGeneratedNames } from "../generated-names.js";
import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";
import { createPointerLoweringPlan } from "./plan.js";

test("reserves the nullable hash binding against authored source names", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer } from "./markers.js";
class Box { value = 1; }
const $pointer = "authored";
function nextPointer(): Pointer<Box> | undefined {
  return allocatePointer(new Box());
}
export const result = [$pointer, hashPointer(nextPointer())];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const arrowParameters: string[] = [];
  visit(fixture.source, lowered.sourceFile, (node) => {
    if (!fixture.source.ast.is.IsArrowFunction(node)) {
      return;
    }
    for (const parameter of fixture.source.ast.parameters(node)) {
      arrowParameters.push(fixture.source.ast.text(fixture.source.ast.name(parameter)));
    }
  });
  const representations = new Set<string>();
  visit(fixture.source, fixture.sourceFile, (node) => {
    const operation = fixture.source.sourceFacts.getFact(
      node,
      pointerOperationFactKey,
    );
    if (operation !== undefined) {
      representations.add(plan.representationFor(operation.call));
    }
  });

  assert.deepEqual(representations, new Set(["direct-object"]));
  assert.equal(arrowParameters.includes("$pointer"), false);
  assert.equal(arrowParameters.includes("$pointer2"), true);
});

test("reserves against a synthetic binding selected before pointer planning", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer } from "./markers.js";
class Box { value = 1; }
function nextPointer(): Pointer<Box> | undefined {
  return allocatePointer(new Box());
}
export const result = hashPointer(nextPointer());
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
  });
  const generatedNames = createProgramGeneratedNames(fixture.source, program)
    .forFile(fixture.sourceFile);
  assert.equal(generatedNames.reserve("$pointer").text, "$pointer");
  const flowPlan = createFixturePointerFlowPlan(fixture.source);
  const pointerPlan = createPointerLoweringPlan(
    fixture.source,
    fixture.sourceFile,
    program,
    generatedNames,
    flowPlan,
  );

  const parameterName = [...pointerPlan.nullableHashParameterNames.values()][0];
  assert.equal(parameterName?.text, "$pointer2");
});

test("reserves each synthetic closure parameter independently", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer } from "./markers.js";
class Box { value = 1; }
function nextPointer(): Pointer<Box> | undefined {
  return allocatePointer(new Box());
}
export const result = [
  hashPointer(nextPointer()),
  hashPointer(nextPointer()),
];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const arrowParameters: string[] = [];
  visit(fixture.source, lowered.sourceFile, (node) => {
    if (!fixture.source.ast.is.IsArrowFunction(node)) {
      return;
    }
    for (const parameter of fixture.source.ast.parameters(node)) {
      arrowParameters.push(fixture.source.ast.text(fixture.source.ast.name(parameter)));
    }
  });

  assert.deepEqual(arrowParameters.sort(), ["$pointer", "$pointer2"]);
});
