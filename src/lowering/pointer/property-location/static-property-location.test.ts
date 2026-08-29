import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  AsNewExpression,
  IsClassDeclaration,
  IsNewExpression,
} from "@tsonic/tsts/target-ast";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "../pointer.test-support.js";
import { prepareTypeScriptLowering } from "../../transform.js";
import { lowerPointers } from "../transform.js";

test("partitions repeated static property locations by exact key", () => {
  const fixture = checkedPointerFixture(repeatedPropertyFixture(8));
  const flowPlan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, flowPlan);

  assert.equal(lowered.staticPropertyLocationCount, 8);
  assert.equal(lowered.staticPropertyLocationClassCount, 1);
  assert.equal(
    countCallsNamed(fixture.source, lowered.sourceFile, "propertyLocation"),
    0,
  );
  assert.deepEqual(staticPropertyClassNames(fixture, lowered.sourceFile), [
    "$PropertyLocationFor_value2",
  ]);
  assert.equal(
    newExpressionsNamed(
      fixture,
      lowered.sourceFile,
      "$PropertyLocationFor_value2",
    ).length,
    8,
  );
});

test("retains families below the cost gate and the canonical profile", () => {
  const below = checkedPointerFixture(repeatedPropertyFixture(7));
  const flowPlan = createFixturePointerFlowPlan(below.source);
  const loweredBelow = lowerPointers(below.source, below.sourceFile, flowPlan);
  assert.equal(loweredBelow.staticPropertyLocationCount, 0);
  assert.equal(loweredBelow.staticPropertyLocationClassCount, 0);
  assert.equal(
    countCallsNamed(below.source, loweredBelow.sourceFile, "propertyLocation"),
    7,
  );

  const canonical = checkedPointerFixture(repeatedPropertyFixture(8));
  const loweredCanonical = lowerPointers(
    canonical.source,
    canonical.sourceFile,
  );
  assert.equal(loweredCanonical.staticPropertyLocationCount, 0);
  assert.equal(loweredCanonical.staticPropertyLocationClassCount, 0);
  assert.equal(
    countCallsNamed(
      canonical.source,
      loweredCanonical.sourceFile,
      "propertyLocation",
    ),
    8,
  );
});

test("retains nested and dynamic property locations", () => {
  const fixture = checkedPointerFixture(`
import { addressOf, hashPointer } from "./markers.js";

const wrapper = { owner: { value: 1 } };
const key: "value" = "value";
export const nested = [
  ${repeated("hashPointer(addressOf(wrapper.owner.value))", 8)}
];
export const dynamic = [
  ${repeated("hashPointer(addressOf(wrapper.owner[key]))", 8)}
];
`);
  const flowPlan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, flowPlan);

  assert.equal(lowered.staticPropertyLocationCount, 0);
  assert.equal(lowered.staticPropertyLocationClassCount, 0);
  assert.ok(
    countCallsNamed(
      fixture.source,
      lowered.sourceFile,
      "nestedPropertyLocation",
    ) >= 8,
  );
});

test("publishes the exact immutable specialization denominator", () => {
  const fixture = checkedPointerFixture(repeatedPropertyFixture(8));
  const prepared = prepareTypeScriptLowering(
    fixture.source,
    fixture.source.navigation.sourceFiles,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "preserve",
      representationProjections: "preserve",
    },
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );
  assert.equal(prepared.kind, "ready");
  if (prepared.kind !== "ready") {
    return;
  }
  const pointer = prepared.transaction.evidence.pointer;
  assert.equal(pointer.profile, "closed-direct");
  if (pointer.profile !== "closed-direct") {
    return;
  }
  assert.equal(pointer.optimizedStaticPropertyLocationCount, 8);
  assert.equal(pointer.staticPropertyLocationClassCount, 1);
});

function repeatedPropertyFixture(count: number): string {
  return `
import { addressOf, hashPointer } from "./markers.js";

const $PropertyLocationFor_value = "authored";
const owner = { value: 1 };
export const hashes = [
  ${repeated("hashPointer(addressOf(owner.value))", count)}
];
export { $PropertyLocationFor_value };
`;
}

function repeated(expression: string, count: number): string {
  return Array.from({ length: count }, () => expression).join(",\n  ");
}

function staticPropertyClassNames(
  fixture: ReturnType<typeof checkedPointerFixture>,
  root: Node,
): readonly string[] {
  const names: string[] = [];
  visit(fixture.source, root, (node) => {
    if (!IsClassDeclaration(node)) {
      return;
    }
    const name = fixture.source.ast.name(node);
    if (
      name !== undefined &&
      fixture.source.ast.text(name).startsWith("$PropertyLocationFor_")
    ) {
      names.push(fixture.source.ast.text(name));
    }
  });
  return names;
}

function newExpressionsNamed(
  fixture: ReturnType<typeof checkedPointerFixture>,
  root: Node,
  name: string,
): readonly Node[] {
  const selected: Node[] = [];
  visit(fixture.source, root, (node) => {
    if (!IsNewExpression(node)) {
      return;
    }
    const expression = AsNewExpression(node)?.Expression;
    if (
      expression !== undefined &&
      fixture.source.ast.is.IsIdentifier(expression) &&
      fixture.source.ast.text(expression) === name
    ) {
      selected.push(node);
    }
  });
  return selected;
}
