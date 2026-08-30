import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsPropertyAccessExpression,
  IsCallExpression,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../program-index.js";
import {
  checkedScalarFixture,
  fixtureSourceIdentityFor,
  visit,
} from "../../scalar/scalar.test-support.js";
import { createRepresentationProjectionPlan } from "../plan.js";
import {
  createRepresentationProjectionRewriter,
  lowerRepresentationProjections,
} from "../transform.js";

const exactFields = `type BoxStorage = { value: number; count: number };
let evaluations = 0;
class Box {
  constructor(private readonly storage: BoxStorage) {}
  static to(source: Box): BoxStorage { return source.storage; }
  get value(): number { return this.storage.value; }
  set value(input: number) { this.storage.value = input; }
  get count(): number { return this.storage.count; }
  set count(input: number) { this.storage.count = input; }
}
const box = new Box({ value: 1, count: 2 });
function next(): Box { evaluations += 1; return box; }
export const read = Box.to(next()).value;
Box.to(box).value = 41;
Box.to(box).count += 1;
export const count = evaluations;
`;

test("projects exact logical fields without invoking storage converters", () => {
  const fixture = checkedScalarFixture(exactFields);
  const plan = createPlan(fixture, "closed-direct");
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.directLogicalFields.candidateCount, 3);
  assert.equal(plan.directLogicalFields.optimizedCount, 3);
  assert.equal(plan.directLogicalFields.retainedCount, 0);
  assert.equal(plan.inverseCandidateCount, 0);
  assert.equal(result.directLogicalFieldCount, 3);
  assert.deepEqual(callTargets(fixture, result.sourceFile), ["next"]);
  assert.equal(propertyCount(fixture, result.sourceFile, "value"), 4);
  assert.equal(propertyCount(fixture, result.sourceFile, "count"), 3);
});

test("preserves every direct field when the profile is canonical", () => {
  const fixture = checkedScalarFixture(exactFields);
  const plan = createPlan(fixture, "preserve");
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.directLogicalFields.candidateCount, 3);
  assert.equal(plan.directLogicalFields.optimizedCount, 0);
  assert.equal(plan.directLogicalFields.retainedCount, 3);
  assert.deepEqual(plan.directLogicalFields.fallbackReasons.map((row) => row.reason), [
    "profile-preserved",
  ]);
  assert.equal(result.directLogicalFieldCount, 0);
  assert.equal(callTargets(fixture, result.sourceFile).filter((name) =>
    name === "Box.to"
  ).length, 3);
});

test("fails closed for every non-identical accessor class", () => {
  const cases = [
    [
      "missing getter",
      `type Storage = { value: number };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; } }
       declare const box: Box; export const value = Box.to(box).value;`,
      "missing-accessor",
    ],
    [
      "effectful getter",
      `type Storage = { value: number }; declare function observe(): void;
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get value(): number { observe(); return this.storage.value; } }
       declare const box: Box; export const value = Box.to(box).value;`,
      "transformed-accessor",
    ],
    [
      "representation-changing getter",
      `type Storage = { value: 1 };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get value(): number { return this.storage.value; } }
       declare const box: Box; export const value = Box.to(box).value;`,
      "representation-changing",
    ],
    [
      "different storage field",
      `type Storage = { value: number; other: number };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get value(): number { return this.storage.other; } }
       declare const box: Box; export const value = Box.to(box).value;`,
      "missing-accessor",
    ],
    [
      "ambiguous getter",
      `type Storage = { value: number };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get first(): number { return this.storage.value; }
         get second(): number { return this.storage.value; } }
       declare const box: Box; export const value = Box.to(box).value;`,
      "ambiguous-accessor",
    ],
    [
      "missing setter",
      `type Storage = { value: number };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get value(): number { return this.storage.value; } }
       declare const box: Box; Box.to(box).value = 1; export {};`,
      "missing-accessor",
    ],
    [
      "unstable converter",
      `type Storage = { value: number };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get value(): number { return this.storage.value; } }
       Box.to = (source: Box): Storage => ({ value: source.value });
       declare const box: Box; export const value = Box.to(box).value;`,
      "inexact-projection",
    ],
    [
      "inherited converter",
      `type Storage = { value: number }; class Base {}
       class Box extends Base { constructor(private readonly storage: Storage) { super(); }
         static to(source: Box): Storage { return source.storage; }
         get value(): number { return this.storage.value; } }
       declare const box: Box; export const value = Box.to(box).value;`,
      "inexact-projection",
    ],
    [
      "optional converter",
      `type Storage = { value: number };
       class Box { constructor(private readonly storage: Storage) {}
         static to(source: Box): Storage { return source.storage; }
         get value(): number { return this.storage.value; } }
       declare const box: Box; export const value = Box.to?.(box).value;`,
      "inexact-projection",
    ],
  ] as const;

  for (const [label, sourceText, reason] of cases) {
    let fixture: ReturnType<typeof checkedScalarFixture>;
    try {
      fixture = checkedScalarFixture(sourceText);
    } catch (error) {
      throw new Error(`invalid '${label}' fixture`, { cause: error });
    }
    const plan = createPlan(fixture, "closed-direct");
    assert.equal(plan.directLogicalFields.candidateCount, 1, label);
    assert.equal(plan.directLogicalFields.optimizedCount, 0, label);
    assert.deepEqual(
      plan.directLogicalFields.fallbackReasons.map((row) => row.reason),
      [reason],
      label,
    );
  }
});

