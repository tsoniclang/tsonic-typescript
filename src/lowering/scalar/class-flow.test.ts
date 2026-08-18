import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AsPropertyAccessExpression,
  AsImportSpecifier,
  AsVariableDeclaration,
  IsClassDeclaration,
  IsImportSpecifier,
  IsNewExpression,
  IsPropertyAccessExpression,
  IsTypeReferenceNode,
  IsVariableDeclaration,
  IsVoidExpression,
} from "@tsonic/tsts/target-ast";
import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedScalarFixture,
  countNodes,
  createFixtureScalarRepresentationPlan,
  visit,
} from "./scalar.test-support.js";
import { lowerScalarRepresentations } from "./transform.js";

const representationOnlyClass = `export class Mode {
  declare private readonly brand: void;
  constructor(public readonly value: number) {}
  declare private readonly then?: never;
}
`;

test("lowers one closed immediate scalar component across files", () => {
  const fixture = checkedScalarFixture(`import { Mode } from "./mode.js";
export const result = new Mode(42).value;
`, { additionalFiles: { "/src/mode.ts": representationOnlyClass } });
  const plan = createFixtureScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const transformed = new Map(fixture.source.sourceFiles.map((sourceFile) => [
    fixture.source.ast.getFileName(sourceFile),
    lowerScalarRepresentations(sourceFile, plan).sourceFile,
  ]));
  const mode = transformed.get("/src/mode.ts");
  const index = transformed.get("/src/index.ts");

  assert.ok(mode !== undefined);
  assert.ok(index !== undefined);
  assert.equal(plan.scalarClassCandidateCount, 1);
  assert.equal(plan.loweredScalarClassCount, 1);
  assert.equal(plan.retainedScalarClassCount, 0);
  assert.equal(countNodes(fixture.source, mode, IsClassDeclaration), 0);
  assert.equal(countNodes(fixture.source, mode, IsVariableDeclaration), 1);
  assert.equal(countNodes(fixture.source, mode, IsVoidExpression), 1);
  assert.equal(countNodes(fixture.source, index, IsNewExpression), 0);
  assert.equal(countNodes(fixture.source, index, IsPropertyAccessExpression), 0);
  let sentinelName: string | undefined;
  let importIsTypeOnly: boolean | undefined;
  visit(fixture.source, mode, (node) => {
    const declaration = AsVariableDeclaration(node);
    if (declaration?.name !== undefined) {
      sentinelName = fixture.source.ast.text(declaration.name);
    }
  });
  visit(fixture.source, index, (node) => {
    if (IsImportSpecifier(node)) {
      importIsTypeOnly = AsImportSpecifier(node)?.IsTypeOnly;
    }
  });
  assert.equal(sentinelName, "Mode");
  assert.equal(importIsTypeOnly, false);
});

test("retains the complete scalar class when its constructor value escapes", () => {
  const fixture = checkedScalarFixture(`${representationOnlyClass}
export const Constructor = Mode;
export const selected = new Mode(42);
export const result = selected.value;
`);
  const plan = createFixtureScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const result = lowerScalarRepresentations(fixture.sourceFile, plan);

  assert.equal(plan.scalarClassCandidateCount, 1);
  assert.equal(plan.loweredScalarClassCount, 0);
  assert.equal(plan.retainedScalarClassCount, 1);
  assert.deepEqual(
    plan.scalarClassFallbackReasons.map((entry) => entry.reason),
    ["observable-class-value"],
  );
  assert.equal(countNodes(fixture.source, result.sourceFile, IsClassDeclaration), 1);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsNewExpression), 1);
});

