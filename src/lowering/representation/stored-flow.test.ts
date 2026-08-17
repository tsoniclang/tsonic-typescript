import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AsCallExpression,
  AsVariableDeclaration,
  IsCallExpression,
  IsVariableDeclaration,
  IsVoidExpression,
} from "@tsonic/tsts/target-ast";
import type { Node, SourceFile } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedScalarFixture,
  countNodes,
  visit,
} from "../scalar/scalar.test-support.js";
import { createRepresentationProjectionPlan } from "./plan.js";
import { lowerRepresentationProjections } from "./transform.js";

const storedWrapper = `let evaluations = 0;
function next(): number { evaluations += 1; return 41; }
class Box<T> {
  constructor(private readonly storage: T) {}
  static from<T>(storage: T): Box<T> { return new Box(storage); }
  static to<T>(box: Box<T>): T { return box.storage; }
}
const wrapped = Box.from(next());
export const result = [Box.to(wrapped), Box.to(wrapped), evaluations];
`;

test("eliminates one closed stored wrapper flow atomically", () => {
  const fixture = checkedScalarFixture(storedWrapper);
  const plan = createPlan(fixture);
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.inverseCandidateCount, 2);
  assert.equal(plan.optimizedCount, 2);
  assert.equal(plan.storedFlows.flowCount, 1);
  assert.equal(plan.storedFlows.constructionCount, 1);
  assert.equal(plan.storedFlows.projectionCount, 2);
  assert.equal(result.storedConstructionCount, 1);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsVoidExpression), 3);
  assert.deepEqual(callTargets(fixture, result.sourceFile), ["next"]);
});

test("preserves a stored wrapper unless the closed profile is selected", () => {
  const fixture = checkedScalarFixture(storedWrapper);
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "preserve",
  );
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.optimizedCount, 0);
  assert.equal(plan.storedFlows.flowCount, 0);
  assert.equal(result.storedConstructionCount, 0);
  assert.deepEqual(callTargets(fixture, result.sourceFile), [
    "Box.from",
    "next",
    "Box.to",
    "Box.to",
  ]);
});

test("retains the complete stored flow at every observable boundary", () => {
  const cases = [
    storedWrapper.replace("const wrapped", "export const wrapped"),
    storedWrapper.replace("const wrapped", "let wrapped"),
    storedWrapper.replace(
      "const wrapped =",
      "const wrapped: Box<number> =",
    ),
    storedWrapper.replace(
      "export const result =",
      "void (wrapped === wrapped);\nexport const result =",
    ),
    storedWrapper.replace(
      "export const result =",
      "declare function consume(value: Box<number>): void;\nconsume(wrapped);\nexport const result =",
    ),
  ];

  for (const sourceText of cases) {
    const fixture = checkedScalarFixture(sourceText);
    const plan = createPlan(fixture);
    const result = lowerRepresentationProjections(fixture.sourceFile, plan);
    assert.equal(plan.optimizedCount, 0);
    assert.equal(plan.storedFlows.flowCount, 0);
    assert.equal(result.storedConstructionCount, 0);
  }
});

test("fails closed when a stored-flow reference identity is mutated", () => {
  const fixture = checkedScalarFixture(storedWrapper);
  const binding = variableNamed(fixture, fixture.sourceFile, "wrapped");
  const references = fixture.source.navigation.referencesToDeclaration(binding);
  assert.equal(references.length, 2);
  const originalNavigation = fixture.source.navigation;
  const mutated = {
    ...fixture.source,
    navigation: {
      ...originalNavigation,
      referencesToDeclaration(declaration: Node) {
        const selected = originalNavigation.referencesToDeclaration(declaration);
        return declaration === binding ? selected.slice(0, 1) : selected;
      },
    },
  };
  const plan = createRepresentationProjectionPlan(
    mutated,
    createTargetProgramIndex(mutated, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "closed-direct",
  );

  assert.equal(plan.optimizedCount, 0);
  assert.equal(plan.storedFlows.flowCount, 0);
});

test("does not trust a reflected static callable", () => {
  const cases = [
    `class Box {
      static identity(value: number): number { return value; }
    }
    Object.defineProperty(Box, "identity", { value: () => 99 });
    export const result = Box.identity(41);`,
  ];

  for (const sourceText of cases) {
    const fixture = checkedScalarFixture(sourceText);
    const plan = createPlan(fixture);
    assert.equal(plan.optimizedCount, 0);
  }
});

function createPlan(
  fixture: ReturnType<typeof checkedScalarFixture>,
): ReturnType<typeof createRepresentationProjectionPlan> {
  return createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "closed-direct",
  );
}

function variableNamed(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: SourceFile,
  name: string,
): Node {
  let selected: Node | undefined;
  visit(fixture.source, root, (node) => {
    const declaration = IsVariableDeclaration(node)
      ? AsVariableDeclaration(node)
      : undefined;
    if (fixture.source.ast.text(declaration?.name) === name) {
      selected = node;
    }
  });
  assert.ok(selected !== undefined);
  return selected;
}

function callTargets(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: SourceFile,
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
