import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  AsPropertyAccessExpression,
  IsNewExpression,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import { composeLoweredValueContracts } from "../value-contract.js";
import {
  checkedScalarFixture,
  createFixtureScalarRepresentationPlan,
} from "./scalar.test-support.js";
import { createScalarResultContract } from "./result-contract.js";

test("publishes non-thenable results only for exact eliminated projections", () => {
  const fixture = checkedScalarFixture(`class Scalar {
  constructor(readonly value: number) {}
}
class Aggregate {
  constructor(readonly value: { amount: number }) {}
}
export const direct = new Scalar(1).value;
export const retained = new Aggregate({ amount: 2 }).value;
`);
  const plan = createFixtureScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const contract = createScalarResultContract(fixture.source, plan);
  const projections = projectionNodes(fixture.sourceFile, fixture.source.ast.children);
  const direct = projections.find((node) => plan.projectionFor(node) !== undefined);
  const retained = projections.find((node) =>
    plan.decisionFor(node)?.kind === "retained"
  );

  assert.ok(direct !== undefined);
  assert.ok(retained !== undefined);
  assert.equal(contract.isDefinitelyNonThenable(direct, () => false), true);
  assert.equal(contract.isDefinitelyNonThenable(retained, () => true), false);
});

test("composes scalar and pointer-style result facts without exposing shape", () => {
  const fixture = checkedScalarFixture(`class Scalar {
  constructor(readonly value: number) {}
}
export const direct = new Scalar(1).value;
export const ordinary = 2;
`);
  const plan = createFixtureScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const scalar = createScalarResultContract(fixture.source, plan);
  const projection = projectionNodes(
    fixture.sourceFile,
    fixture.source.ast.children,
  )[0];
  assert.ok(projection !== undefined);
  const composed = composeLoweredValueContracts([
    Object.freeze({
      isDefinitelyNonThenable(expression: Node): boolean {
        return expression === fixture.sourceFile;
      },
    }),
    scalar,
  ]);

  assert.equal(composed.isDefinitelyNonThenable(projection, () => false), true);
  assert.equal(
    composed.isDefinitelyNonThenable(fixture.sourceFile, () => false),
    true,
  );
});

test("rejects a scalar plan from another checked source graph", () => {
  const first = checkedScalarFixture(`class Scalar {
  constructor(readonly value: number) {}
}
export const result = new Scalar(1).value;
`);
  const second = checkedScalarFixture(`export const result = 1;\n`);
  const plan = createFixtureScalarRepresentationPlan(
    first.source,
    "closed-direct",
  );

  assert.throws(
    () => createScalarResultContract(second.source, plan),
    /another checked program/u,
  );
});

function projectionNodes(
  root: Node,
  children: (node: Node) => readonly (Node | undefined)[],
): readonly Node[] {
  const found: Node[] = [];
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    const access = IsPropertyAccessExpression(node)
      ? AsPropertyAccessExpression(node)
      : undefined;
    if (access?.Expression !== undefined && IsNewExpression(access.Expression)) {
      found.push(node);
    }
    for (const child of children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return found;
}
