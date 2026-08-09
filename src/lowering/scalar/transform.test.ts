import assert from "node:assert/strict";
import { test } from "node:test";

import {
  transpileModule,
} from "@tsonic/tsts";
import {
  AsBinaryExpression,
  AsCallExpression,
  AsPropertyAccessExpression,
  AsVoidExpression,
  encodeTargetSourceFileForPrinting,
  IsAsExpression,
  IsClassDeclaration,
  IsNewExpression,
  IsPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import type {
  Node,
} from "@tsonic/tsts";
import type {
  TargetSourceProgram,
} from "@tsonic/target-api";

import {
  checkedScalarFixture,
  countNodes,
  visit,
} from "./scalar.test-support.js";
import { createScalarRepresentationPlan } from "./plan.js";
import {
  createScalarRepresentationRewriter,
  lowerScalarRepresentations,
} from "./transform.js";

const transparentProjections = `declare const storage: unique symbol;
interface Stored<T> { readonly [storage]: T; }
let evaluations = 0;
function next(value: number): number {
  evaluations += 1;
  return value;
}
export class Scalar implements Stored<number> {
  declare private readonly brand: void;
  declare readonly [storage]: number;
  constructor(public readonly value: number) {}
  label(): string { return "scalar"; }
  get description(): string { return "scalar"; }
  static identity(value: number): number { return value; }
}
export const escaped = new Scalar(9);
export const Alias = Scalar;
export const result: [number, number, number] = [
  new Scalar(next(40)).value,
  new Scalar(next(2)).value,
  evaluations,
];
`;

test("plans each exact projection despite exports and other class uses", () => {
  const fixture = checkedScalarFixture(transparentProjections);
  const plan = createScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );

  assert.equal(plan.profile, "closed-direct");
  assert.equal(plan.moduleBoundary, "closed");
  assert.equal(plan.syntacticProjectionCount, 2);
  assert.equal(plan.projectionCount, 2);
  assert.equal(plan.retainedProjectionCount, 0);
  assert.equal(plan.projectionsFor(fixture.sourceFile).length, 2);
});

test("rewrites only the admitted immediate projections", () => {
  const fixture = checkedScalarFixture(transparentProjections);
  const plan = createScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const result = lowerScalarRepresentations(
    fixture.sourceFile,
    plan,
  );

  assert.equal(result.projectionCount, 2);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsClassDeclaration),
    1,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsNewExpression),
    1,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAsExpression),
    2,
  );
  const commaExpressions: Node[] = [];
  visit(fixture.source, result.sourceFile, (node) => {
    if (fixture.source.ast.operatorKindName(node) === "KindCommaToken") {
      commaExpressions.push(node);
    }
  });
  assert.equal(commaExpressions.length, 2);
  for (const expression of commaExpressions) {
    const binary = AsBinaryExpression(expression);
    const targetEvaluation = AsVoidExpression(binary?.Left);
    const argumentCall = AsCallExpression(binary?.Right);
    assert.ok(targetEvaluation?.Expression !== undefined);
    assert.equal(
      fixture.source.ast.text(targetEvaluation.Expression),
      "Scalar",
    );
    assert.ok(argumentCall?.Expression !== undefined);
    assert.equal(fixture.source.ast.text(argumentCall.Expression), "next");
  }
  const transformedEncoding = encodeTargetSourceFileForPrinting(
    result.sourceFile,
  );
  assert.ok(transformedEncoding.byteLength > 0);
});

test("admits primitive scalar aliases without declaration-name rules", () => {
  const fixture = checkedScalarFixture(`type Narrow = number;
class Alpha { constructor(readonly payload: Narrow) {} }
class Beta { constructor(readonly text: string) {} }
class TruthBox { constructor(readonly flag: boolean) {} }
class Delta { constructor(readonly count: bigint) {} }
export const values = [
  new Alpha(1).payload,
  new Beta("value").text,
  new TruthBox(true).flag,
  new Delta(1n).count,
];
`);

  const plan = createScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  assert.equal(plan.syntacticProjectionCount, 4);
  assert.equal(plan.projectionCount, 4);
  assert.equal(plan.retainedProjectionCount, 0);
});

