import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedScalarFixture,
  visit,
} from "../scalar/scalar.test-support.js";
import { createRepresentationProjectionPlan } from "./plan.js";
import { lowerRepresentationProjections } from "./transform.js";

const exactIdentityCapability = `function identity<T>(value: T): T { return value; }
function kernel<T>(copy: (value: T) => T, value: T): T {
  return copy(value);
}
export const first = kernel((value: number): number => value, 41);
export const second = kernel(identity, 42);
`;

test("specializes a closed identity callable parameter and every caller", () => {
  const fixture = checkedScalarFixture(exactIdentityCapability);
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "closed-direct",
  );
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);
  const kernel = functionNamed(fixture, result.sourceFile, "kernel");

  assert.equal(plan.identityCallables.candidateCount, 1);
  assert.equal(plan.identityCallables.optimizedCount, 1);
  assert.equal(plan.identityCallables.retainedCount, 0);
  assert.equal(result.callableParameterCount, 1);
  assert.equal(result.callableArgumentCount, 2);
  assert.equal(result.callableInvocationCount, 1);
  assert.equal(fixture.source.ast.parameters(kernel).length, 1);
  assert.deepEqual(callArgumentCounts(fixture, result.sourceFile, "kernel"), [1, 1]);
  assert.deepEqual(callArgumentCounts(fixture, result.sourceFile, "copy"), []);
});

test("preserves an identity callable unless the complete family is selected", () => {
  const fixture = checkedScalarFixture(exactIdentityCapability);
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "preserve",
  );
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.identityCallables.candidateCount, 1);
  assert.equal(plan.identityCallables.optimizedCount, 0);
  assert.deepEqual(plan.identityCallables.retentions.map((entry) => entry.reason), [
    "profile-preserved",
  ]);
  assert.equal(result.callableParameterCount, 0);
  assert.deepEqual(callArgumentCounts(fixture, result.sourceFile, "kernel"), [2, 2]);
  assert.deepEqual(callArgumentCounts(fixture, result.sourceFile, "copy"), [1]);
});

test("specializes one exact callable contract across module boundaries", () => {
  const fixture = checkedScalarFixture(
    `import { kernel } from "./kernel.js";
export const first = kernel((value: number): number => value, 41);
export const second = kernel((value: number): number => value, 42);
`,
    {
      additionalFiles: {
        "/src/kernel.ts": `export function kernel(
  copy: (value: number) => number,
  value: number,
): number {
  return copy(value);
}
`,
      },
    },
  );
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "closed-direct",
  );
  const lowered = [...fixture.source.navigation.sourceFiles].map((sourceFile) =>
    lowerRepresentationProjections(sourceFile, plan)
  );
  const kernelFile = lowered.find((result) =>
    fixture.source.ast.getFileName(result.sourceFile) === "/src/kernel.ts"
  );
  const callerFile = lowered.find((result) =>
    fixture.source.ast.getFileName(result.sourceFile) === "/src/index.ts"
  );

  assert.ok(kernelFile !== undefined);
  assert.ok(callerFile !== undefined);
  assert.equal(plan.identityCallables.optimizedCount, 1);
  assert.equal(
    fixture.source.ast.parameters(
      functionNamed(fixture, kernelFile.sourceFile, "kernel"),
    ).length,
    1,
  );
  assert.deepEqual(callArgumentCounts(fixture, callerFile.sourceFile, "kernel"), [1, 1]);
  assert.deepEqual(callArgumentCounts(fixture, kernelFile.sourceFile, "copy"), []);
});

test("retains the complete callable family at every open boundary", () => {
  const cases = [
    {
      reason: "nonidentity-input",
      text: `function kernel(copy: (value: number) => number, value: number): number {
        return copy(value);
      }
      export const value = kernel((input) => input + 1, 41);`,
    },
    {
      reason: "open-parameter-use",
      text: `function kernel(copy: (value: number) => number, value: number): number {
        void copy;
        return copy(value);
      }
      export const value = kernel((input) => input, 41);`,
    },
    {
      reason: "open-owner-call",
      text: `function kernel(copy: (value: number) => number, value: number): number {
        return copy(value);
      }
      export const alias = kernel;
      export const value = kernel((input) => input, 41);`,
    },
    {
      reason: "mutable-parameter",
      text: `function kernel(copy: (value: number) => number, value: number): number {
        copy = (input) => input;
        return copy(value);
      }
      export const value = kernel((input) => input, 41);`,
    },
  ] as const;

  for (const fixtureCase of cases) {
    const fixture = checkedScalarFixture(fixtureCase.text);
    const plan = createRepresentationProjectionPlan(
      fixture.source,
      createTargetProgramIndex(fixture.source, {
        bindingWrites: true,
        memberDispatch: false,
      }),
      "closed-direct",
    );
    const result = lowerRepresentationProjections(fixture.sourceFile, plan);
    assert.equal(plan.identityCallables.optimizedCount, 0, fixtureCase.reason);
    assert.deepEqual(
      plan.identityCallables.retentions.map((entry) => entry.reason),
      [fixtureCase.reason],
      fixtureCase.reason,
    );
    assert.equal(result.callableParameterCount, 0, fixtureCase.reason);
  }
});

test("retains a callable supplied through a non-function declaration", () => {
  const fixture = checkedScalarFixture(`function kernel(
    copy: (value: number) => number,
    value: number,
  ): number {
    return copy(value);
  }
  const selected = (value: number): number => value;
  export const value = kernel(selected, 41);
  `);
  const plan = createRepresentationProjectionPlan(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
      memberDispatch: false,
    }),
    "closed-direct",
  );
  const result = lowerRepresentationProjections(fixture.sourceFile, plan);

  assert.equal(plan.identityCallables.optimizedCount, 0);
  assert.deepEqual(plan.identityCallables.retentions.map((entry) => entry.reason), [
    "nonidentity-input",
  ]);
  assert.equal(result.callableParameterCount, 0);
  assert.deepEqual(callArgumentCounts(fixture, result.sourceFile, "kernel"), [2]);
});

function functionNamed(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: Node,
  name: string,
): Node {
  let selected: Node | undefined;
  visit(fixture.source, root, (node) => {
    if (
      fixture.source.ast.is.IsFunctionDeclaration(node) &&
      fixture.source.ast.text(fixture.source.ast.name(node)) === name
    ) {
      selected = node;
    }
  });
  assert.ok(selected !== undefined);
  return selected;
}

function callArgumentCounts(
  fixture: ReturnType<typeof checkedScalarFixture>,
  root: Node,
  name: string,
): readonly number[] {
  const counts: number[] = [];
  visit(fixture.source, root, (node) => {
    const call = fixture.source.ast.as.AsCallExpression(node);
    if (
      call?.Expression !== undefined &&
      fixture.source.ast.is.IsIdentifier(call.Expression) &&
      fixture.source.ast.text(call.Expression) === name
    ) {
      counts.push(call.Arguments?.Nodes.length ?? 0);
    }
  });
  return counts;
}