test("leaves computed and transformed nested storage outside the admitted class", () => {
  const fixture = checkedScalarFixture(`type ChildStorage = { value: number };
    class Child {
      constructor(private readonly storage: ChildStorage) {}
      static from(storage: ChildStorage): Child { return new Child(storage); }
    }
    type Storage = { child: ChildStorage };
    class Box {
      constructor(private readonly storage: Storage) {}
      static to(source: Box): Storage { return source.storage; }
      get child(): Child { return Child.from(this.storage.child); }
    }
    declare const box: Box;
    export const nested = Box.to(box).child;
    export const computed = Box.to(box)["child"];
  `);
  const plan = createPlan(fixture, "closed-direct");

  assert.equal(plan.directLogicalFields.candidateCount, 1);
  assert.equal(plan.directLogicalFields.optimizedCount, 0);
  assert.deepEqual(plan.directLogicalFields.fallbackReasons.map((row) => row.reason), [
    "transformed-accessor",
  ]);
});

test("fails if planned direct fields are not consumed", () => {
  const fixture = checkedScalarFixture(exactFields);
  const plan = createPlan(fixture, "closed-direct");
  const rewriter = createRepresentationProjectionRewriter(
    plan,
    fixture.sourceFile,
  );

  assert.throws(
    () => rewriter.finish(fixture.sourceFile),
    /planned 3, consumed 0/u,
  );
});

test("indexes each accessor class once independent of use count", () => {
  const small = createPlan(
    checkedScalarFixture(repeatedFieldReads(1)),
    "closed-direct",
  ).directLogicalFields;
  const wide = createPlan(
    checkedScalarFixture(repeatedFieldReads(256)),
    "closed-direct",
  ).directLogicalFields;

  assert.equal(small.optimizedCount, 1);
  assert.equal(wide.optimizedCount, 256);
  assert.equal(small.construction.classIndexEvaluations, 1);
  assert.equal(wide.construction.classIndexEvaluations, 1);
  assert.equal(
    wide.construction.classMemberVisits,
    small.construction.classMemberVisits,
  );
  assert.equal(
    wide.construction.accessorBodyNodeVisits,
    small.construction.accessorBodyNodeVisits,
  );
  assert.equal(
    wide.construction.indexedAccessorFieldPairs,
    small.construction.indexedAccessorFieldPairs,
  );
  assert.equal(small.construction.accessorQueries, 1);
  assert.equal(wide.construction.accessorQueries, 256);
  assert.ok(wide.construction.shapeQueries > small.construction.shapeQueries);
});

function createPlan(
  fixture: ReturnType<typeof checkedScalarFixture>,
  profile: "preserve" | "closed-direct",
): ReturnType<typeof createRepresentationProjectionPlan> {
  return createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, { bindingWrites: true }),
    profile,
    fixtureSourceIdentityFor(fixture.source),
  );
}

function repeatedFieldReads(count: number): string {
  const reads = Array.from(
    { length: count },
    (_value, index) => `export const value${index} = Box.to(box).value;`,
  ).join("\n");
  return `type Storage = { value: number };
    class Box {
      constructor(private readonly storage: Storage) {}
      static to(source: Box): Storage { return source.storage; }
      get value(): number { return this.storage.value; }
    }
    declare const box: Box;
    ${reads}`;
}

function callTargets(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: Node,
): readonly string[] {
  const targets: string[] = [];
  visit(fixture.source, root, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const expression = AsCallExpression(node)?.Expression;
    const property = AsPropertyAccessExpression(expression);
    if (expression !== undefined) {
      targets.push(property?.Expression === undefined
        ? fixture.source.ast.text(expression)
        : `${fixture.source.ast.text(property.Expression)}.${fixture.source.ast.text(property.name)}`);
    }
  });
  return targets;
}

function propertyCount(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: Node,
  name: string,
): number {
  let count = 0;
  visit(fixture.source, root, (node) => {
    if (
      IsPropertyAccessExpression(node) &&
      fixture.source.ast.text(AsPropertyAccessExpression(node)?.name) === name
    ) {
      count += 1;
    }
  });
  return count;
}