test("preserves canonical representation unless closed-direct is explicit", () => {
  const fixture = checkedScalarFixture(transparentProjections);
  const plan = createScalarRepresentationPlan(fixture.source, "preserve");
  const result = lowerScalarRepresentations(
    fixture.sourceFile,
    plan,
  );

  assert.equal(plan.moduleBoundary, "open");
  assert.equal(plan.projectionCount, 0);
  assert.equal(plan.retainedProjectionCount, 2);
  assert.equal(result.projectionCount, 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsNewExpression),
    3,
  );
});

test("rejects construction effects and non-scalar projections", () => {
  const cases: readonly [
    string,
    string,
    { readonly experimentalDecorators?: boolean }?,
  ][] = [
    ["constructor body", `function effect(): void {}
class Scalar { constructor(readonly value: number) { effect(); } }
export const result = new Scalar(1).value;
`],
    ["mutable parameter property", `class Scalar { constructor(public value: number) {} }
export const result = new Scalar(1).value;
`],
    ["instance field initializer", `function effect(): number { return 1; }
class Scalar {
  extra = effect();
  constructor(readonly value: number) {}
}
export const result = new Scalar(1).value;
`],
    ["static field initializer", `function effect(): number { return 1; }
class Scalar {
  static extra = effect();
  constructor(readonly value: number) {}
}
export const result = new Scalar(1).value;
`],
    ["static block", `function effect(): void {}
class Scalar {
  static { effect(); }
  constructor(readonly value: number) {}
}
export const result = new Scalar(1).value;
`],
    ["parameter initializer", `class Scalar {
  constructor(readonly value: number = 1) {}
}
export const result = new Scalar(2).value;
`],
    ["base class", `class Base {}
class Scalar extends Base {
  constructor(readonly value: number) { super(); }
}
export const result = new Scalar(1).value;
`],
    ["getter projection", `class Scalar {
  constructor(readonly raw: number) {}
  get value(): number { return this.raw; }
}
export const result = new Scalar(1).value;
`],
    ["class decorator", `function decorate(target: Function): void {
  void target;
}
@decorate
class Scalar { constructor(readonly value: number) {} }
export const result = new Scalar(1).value;
`, { experimentalDecorators: true }],
    ["object wrapper", `class Scalar {
  constructor(readonly value: { readonly amount: number }) {}
}
export const result = new Scalar({ amount: 1 }).value;
`],
    ["array wrapper", `class Scalar {
  constructor(readonly value: readonly number[]) {}
}
export const result = new Scalar([1]).value;
`],
    ["aliased constructor target", `class Scalar {
  constructor(readonly value: number) {}
}
const Alias = Scalar;
export const result = new Alias(1).value;
`],
    ["reassigned constructor binding", `class Scalar {
  constructor(readonly value: number) {}
}
class Replacement {
  constructor(readonly value: number) { throw new Error("observable"); }
}
(Scalar as unknown as { new(value: number): Scalar }) = Replacement;
export const result = new Scalar(1).value;
`],
  ];

  for (const [label, sourceText, options] of cases) {
    const fixture = checkedScalarFixture(sourceText, options);
    const plan = createScalarRepresentationPlan(
      fixture.source,
      "closed-direct",
    );
    assert.equal(plan.projectionCount, 0, label);
    assert.ok(plan.retainedProjectionCount >= 1, label);
  }
});

