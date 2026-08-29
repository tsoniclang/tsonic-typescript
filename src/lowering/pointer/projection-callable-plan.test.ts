import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AsCallExpression,
  IsArrowFunction,
  IsCallExpression,
} from "@tsonic/tsts/target-ast";

import { prepareTypeScriptLowering } from "../transform.js";
import { createTargetProgramIndex } from "../program-index.js";
import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { createPointerProjectionCallablePlan } from "./projection-callable-plan.js";
import { lowerPointers } from "./transform.js";

const exactProjection = `
import type { Pointer } from "./markers.js";
import { bindPointer, hashPointer, projectPointer } from "./markers.js";
class Storage { constructor(readonly value: number) {} }
class Box {
  constructor(readonly storage: Storage) {}
  static from(storage: Storage): Box { return new Box(storage); }
  static to(box: Box): Storage { return box.storage; }
}
let storage = new Storage(41);
const source: Pointer<Storage> = bindPointer(
  {},
  () => storage,
  next => { storage = next; },
);
const projected = projectPointer<Storage, Box>(
  source,
  value => Box.from(value),
  value => Box.to(value),
)!;
export const result = hashPointer(projected);
`;

test("elides exact project-pointer forwarding callables at their semantic owner", () => {
  const fixture = checkedPointerFixture(exactProjection);
  const lowered = lowerPointers(
    fixture.source,
    fixture.sourceFile,
    createFixturePointerFlowPlan(fixture.source),
  );
  const call = callNamed(fixture, lowered.sourceFile, "projectLocation");
  const arguments_ = AsCallExpression(call)?.Arguments?.Nodes ?? [];

  assert.equal(arguments_.length, 3);
  assert.equal(IsArrowFunction(arguments_[1]), false);
  assert.equal(IsArrowFunction(arguments_[2]), false);
  assert.equal(propertyText(fixture, arguments_[1]), "Box.from");
  assert.equal(propertyText(fixture, arguments_[2]), "Box.to");
});

test("elides exact forwarding callables through module imports", () => {
  const fixture = checkedPointerFixture(
    `
import type { Pointer } from "./markers.js";
import { bindPointer, hashPointer, projectPointer } from "./markers.js";
import { Box as ImportedBox, Storage } from "./public.js";
let storage = new Storage(41);
const source: Pointer<Storage> = bindPointer(
  {},
  () => storage,
  next => { storage = next; },
);
const projected = projectPointer<Storage, ImportedBox>(
  source,
  value => ImportedBox.from(value),
  value => ImportedBox.to(value),
)!;
export const result = hashPointer(projected);
`,
    {
      "/src/box.ts": `
export class Storage { constructor(readonly value: number) {} }
export class Box {
  constructor(readonly storage: Storage) {}
  static from(storage: Storage): Box { return new Box(storage); }
  static to(box: Box): Storage { return box.storage; }
}
`,
      "/src/public.ts": `export { Box, Storage } from "./box.js";`,
    },
  );
  const lowered = lowerPointers(
    fixture.source,
    fixture.sourceFile,
    createFixturePointerFlowPlan(fixture.source),
  );
  const call = callNamed(fixture, lowered.sourceFile, "projectLocation");
  const arguments_ = AsCallExpression(call)?.Arguments?.Nodes ?? [];

  assert.equal(IsArrowFunction(arguments_[1]), false);
  assert.equal(IsArrowFunction(arguments_[2]), false);
  assert.equal(propertyText(fixture, arguments_[1]), "ImportedBox.from");
  assert.equal(propertyText(fixture, arguments_[2]), "ImportedBox.to");
});

test("accounts for exact forwarding decisions in immutable evidence", () => {
  const fixture = checkedPointerFixture(exactProjection);
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
  assert.equal(prepared.transaction.evidence.schemaVersion, 28);
  assert.deepEqual(prepared.transaction.evidence.pointer.projectionCallables, {
    candidateCount: 2,
    optimizedCount: 2,
    retainedCount: 0,
    exactProjectionCount: 1,
    fallbackReasons: [],
  });
});

test("retains forwarding arrows when callable stability is not closed", () => {
  const cases = [
    {
      source: `${exactProjection}\nBox.from = value => new Box(value);\n`,
      reason: "unstable-binding",
    },
    {
      source: exactProjection.replace(
        "static from(storage: Storage): Box { return new Box(storage); }",
        "static from(storage: Storage): Box { void this; return new Box(storage); }",
      ),
      reason: "unstable-binding",
    },
    {
      source: exactProjection
        .replace(
          "const projected = projectPointer<Storage, Box>(",
          "const converter = Box.from;\nconst projected = projectPointer<Storage, Box>(",
        )
        .replace("value => Box.from(value)", "value => converter(value)"),
      reason: "open-call",
    },
  ] as const;
  for (const selected of cases) {
    const fixture = checkedPointerFixture(selected.source);
    const program = createTargetProgramIndex(fixture.source, {
      bindingWrites: true,
    });
    const plan = createPointerProjectionCallablePlan(
      fixture.source,
      program,
      "closed-direct",
      (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
    );
    assert.equal(plan.candidateCount, 2);
    assert.ok(plan.retainedCount >= 1);
    assert.ok(plan.fallbackReasons.some((row) => row.reason === selected.reason));
  }
});

test("canonical pointer profile preserves exact forwarding callables", () => {
  const fixture = checkedPointerFixture(exactProjection);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
  });
  const plan = createPointerProjectionCallablePlan(
    fixture.source,
    program,
    "location",
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );
  assert.equal(plan.candidateCount, 2);
  assert.equal(plan.optimizedCount, 0);
  assert.equal(plan.retainedCount, 2);
  assert.deepEqual(plan.fallbackReasons.map((row) => row.reason), [
    "profile-preserved",
  ]);
});

function callNamed(
  fixture: ReturnType<typeof checkedPointerFixture>,
  root: Parameters<typeof visit>[1],
  name: string,
) {
  let selected: Parameters<typeof visit>[1] | undefined;
  visit(fixture.source, root, (node) => {
    if (!IsCallExpression(node)) {
      return;
    }
    const expression = AsCallExpression(node)?.Expression;
    const property = fixture.source.ast.as.AsPropertyAccessExpression(expression);
    const calledName = property?.name ?? expression;
    if (calledName !== undefined && fixture.source.ast.text(calledName) === name) {
      selected = node;
    }
  });
  assert.ok(selected !== undefined, `Missing call '${name}'.`);
  return selected;
}

function propertyText(
  fixture: ReturnType<typeof checkedPointerFixture>,
  node: Parameters<typeof visit>[1] | undefined,
): string {
  const property = fixture.source.ast.as.AsPropertyAccessExpression(node);
  assert.ok(property?.Expression !== undefined && property.name !== undefined);
  return `${fixture.source.ast.text(property.Expression)}.${fixture.source.ast.text(property.name)}`;
}
