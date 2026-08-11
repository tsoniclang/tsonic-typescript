import assert from "node:assert/strict";
import { test } from "node:test";

import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "./effect.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles intrinsically synchronous bodyless call signatures", () => {
  const fixture = checkedEffectFixture(`
import { direct, predicate, reader } from "./provider.js";

async function numberValue(): Promise<number> { return await direct(); }
async function stringValue(): Promise<string> { return await reader.read(); }
async function booleanValue(): Promise<boolean> { return await predicate(); }
export const result = [
  await numberValue(),
  await stringValue(),
  await booleanValue(),
];
`, {
    "/src/provider.d.ts": `
export declare function direct(): number;
export interface Reader { read(): string }
export declare const reader: Reader;
export declare const predicate: () => boolean;
`,
  });

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("uses the exact instantiated result of a bodyless generic call", () => {
  const fixture = checkedEffectFixture(`
import { identity } from "./provider.js";
async function value(): Promise<number> { return await identity(42); }
export const result = await value();
`, {
    "/src/provider.d.ts": `
export declare function identity<T>(value: T): T;
`,
  });

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1, JSON.stringify(plan.summary));
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a bodyless callable widened into awaitable storage", () => {
  const fixture = checkedEffectFixture(`
import { direct } from "./provider.js";
type Awaitable<T> = T | PromiseLike<T>;
const callback: () => Awaitable<number> = direct;
async function value(): Promise<number> { return await callback(); }
export const result = await value();
`, {
    "/src/provider.d.ts": `
export declare const direct: () => number;
`,
  });

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1, JSON.stringify(plan.summary));
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("changing a bodyless result to Promise restores cooperative transport", () => {
  const direct = lower(`export declare function selected(): number;`, `
import { selected } from "./provider.js";
async function value(): Promise<number> { return await selected(); }
export const result = await value();
`);
  const cooperative = lower(
    `export declare function selected(): Promise<number>;`,
    `
import { selected } from "./provider.js";
async function value(): Promise<number> { return await selected(); }
export const result = await value();
`,
  );

  assert.deepEqual(direct, {
    settled: 1,
    retained: 0,
    asyncCallables: 0,
  });
  assert.deepEqual(cooperative, {
    settled: 0,
    retained: 1,
    asyncCallables: 1,
  });
});

test("does not promote an implementation-file ambient declaration", () => {
  const fixture = checkedEffectFixture(`
declare function selected(): number;
async function value(): Promise<number> { return await selected(); }
export const result = await value();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("retains structurally open and possibly thenable results", () => {
  const fixture = checkedEffectFixture(`
import {
  maybe,
  structural,
  unknownValue,
  type Result,
} from "./provider.js";

async function objectValue(): Promise<Result> { return await structural(); }
async function maybeValue(): Promise<number> { return await maybe(); }
async function openValue(): Promise<unknown> { return await unknownValue(); }
export const result = [
  await objectValue(),
  await maybeValue(),
  await openValue(),
];
`, {
    "/src/provider.d.ts": `
export interface Result { readonly value: number }
export declare function structural(): Result;
export declare function maybe(): number | Promise<number>;
export declare function unknownValue(): unknown;
`,
  });

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 3);
});

function lower(providerText: string, sourceText: string): {
  readonly settled: number;
  readonly retained: number;
  readonly asyncCallables: number;
} {
  const fixture = checkedEffectFixture(sourceText, {
    "/src/provider.d.ts": providerText,
  });
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  return {
    settled: plan.summary.settledCallableCount,
    retained: plan.summary.retainedCallableCount,
    asyncCallables: countAsyncCallables(fixture.source, result.sourceFile),
  };
}