test("fails closed when exact selected-field identity is mutated", () => {
  const fixture = checkedScalarFixture(transparentProjections);
  let access: Node | undefined;
  let classDeclaration: Node | undefined;
  visit(fixture.source, fixture.sourceFile, (node) => {
    if (classDeclaration === undefined && IsClassDeclaration(node)) {
      classDeclaration = node;
    }
    const property = IsPropertyAccessExpression(node)
      ? AsPropertyAccessExpression(node)
      : undefined;
    if (
      access === undefined &&
      property?.Expression !== undefined &&
      IsNewExpression(property.Expression)
    ) {
      access = node;
    }
  });
  assert.ok(access !== undefined);
  assert.ok(classDeclaration !== undefined);
  const selectedAccess = access;
  const wrongDeclaration = classDeclaration;
  const originalSemantics = fixture.source.semantics;
  const mutatedSource: TargetSourceProgram = {
    ...fixture.source,
    semantics: {
      ...originalSemantics,
      forNode(node) {
        const semantics = originalSemantics.forNode(node);
        if (node !== selectedAccess) {
          return semantics;
        }
        return {
          ...semantics,
          getResolvedPropertyAccessInfo(candidate) {
            const information = semantics.getResolvedPropertyAccessInfo(candidate);
            if (candidate !== selectedAccess || information === undefined) {
              return information;
            }
            return Object.freeze({
              ...information,
              selectedDeclaration: wrongDeclaration,
            });
          },
        };
      },
    },
  };

  const plan = createScalarRepresentationPlan(
    mutatedSource,
    "closed-direct",
  );
  assert.equal(plan.projectionCount, 1);
  assert.equal(plan.retainedProjectionCount, 1);
});

test("fails closed when a planned projection is not consumed", () => {
  const fixture = checkedScalarFixture(transparentProjections);
  const plan = createScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );
  const rewriter = createScalarRepresentationRewriter(
    plan,
    fixture.sourceFile,
  );

  assert.throws(
    () => rewriter.finish(fixture.sourceFile),
    /planned 2, consumed 0/u,
  );
});

test("matches execution and target-before-argument evaluation", async () => {
  const original = `const trace: number[] = [];
function next(value: number): number { trace.push(value); return value; }
class Scalar { constructor(readonly value: number) {} }
export const result = [
  new Scalar(next(40)).value,
  new Scalar(next(2)).value,
  trace.join(","),
];
`;
  const lowered = `const trace: number[] = [];
function next(value: number): number { trace.push(value); return value; }
class Scalar { constructor(readonly value: number) {} }
export const result = [
  ((void Scalar, next(40)) as number),
  ((void Scalar, next(2)) as number),
  trace.join(","),
];
`;
  checkedScalarFixture(lowered);

  const [originalModule, loweredModule] = await Promise.all([
    executeTypeScript(original, "original"),
    executeTypeScript(lowered, "lowered"),
  ]);
  assert.deepEqual(originalModule["result"], [40, 2, "40,2"]);
  assert.deepEqual(loweredModule["result"], originalModule["result"]);

  const originalTargetFirst = `const trace: string[] = [];
function argument(): number { trace.push("argument"); return 1; }
function project(): number | string {
  try { return new Scalar(argument()).value; }
  catch { return trace.join(","); }
}
export const result = project();
class Scalar { constructor(readonly value: number) {} }
`;
  const loweredTargetFirst = `const trace: string[] = [];
function argument(): number { trace.push("argument"); return 1; }
function project(): number | string {
  try { return ((void Scalar, argument()) as number); }
  catch { return trace.join(","); }
}
export const result = project();
class Scalar { constructor(readonly value: number) {} }
`;
  const targetFirstFixture = checkedScalarFixture(originalTargetFirst);
  assert.equal(
    createScalarRepresentationPlan(
      targetFirstFixture.source,
      "closed-direct",
    ).projectionCount,
    1,
  );
  const [originalTargetModule, loweredTargetModule] = await Promise.all([
    executeTypeScript(originalTargetFirst, "original-target-first"),
    executeTypeScript(loweredTargetFirst, "lowered-target-first"),
  ]);
  assert.equal(originalTargetModule["result"], "");
  assert.equal(
    loweredTargetModule["result"],
    originalTargetModule["result"],
  );
});

async function executeTypeScript(
  sourceText: string,
  identity: string,
): Promise<Readonly<Record<string, unknown>>> {
  const transpiled = transpileModule(sourceText, {
    fileName: `${identity}.ts`,
    reportDiagnostics: true,
    compilerOptions: {
      module: "esnext",
      target: "es2022",
    },
  });
  assert.equal(transpiled.diagnostics.length, 0);
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${identity}`) as
    Promise<Readonly<Record<string, unknown>>>;
}
