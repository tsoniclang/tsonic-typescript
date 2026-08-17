import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AsCallExpression,
  IsCallExpression,
} from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../program-index.js";
import { createTypeScriptOptimizationEvidence } from "../evidence.js";
import { createTypeScriptOptimizationProfile } from "../profile.js";
import { createScalarRepresentationPlan } from "../scalar/plan.js";
import {
  checkedScalarFixture,
  fixtureSourceIdentityFor,
  visit,
} from "../scalar/scalar.test-support.js";
import { createRepresentationProjectionPlan } from "./plan.js";
import { lowerRepresentationProjections } from "./transform.js";

const exactRepresentations = `let evaluations = 0;
function next(): number { evaluations += 1; return 41; }
function identity<T>(value: T): T { return value; }
class Box<T> {
  constructor(private readonly storage: T) {}
  static from<T>(storage: T): Box<T> { return new Box(storage); }
  static to<T>(box: Box<T>): T { return box.storage; }
}
export const result = Box.to(Box.from(identity(next())));
export const count = evaluations;
`;

test("eliminates exact identity and inverse representation calls", () => {
  const fixture = checkedScalarFixture(exactRepresentations);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
    declarationReferences: true,
  });
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    program,
    "closed-direct",
    fixtureSourceIdentityFor(fixture.source),
  );
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.identityCandidateCount, 1);
  assert.equal(plan.inverseCandidateCount, 1);
  assert.equal(plan.optimizedCount, 2);
  assert.equal(plan.retainedCount, 0);
  assert.equal(result.rewriteCount, 2);
  assert.deepEqual(callTargets(fixture, result.sourceFile), ["next"]);
});

test("preserves each representation candidate unless selected", () => {
  const fixture = checkedScalarFixture(exactRepresentations);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
    declarationReferences: true,
  });
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    program,
    "preserve",
    fixtureSourceIdentityFor(fixture.source),
  );
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.identityCandidateCount, 1);
  assert.equal(plan.inverseCandidateCount, 1);
  assert.equal(plan.optimizedCount, 0);
  assert.equal(plan.retainedCount, 2);
  assert.equal(result.rewriteCount, 0);
  assert.deepEqual(callTargets(fixture, result.sourceFile), [
    "Box.to",
    "Box.from",
    "identity",
    "next",
  ]);
});

test("fails closed when an apparent projection pair is not exact", () => {
  const cases = [
    `class Box<T> {
      constructor(private readonly storage: T) { sideEffect(); }
      static from<T>(storage: T): Box<T> { return new Box(storage); }
      static to<T>(box: Box<T>): T { return box.storage; }
    }
    declare function sideEffect(): void;
    export const result = Box.to(Box.from(41));`,
    `class Box<T> {
      constructor(private readonly storage: T) {}
      static from<T>(storage: T): Box<T> { return new Box(storage); }
      static to<T>(box: Box<T>): T { return sideEffect(box.storage); }
    }
    declare function sideEffect<T>(value: T): T;
    export const result = Box.to(Box.from(41));`,
    `class Box<T> {
      constructor(private readonly storage: T) {}
      static from<T>(storage: T): Box<T> { return new Box(storage); }
      static to<T>(box: Box<T>): T { return box.storage; }
    }
    Box.from = <T>(storage: T): Box<T> => new Box(storage);
    export const result = Box.to(Box.from(41));`,
    `class Box<T> {
      constructor(private readonly storage: T) {}
      static from<T>(storage: T): Box<T> { return new Box(storage); }
      static to<T>(box: Box<T>): T { return box.storage; }
    }
    export const result = Box.to?.(Box.from(41));`,
    `class Box<T> {
      constructor(private readonly storage: T, private readonly other: T) {}
      static from<T>(storage: T): Box<T> { return new Box(storage, storage); }
      static to<T>(box: Box<T>): T { return box.other; }
    }
    export const result = Box.to(Box.from(41));`,
    `class Box<T> {
      private side = sideEffect();
      constructor(private readonly storage: T) {}
      static from<T>(storage: T): Box<T> { return new Box(storage); }
      static to<T>(box: Box<T>): T { return box.storage; }
    }
    declare function sideEffect(): number;
    export const result = Box.to(Box.from(41));`,
    `class Box<T> {
      constructor(private readonly storage: T) {}
      static from<T>(storage: T): Box<T> { return new Box(storage); }
      static to<T>(box: Box<T>): T { return box.storage; }
    }
    Object.defineProperty(Box, "to", { value: Box.to });
    export const result = Box.to(Box.from(41));`,
  ];

  for (const sourceText of cases) {
    const fixture = checkedScalarFixture(sourceText);
    const plan = createRepresentationProjectionPlan(
      fixture.source,
      createTargetProgramIndex(fixture.source, {
        bindingWrites: true,
        memberDispatch: false,
        declarationReferences: true,
      }),
      "closed-direct",
      fixtureSourceIdentityFor(fixture.source),
    );
    const result = lowerRepresentationProjections(fixture.sourceFile, plan);
    assert.equal(plan.optimizedCount, 0);
    assert.equal(result.rewriteCount, 0);
  }
});

test("accounts for every representation candidate in immutable evidence", () => {
  const fixture = checkedScalarFixture(exactRepresentations);
  const profile = createTypeScriptOptimizationProfile({
    pointerFlows: "location",
    scalarProjections: "preserve",
    representationProjections: "closed-direct",
    cooperativeEffects: "preserve",
  });
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: false,
    declarationReferences: true,
  });
  const scalar = createScalarRepresentationPlan(
    fixture.source,
    program,
    profile.scalarProjections,
    fixtureSourceIdentityFor(fixture.source),
  );
  const representation = createRepresentationProjectionPlan(
    fixture.source,
    program,
    profile.representationProjections,
    fixtureSourceIdentityFor(fixture.source),
  );
  const evidence = createTypeScriptOptimizationEvidence(
    profile,
    ["index.ts"],
    program.operations,
    undefined,
    scalar,
    representation,
    undefined,
  );

  assert.equal(evidence.schemaVersion, 15);
  assert.deepEqual(evidence.representationProjections, {
    profile: "closed-direct",
    identityCandidateCount: 1,
    inverseCandidateCount: 1,
    optimizedCount: 2,
    retainedCount: 0,
    fallbackReasons: [],
    storedFlows: {
      flowCount: 0,
      constructionCount: 0,
      projectionCount: 0,
    },
    identityCallables: {
      candidateCount: 0,
      optimizedCount: 0,
      retainedCount: 0,
      fallbackReasons: [],
    },
  });
  assert.ok(Object.isFrozen(evidence.representationProjections));
  assert.doesNotMatch(JSON.stringify(evidence), /\/src|\.temp/u);
});

function callTargets(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: Parameters<typeof visit>[1],
): readonly string[] {
  const targets: string[] = [];
  visit(fixture.source, root, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const expression = AsCallExpression(node)?.Expression;
    if (expression !== undefined) {
      const property = fixture.source.ast.as.AsPropertyAccessExpression(expression);
      targets.push(property?.Expression === undefined
        ? fixture.source.ast.text(expression)
        : `${fixture.source.ast.text(property.Expression)}.${fixture.source.ast.text(property.name)}`);
    }
  });
  return targets;
}
