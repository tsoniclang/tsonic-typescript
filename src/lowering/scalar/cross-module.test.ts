import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, Symbol } from "@tsonic/tsts";
import {
  AsAsExpression,
  AsBinaryExpression,
  AsCallExpression,
  AsNewExpression,
  AsPropertyAccessExpression,
  AsVoidExpression,
  encodeTargetSourceFileForPrinting,
  IsAsExpression,
  IsClassDeclaration,
  IsNewExpression,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  createFixtureScalarRepresentationPlan as createScalarRepresentationPlan,
} from "./scalar.test-support.js";
import {
  checkedScalarFixture,
  countNodes,
  visit,
} from "./scalar.test-support.js";
import { lowerScalarRepresentations } from "./transform.js";

const transparentScalar = `export class Scalar {
  declare private readonly brand: void;
  constructor(public readonly value: number) {}
}
`;

test("projects an exact transparent scalar wrapper across a module import", () => {
  const fixture = checkedScalarFixture(`import { Scalar as ImportedScalar } from "./scalar.js";
let evaluations = 0;
function next(value: number): number { evaluations += 1; return value; }
export const result = [new ImportedScalar(next(42)).value, evaluations];
`, { additionalFiles: { "/src/scalar.ts": transparentScalar } });
  const access = findNode(fixture.source, fixture.sourceFile, (node) =>
    IsPropertyAccessExpression(node) &&
    IsNewExpression(AsPropertyAccessExpression(node)?.Expression)
  );
  const construction = AsNewExpression(
    AsPropertyAccessExpression(access)?.Expression,
  );
  const reference = fixture.source.navigation.sourceReferenceFor(
    construction?.Expression,
  );
  assert.equal(reference?.project, true);
  assert.ok(IsClassDeclaration(reference?.declaration));
  assert.equal(
    fixture.source.ast.getFileName(reference?.sourceFile),
    "/src/scalar.ts",
  );

  const plan = createScalarRepresentationPlan(fixture.source, "closed-direct");
  const result = lowerScalarRepresentations(fixture.sourceFile, plan);
  assert.equal(plan.syntacticProjectionCount, 1);
  assert.equal(plan.projectionCount, 1);
  assert.equal(plan.retainedProjectionCount, 0);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsNewExpression), 0);
  const comma = findNode(fixture.source, result.sourceFile, (node) =>
      fixture.source.ast.operatorKindName(node) === "KindCommaToken"
  );
  const binary = AsBinaryExpression(comma);
  const target = AsVoidExpression(binary?.Left)?.Expression;
  const argument = AsCallExpression(binary?.Right)?.Expression;
  assert.equal(fixture.source.ast.text(target), "ImportedScalar");
  assert.equal(fixture.source.ast.text(argument), "next");
});

test("retains an imported wrapper when its exported class binding changes", () => {
  const use = `import { Scalar } from "./scalar.js";
export const result = new Scalar(42).value;
`;
  const mutableScalar = `export class Scalar {
  constructor(public readonly value: number) {}
}
`;
  const stable = checkedScalarFixture(use, {
    additionalFiles: { "/src/scalar.ts": mutableScalar },
  });
  const mutated = checkedScalarFixture(use, {
    additionalFiles: {
      "/src/scalar.ts": `${mutableScalar}
class Replacement {
  constructor(public readonly value: number) { throw new Error("observable"); }
}
(Scalar as unknown as { new(value: number): Scalar }) = Replacement;
`,
    },
  });

  assert.equal(
    createScalarRepresentationPlan(stable.source, "closed-direct").projectionCount,
    1,
  );
  const mutatedPlan = createScalarRepresentationPlan(
    mutated.source,
    "closed-direct",
  );
  assert.equal(mutatedPlan.projectionCount, 0);
  assert.deepEqual(mutatedPlan.fallbackReasons.map((entry) => entry.reason), [
    "mutable-class-binding",
  ]);
});

test("normalizes only exact portable primitive result types", () => {
  const use = `import { Big, Flag, Scalar, Text } from "./scalar.js";
export const result = [
  new Scalar(42).value,
  new Text("value").value,
  new Flag(true).value,
  new Big(1n).value,
];
`;
  const alias = checkedScalarFixture(use, {
    additionalFiles: {
      "/src/scalar.ts": `type Narrow = number;
export class Scalar { constructor(public readonly value: Narrow) {} }
export class Text { constructor(public readonly value: string) {} }
export class Flag { constructor(public readonly value: boolean) {} }
export class Big { constructor(public readonly value: bigint) {} }
`,
    },
  });
  const literal = checkedScalarFixture(`import { Scalar } from "./scalar.js";
export const result = new Scalar(42).value;
`, {
    additionalFiles: {
      "/src/scalar.ts": `export class Scalar {
  constructor(public readonly value: 42) {}
}
`,
    },
  });

  const aliasPlan = createScalarRepresentationPlan(alias.source, "closed-direct");
  const aliasResult = lowerScalarRepresentations(alias.sourceFile, aliasPlan);
  const assertionKinds: string[] = [];
  visit(alias.source, aliasResult.sourceFile, (node) => {
    const assertion = IsAsExpression(node) ? AsAsExpression(node) : undefined;
    if (assertion?.Type !== undefined) {
      assertionKinds.push(alias.source.ast.kindName(assertion.Type));
    }
  });
  assert.equal(aliasPlan.projectionCount, 4);
  assert.deepEqual(assertionKinds, [
    "KindNumberKeyword",
    "KindStringKeyword",
    "KindBooleanKeyword",
    "KindBigIntKeyword",
  ]);
  assert.ok(
    encodeTargetSourceFileForPrinting(aliasResult.sourceFile).byteLength > 0,
  );
  const literalPlan = createScalarRepresentationPlan(
    literal.source,
    "closed-direct",
  );
  assert.equal(literalPlan.projectionCount, 0);
  assert.deepEqual(literalPlan.fallbackReasons.map((entry) => entry.reason), [
    "nonportable-cross-module-type",
  ]);
});

test("does not rescan an imported class for each projection", () => {
  const projectionCount = 128;
  const fixture = checkedScalarFixture(`import { Scalar } from "./scalar.js";
export const result = [${Array.from(
    { length: projectionCount },
    (_, index) => `new Scalar(${index}).value`,
  ).join(",")}];
`, { additionalFiles: { "/src/scalar.ts": transparentScalar } });
  const navigation = fixture.source.navigation;
  let bindingWriteQueries = 0;
  const measured: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...navigation,
      bindingWritesWithin(symbol: Symbol, root: Node) {
        bindingWriteQueries += 1;
        return navigation.bindingWritesWithin(symbol, root);
      },
    }),
  });

  const plan = createScalarRepresentationPlan(measured, "closed-direct");
  assert.equal(plan.projectionCount, projectionCount);
  assert.equal(bindingWriteQueries, 0);
});

function findNode(
  source: TargetSourceProgram,
  root: Node,
  predicate: (node: Node) => boolean,
): Node {
  let found: Node | undefined;
  visit(source, root, (node) => {
    if (found === undefined && predicate(node)) {
      found = node;
    }
  });
  assert.ok(found !== undefined);
  return found;
}