test("rewrites closed type references and immutable stored scalar flows", () => {
  const closed = checkedScalarFixture(`${representationOnlyClass}
type Alias = Mode;
export const result = new Mode(42).value;
`);
  const closedPlan = createFixtureScalarRepresentationPlan(
    closed.source,
    "closed-direct",
  );
  const closedResult = lowerScalarRepresentations(
    closed.sourceFile,
    closedPlan,
  );
  assert.equal(closedPlan.loweredScalarClassCount, 1);
  assert.equal(
    countNodes(closed.source, closedResult.sourceFile, IsTypeReferenceNode),
    0,
  );

  const stored = checkedScalarFixture(`${representationOnlyClass}
const selected: Mode = new Mode(42);
export const result = selected.value;
`);
  const storedPlan = createFixtureScalarRepresentationPlan(
    stored.source,
    "closed-direct",
  );
  const storedResult = lowerScalarRepresentations(
    stored.sourceFile,
    storedPlan,
  );
  assert.equal(storedPlan.loweredScalarClassCount, 1);
  assert.equal(storedPlan.retainedScalarClassCount, 0);
  assert.equal(countNodes(stored.source, storedResult.sourceFile, IsClassDeclaration), 0);
  assert.equal(countNodes(stored.source, storedResult.sourceFile, IsNewExpression), 0);
  assert.equal(
    countNodes(stored.source, storedResult.sourceFile, IsPropertyAccessExpression),
    0,
  );
  assert.equal(
    countNodes(stored.source, storedResult.sourceFile, IsTypeReferenceNode),
    0,
  );
});

test("retains stored scalar identity and open construction boundaries", () => {
  const cases = [
    `${representationOnlyClass}
const first: Mode = new Mode(42);
const second: Mode = new Mode(42);
export const result = first === second;
`,
    `${representationOnlyClass}
export const selected: Mode = new Mode(42);
export const result = selected.value;
`,
  ];
  for (const sourceText of cases) {
    const fixture = checkedScalarFixture(sourceText);
    const plan = createFixtureScalarRepresentationPlan(
      fixture.source,
      "closed-direct",
    );
    assert.equal(plan.loweredScalarClassCount, 0);
    assert.equal(plan.retainedScalarClassCount, 1);
  }
});

test("fails closed when a stored projection reference join is mutated", () => {
  const fixture = checkedScalarFixture(`${representationOnlyClass}
const selected: Mode = new Mode(42);
export const result = selected.value;
`);
  let receiver: Node | undefined;
  visit(fixture.source, fixture.sourceFile, (node) => {
    const access = AsPropertyAccessExpression(node);
    if (
      receiver === undefined &&
      access?.Expression !== undefined &&
      fixture.source.ast.text(access.Expression) === "selected"
    ) {
      receiver = access.Expression;
    }
  });
  assert.ok(receiver !== undefined);
  const selectedReceiver = receiver;
  const reference = fixture.source.navigation.sourceReferenceFor(selectedReceiver);
  assert.ok(reference !== undefined);
  const mutatedSource: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      sourceReferenceFor(node: Node | undefined) {
        if (node !== selectedReceiver) {
          return fixture.source.navigation.sourceReferenceFor(node);
        }
        return Object.freeze({
          ...reference,
          declaration: fixture.sourceFile,
        });
      },
    }),
  });

  const plan = createFixtureScalarRepresentationPlan(
    mutatedSource,
    "closed-direct",
  );
  assert.equal(plan.loweredScalarClassCount, 0);
  assert.deepEqual(
    plan.scalarClassFallbackReasons.map((entry) => entry.reason),
    ["open-projection"],
  );
});

test("retains the whole class for observable members and nonportable types", () => {
  const cases = [
    {
      source: `class Mode {
  constructor(readonly value: number) {}
  label(): string { return "mode"; }
}
export const result = new Mode(42).value;
`,
      reason: "observable-class-member",
    },
    {
      source: `class Mode { constructor(readonly value: 42) {} }
export const result = new Mode(42).value;
`,
      reason: "nonportable-type",
    },
  ] as const;
  for (const fixtureCase of cases) {
    const fixture = checkedScalarFixture(fixtureCase.source);
    const plan = createFixtureScalarRepresentationPlan(
      fixture.source,
      "closed-direct",
    );
    assert.equal(plan.loweredScalarClassCount, 0);
    assert.deepEqual(
      plan.scalarClassFallbackReasons.map((entry) => entry.reason),
      [fixtureCase.reason],
    );
  }
});
