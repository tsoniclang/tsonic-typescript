import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  AsNewExpression,
  AsPropertyAccessExpression,
  IsNewExpression,
  IsPropertyAccessExpression,
  IsSpreadElement,
} from "@tsonic/tsts/target-ast";

import {
  createFixtureScalarRepresentationPlan,
  checkedScalarFixture,
} from "./scalar.test-support.js";
import {
  scalarProjectionRetentionReasons,
  type ScalarProjectionRetentionReason,
} from "./plan.js";

test("exact-joins every scalar projection to one closed decision", () => {
  const fixture = checkedScalarFixture(`function effect(): void {}
class Direct { constructor(readonly value: number) {} }
class Observable { constructor(readonly value: number) { effect(); } }
class Mutable { constructor(public value: number) {} }
class Aggregate { constructor(readonly value: { amount: number }) {} }
const Alias = Direct;
export const result = [
  new Direct(1).value,
  new Observable(2).value,
  new Mutable(3).value,
  new Aggregate({ amount: 4 }).value,
  new Alias(5).value,
];
`);
  const plan = createFixtureScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const candidates = independentProjectionCandidates(
    fixture.sourceFile,
    fixture.source.ast.children,
  );

  assert.equal(plan.syntacticProjectionCount, candidates.length);
  assert.equal(plan.projectionCount, 1);
  assert.equal(plan.retainedProjectionCount, 4);
  assert.deepEqual(
    plan.fallbackReasons.map((entry) => entry.reason).sort(),
    [
      "non-scalar-value",
      "nonreadonly-scalar-field",
      "observable-construction",
      "open-constructor-target",
    ],
  );
  assert.equal(
    plan.projectionCount + plan.retainedProjectionCount,
    plan.syntacticProjectionCount,
  );
});

test("retention reasons are finite and every retained row uses one", () => {
  const fixture = checkedScalarFixture(`class Scalar {
  constructor(readonly value: number) {}
}
export const result = new Scalar(1).value;
`);
  const preserved = createFixtureScalarRepresentationPlan(
    fixture.source,
    "preserve",
  );
  const accepted = new Set<ScalarProjectionRetentionReason>(
    scalarProjectionRetentionReasons,
  );

  assert.deepEqual(preserved.fallbackReasons.map((entry) => entry.reason), [
    "profile-preserved",
  ]);
  assert.ok(preserved.fallbackReasons.every((entry) => accepted.has(entry.reason)));
});

function independentProjectionCandidates(
  sourceFile: Node,
  children: (node: Node) => readonly (Node | undefined)[],
): readonly Node[] {
  const candidates: Node[] = [];
  const pending = [sourceFile];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (independentImmediateProjection(node)) {
      candidates.push(node);
    }
    for (const child of children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return candidates;
}

function independentImmediateProjection(node: Node): boolean {
  if (!IsPropertyAccessExpression(node)) {
    return false;
  }
  const access = AsPropertyAccessExpression(node);
  if (
    access?.QuestionDotToken !== undefined ||
    access?.Expression === undefined ||
    !IsNewExpression(access.Expression)
  ) {
    return false;
  }
  const construction = AsNewExpression(access.Expression);
  const arguments_ = construction?.Arguments?.Nodes ?? [];
  return arguments_.length === 1 &&
    arguments_[0] !== undefined &&
    !IsSpreadElement(arguments_[0]);
}
