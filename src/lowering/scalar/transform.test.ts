import assert from "node:assert/strict";
import { test } from "node:test";

import {
  transpileModule,
} from "@tsonic/tsts";
import {
  AsBinaryExpression,
  AsCallExpression,
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
  SourceProgramNavigation,
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

const transparentComponent = `let evaluations = 0;
function next(value: number): number {
  evaluations += 1;
  return value;
}
class Scalar {
  constructor(public readonly value: number) {}
}
type ScalarType = Scalar;
export const result: [number, number, number] = [
  new Scalar(next(40)).value,
  new Scalar(next(2)).value,
  evaluations,
];
`;

test("plans one exact closed scalar allocation component", () => {
  const fixture = checkedScalarFixture(transparentComponent);
  const plan = createScalarRepresentationPlan(
    fixture.source,
    "closed-direct",
  );

  assert.equal(plan.profile, "closed-direct");
  assert.equal(plan.moduleBoundary, "closed");
  assert.equal(plan.syntacticProjectionCount, 2);
  assert.equal(plan.provenComponentCount, 1);
  assert.equal(plan.projectionCount, 2);
  assert.equal(plan.retainedProjectionCount, 0);
  assert.equal(plan.projectionsFor(fixture.sourceFile).length, 2);
});

test("rewrites exact allocations to typed evaluation sequences", () => {
  const fixture = checkedScalarFixture(transparentComponent);
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
    0,
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
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      (node) => fixture.source.ast.operatorKindName(node) === "KindCommaToken",
    ),
    2,
  );
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      IsPropertyAccessExpression,
    ),
    0,
  );
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
  assert.equal(plan.provenComponentCount, 4);
  assert.equal(plan.projectionCount, 4);
  assert.equal(plan.retainedProjectionCount, 0);
});

test("preserves canonical representation unless closed-direct is explicit", () => {
  const fixture = checkedScalarFixture(transparentComponent);
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
    2,
  );
});

test("retains the whole component when any semantic guard is mutated", () => {
  const cases: readonly [
    string,
    string,
    { readonly experimentalDecorators?: boolean }?,
  ][] = [
    ["constructor body", `function effect(): void {}
class Scalar { constructor(public readonly value: number) { effect(); } }
export const result = new Scalar(1).value;
`],
    ["mutable parameter property", `class Scalar { constructor(public value: number) {} }
export const result = new Scalar(1).value;
`],
    ["instance initializer", `function effect(): number { return 1; }
class Scalar {
  extra = effect();
  constructor(public readonly value: number) {}
}
export const result = new Scalar(1).value;
`],
    ["parameter initializer", `class Scalar {
  constructor(public readonly value: number = 1) {}
}
export const result = new Scalar(2).value;
`],
    ["base class", `class Base {}
class Scalar extends Base {
  constructor(public readonly value: number) { super(); }
}
export const result = new Scalar(1).value;
`],
    ["escaped allocation", `class Scalar { constructor(public readonly value: number) {} }
export const escaped = new Scalar(1);
export const result = new Scalar(2).value;
`],
    ["identity and instanceof", `class Scalar {
  constructor(public readonly value: number) {}
}
const observed = new Scalar(1);
export const identity = observed === observed;
export const instance = observed instanceof Scalar;
export const result = new Scalar(2).value;
`],
    ["reflective class use", `class Scalar { constructor(public readonly value: number) {} }
Object.defineProperty(Scalar.prototype, "value", { get: () => 9 });
export const result = new Scalar(1).value;
`],
    ["accessor projection", `class Scalar {
  constructor(public readonly input: number) {}
  get value(): number { return this.input; }
}
export const result = new Scalar(1).value;
`],
    ["runtime alias", `class Scalar {
  constructor(public readonly value: number) {}
}
const Alias = Scalar;
export const result = new Scalar(1).value;
void Alias;
`],
    ["aliased constructor", `class Scalar {
  constructor(public readonly value: number) {}
}
const Alias = Scalar;
export const result = new Alias(1).value;
`],
    ["class decorator", `function decorate(target: Function): void {
  void target;
}
@decorate
class Scalar { constructor(public readonly value: number) {} }
export const result = new Scalar(1).value;
`, { experimentalDecorators: true }],
    ["open exported class", `export class Scalar {
  constructor(public readonly value: number) {}
}
export const result = new Scalar(1).value;
`],
    ["object wrapper", `class Scalar {
  constructor(public readonly value: { readonly amount: number }) {}
}
export const result = new Scalar({ amount: 1 }).value;
`],
    ["array wrapper", `class Scalar {
  constructor(public readonly value: readonly number[]) {}
}
export const result = new Scalar([1]).value;
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

test("rejects exact class-binding write evidence", () => {
  const fixture = checkedScalarFixture(transparentComponent);
  let classDeclaration: Node | undefined;
  visit(fixture.source, fixture.sourceFile, (node) => {
    if (classDeclaration === undefined && IsClassDeclaration(node)) {
      classDeclaration = node;
    }
  });
  assert.ok(classDeclaration !== undefined);
  const originalNavigation = fixture.source.navigation;
  const mutatedNavigation: SourceProgramNavigation = {
    ...originalNavigation,
    bindingWritesWithin(symbol, root) {
      const original = originalNavigation.bindingWritesWithin(symbol, root);
      if (root !== fixture.sourceFile || classDeclaration === undefined) {
        return original;
      }
      return Object.freeze([
        ...original,
        Object.freeze({
          reference: classDeclaration,
          operation: classDeclaration,
          kind: "assignment" as const,
        }),
      ]);
    },
  };
  const mutatedSource: TargetSourceProgram = {
    ...fixture.source,
    navigation: mutatedNavigation,
  };

  const plan = createScalarRepresentationPlan(
    mutatedSource,
    "closed-direct",
  );
  assert.equal(plan.projectionCount, 0);
  assert.equal(plan.retainedProjectionCount, 2);
});

test("admits the component only when every allocation is projected", () => {
  const retained = checkedScalarFixture(`class Scalar {
  constructor(public readonly value: number) {}
}
export const escaped = new Scalar(1);
export const projected = new Scalar(2).value;
`);
  const closed = checkedScalarFixture(`class Scalar {
  constructor(public readonly value: number) {}
}
export const first = new Scalar(1).value;
export const second = new Scalar(2).value;
`);

  assert.equal(
    createScalarRepresentationPlan(retained.source, "closed-direct")
      .projectionCount,
    0,
  );
  assert.equal(
    createScalarRepresentationPlan(closed.source, "closed-direct")
      .projectionCount,
    2,
  );
});

test("fails closed when a planned projection is not consumed", () => {
  const fixture = checkedScalarFixture(transparentComponent);
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

test("matches executable behavior for the admitted scalar class", async () => {
  const original = `const trace: number[] = [];
function next(value: number): number { trace.push(value); return value; }
class Scalar { constructor(public readonly value: number) {} }
export const result = [
  new Scalar(next(40)).value,
  new Scalar(next(2)).value,
  trace.join(","),
];
`;
  const lowered = `const trace: number[] = [];
function next(value: number): number { trace.push(value); return value; }
class Scalar { constructor(public readonly value: number) {} }
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
class Scalar { constructor(public readonly value: number) {} }
`;
  const loweredTargetFirst = `const trace: string[] = [];
function argument(): number { trace.push("argument"); return 1; }
function project(): number | string {
  try { return ((void Scalar, argument()) as number); }
  catch { return trace.join(","); }
}
export const result = project();
class Scalar { constructor(public readonly value: number) {} }
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
