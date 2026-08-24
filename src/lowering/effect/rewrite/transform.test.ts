import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IsArrowFunction,
  IsAwaitExpression,
  IsFunctionExpression,
} from "@tsonic/tsts/target-ast";

import {
  countAsyncCallables,
  countNodes,
  checkedEffectFixture,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "../test-support/fixture.test-support.js";
import {
  lowerCooperativeEffects,
} from "./transform.js";

test("settles a closed transitive call chain and its exact awaits", () => {
  const fixture = checkedEffectFixture(`
export async function leaf(): Promise<number> { return 40; }
export async function middle(): Promise<number> { return (await leaf()) + 1; }
export async function top(): Promise<number> { return await middle(); }
export const result = await top();
`);

  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles a recursive strongly connected component", () => {
  const fixture = checkedEffectFixture(`
async function even(value: number): Promise<boolean> {
  return value === 0 ? true : await odd(value - 1);
}
async function odd(value: number): Promise<boolean> {
  return value === 0 ? false : await even(value - 1);
}
export const result = await even(4);
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves a provider boundary and every transitive caller", () => {
  const fixture = checkedEffectFixture(`
declare function remote(): Promise<number>;
async function blocked(): Promise<number> { return await remote(); }
async function caller(): Promise<number> { return await blocked(); }
export const result = await caller();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    3,
  );
});

test("preserves an escaped callable signature", () => {
  const fixture = checkedEffectFixture(`
async function value(): Promise<number> { return 1; }
export const escaped: () => Promise<number> = value;
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves an async function that directly returns a promise", () => {
  const fixture = checkedEffectFixture(`
async function value(): Promise<number> { return Promise.resolve(1); }
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("settles checked non-thenable aggregate and covariant returns", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
async function value(): Promise<Result | undefined> { return { value: 41 }; }
async function aggregate(): Promise<[number, Result | undefined]> {
  return [1, await value()];
}
export const result = await aggregate();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles an exact local return accumulator", () => {
  const fixture = checkedEffectFixture(`
async function leaf(): Promise<number> { return 41; }
async function aggregate(selected: boolean): Promise<[number, undefined]> {
  let result: [number, undefined] = [0, undefined];
  if (selected) result = [await leaf(), undefined];
  result = result;
  return result;
}
export const result = await aggregate(true);
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles an accumulator consumed by its awaited replacement", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
async function replace(_value: Result | undefined): Promise<Result> {
  return { value: 42 };
}
async function value(): Promise<Result | undefined> {
  let result: Result | undefined = undefined;
  result = await replace(result);
  result = result;
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("preserves a local return value exposed to an unknown call", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
declare function expose(value: Result): void;
async function value(): Promise<Result> {
  const result: Result = { value: 42 };
  expose(result);
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a local return value produced by an open call", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
declare function produce(): Result;
async function value(): Promise<Result> {
  const result = produce();
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves aggregate returns whose construction may provide then", () => {
  const fixture = checkedEffectFixture(`
const base = { value: 41 };
async function spread(): Promise<{ value: number }> { return { ...base }; }
async function thenable(): Promise<unknown> {
  return { then(resolve: (value: number) => void): void { resolve(42); } };
}
export const result = [await spread(), await thenable()];
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    2,
  );
});

test("settles exact static methods and cross-file imports", () => {
  const fixture = checkedEffectFixture(`
import { MathOps } from "./math.js";
export const result = await MathOps.answer();
`, {
    "/src/math.ts": `
export class MathOps {
  static async answer(): Promise<number> { return 42; }
}
`,
  });
  const plan = createClosedCooperativeEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    1,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    1,
  );
  plan.finish();
});

test("propagates one boundary through a deep chain without rescanning it", () => {
  const declarations = Array.from({ length: 64 }, (_, index) => {
    const next = index === 63 ? "remote()" : `value${index + 1}()`;
    return `async function value${index}(): Promise<number> { return await ${next}; }`;
  }).join("\n");
  const fixture = checkedEffectFixture(`
declare function remote(): Promise<number>;
${declarations}
export const result = await value0();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 64);
});

test("settles every concrete producer of a readonly callable wrapper", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
async function base(): Promise<number> { return 40; }
const callback = new Callback(async (): Promise<number> => (await base()) + 1);
async function invoke(): Promise<number> { return (await callback.value!()) + 1; }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsArrowFunction),
    1,
  );
});

test("keeps a callable-wrapper family canonical when one producer may suspend", () => {
  const fixture = checkedEffectFixture(`
declare function remote(): Promise<number>;
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
const callback = new Callback(async (): Promise<number> => await remote());
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("rejects a callable wrapper whose constructor escapes the closed program", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
const Constructor = Callback;
const callback = new Constructor(async (): Promise<number> => 42);
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("rejects a callable wrapper whose stored callable escapes", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
const callback = new Callback(async (): Promise<number> => 42);
export const escaped = callback.value;
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("rejects spread construction and runtime class inheritance", () => {
  for (const sourceText of [
    `
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
const values: [() => Promise<number>] = [async () => 42];
const callback = new Callback(...values);
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`,
    `
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
class Derived extends Callback {}
const callback = new Callback(async (): Promise<number> => 42);
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`,
  ]) {
    const fixture = checkedEffectFixture(sourceText);
    const plan = createClosedCooperativeEffectPlan(fixture.source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();

    assert.equal(result.callableCount, 0);
    assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
  }
});

test("keeps an await of a synchronous promise-returning declaration", () => {
  const fixture = checkedEffectFixture(`
function remote(): Promise<number> { return Promise.resolve(42); }
async function invoke(): Promise<number> { return await remote(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("removes an await of an exact synchronous non-thenable call", () => {
  const fixture = checkedEffectFixture(`
function remote(): number { return 42; }
async function invoke(): Promise<number> { return await remote(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles an indirect call with a proven synchronous producer", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
const callback = new Callback((): number => 42);
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a guarded callable copied through one immutable local", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
async function base(): Promise<number> { return 40; }
const callback = new Callback(async (): Promise<number> => (await base()) + 1);
function missing(): never { throw new Error("missing callback"); }
async function invoke(): Promise<number> {
  if (callback.value === undefined) return 0;
  const selected = callback.value;
  return await (selected ?? missing())();
}
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("preserves a settled function expression as an expression", () => {
  const fixture = checkedEffectFixture(`
class Callback {
  constructor(readonly value: (() => number | Promise<number>) | undefined) {}
}
const callback = new Callback(async function (): Promise<number> { return 42; });
async function invoke(): Promise<number> { return await callback.value!(); }
export const result = await invoke();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsFunctionExpression),
    1,
  );
});

test("settles a closed instance method and its exact call", () => {
  const fixture = checkedEffectFixture(`
class Counter {
  async next(value: number): Promise<number> { return value + 1; }
}
const counter = new Counter();
export const result = await counter.next(41);
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("keeps an override family canonical", () => {
  const fixture = checkedEffectFixture(`
class Base {
  async next(value: number): Promise<number> { return value + 1; }
}
class Derived extends Base {
  override async next(value: number): Promise<number> { return value + 2; }
}
const value: Base = new Derived();
export const result = await value.next(40);
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});
