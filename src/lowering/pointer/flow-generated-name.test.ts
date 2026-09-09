import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("nullable identity hashing introduces no binding beside authored names", () => {
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
  assert.deepEqual(arrowParameters, []);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashObjectIdentity"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "nextPointer"), 1);
});

test("repeated identity hashing evaluates each operand once without closures", () => {
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

  assert.deepEqual(arrowParameters, []);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashObjectIdentity"), 2);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "nextPointer"), 2);
});

test("settles a nullable hash read from a class field before rewriting", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer } from "./markers.js";
class Changes { value = 1; }
class Parameters {
  constructor(public changes: Pointer<Changes> | undefined) {}
  static hash(source: Parameters): number {
    return Math.imul(1, hashPointer<Changes>(source.changes));
  }
}
export const result = Parameters.hash(new Parameters(allocatePointer(new Changes())));
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "rawPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashRawPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashObjectIdentity"), 1);
});
