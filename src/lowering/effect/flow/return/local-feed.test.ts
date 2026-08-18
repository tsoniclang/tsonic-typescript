import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
  visit,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a returned accumulator fed by an exact local chain", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
async function source(): Promise<Failure | undefined> { return undefined; }
async function value(): Promise<Failure | undefined> {
  let output: Failure | undefined = undefined;
  let observed: Failure | undefined = await source();
  if (observed === undefined) observed = await source();
  const forwarded = observed;
  output = observed === undefined ? forwarded : observed;
  return output;
}
export const result = await value();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.deepEqual(
    {
      candidates: plan.summary.candidateCount,
      settled: plan.summary.settledCallableCount,
      retained: plan.summary.retainedCallableCount,
      settledAwaits: plan.summary.settledAwaitCount,
    },
    { candidates: 2, settled: 2, retained: 0, settledAwaits: 3 },
  );
  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  const value = functionNamed(fixture.source, result.sourceFile, "value");
  const returnType = fixture.source.ast.typeNode(value);
  assert.ok(returnType !== undefined);
  assert.equal(fixture.source.ast.is.IsUnionTypeNode(returnType), true);
});

test("complete feeder writes decide whether local transport can settle", () => {
  const settled = lower(`
interface Failure { readonly message: string }
async function source(): Promise<Failure | undefined> { return undefined; }
async function value(): Promise<Failure | undefined> {
  let output: Failure | undefined;
  let observed = await source();
  output = observed;
  return output;
}
export const result = await value();
`);
  const retained = lower(`
interface Failure { readonly message: string }
const hidden = {
  message: "hidden",
  then(resolve: (value: Failure) => void): void { resolve(this); },
};
async function source(): Promise<Failure | undefined> { return undefined; }
async function value(selected: boolean): Promise<Failure | undefined> {
  let output: Failure | undefined;
  let observed: Failure | undefined = await source();
  if (selected) observed = hidden;
  output = observed;
  return output;
}
export const result = await value(false);
`);

  assert.deepEqual(settled, { settled: 2, retained: 0 });
  assert.deepEqual(retained, { settled: 1, retained: 1 });
});

test("preserves a returned accumulator when its feeder escapes", () => {
  const result = lower(`
interface Failure { readonly message: string }
declare function expose(value: Failure | undefined): void;
async function source(): Promise<Failure | undefined> { return undefined; }
async function value(): Promise<Failure | undefined> {
  let output: Failure | undefined;
  const observed = await source();
  expose(observed);
  output = observed;
  return output;
}
export const result = await value();
`);

  assert.deepEqual(result, { settled: 1, retained: 1 });
});

test("preserves a returned accumulator when a nested callable captures its feeder", () => {
  const result = lower(`
interface Failure { readonly message: string }
async function source(): Promise<Failure | undefined> { return undefined; }
async function value(): Promise<Failure | undefined> {
  let output: Failure | undefined;
  const observed = await source();
  const inspect = (): Failure | undefined => observed;
  inspect();
  output = observed;
  return output;
}
export const result = await value();
`);

  assert.deepEqual(result, { settled: 1, retained: 1 });
});

test("preserves a local-feed family rooted at a provider suspension", () => {
  const result = lower(`
interface Failure { readonly message: string }
declare function remote(): Promise<Failure | undefined>;
async function value(): Promise<Failure | undefined> {
  let output: Failure | undefined;
  const observed = await remote();
  output = observed;
  return output;
}
export const result = await value();
`);

  assert.deepEqual(result, { settled: 0, retained: 1 });
});

test("closes every independent local-feed family with bounded work", () => {
  const count = 64;
  const functions = Array.from({ length: count }, (_, index) => `
async function value${index}(): Promise<Failure | undefined> {
  let output: Failure | undefined;
  const observed = await source();
  output = observed;
  return output;
}
`).join("");
  const calls = Array.from(
    { length: count },
    (_, index) => `await value${index}()`,
  ).join(", ");
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
async function source(): Promise<Failure | undefined> { return undefined; }
${functions}
export const results = [${calls}];
`);
  const plan = createFixtureEffectPlan(fixture.source);

  assert.deepEqual(
    {
      candidates: plan.summary.candidateCount,
      settled: plan.summary.settledCallableCount,
      retained: plan.summary.retainedCallableCount,
      settledAwaits: plan.summary.settledAwaitCount,
    },
    {
      candidates: count + 1,
      settled: count + 1,
      retained: 0,
      settledAwaits: count * 2,
    },
  );
});

function lower(sourceText: string): {
  readonly settled: number;
  readonly retained: number;
} {
  const fixture = checkedEffectFixture(sourceText);
  const plan = createFixtureEffectPlan(fixture.source);
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  return {
    settled: plan.summary.settledCallableCount,
    retained: plan.summary.retainedCallableCount,
  };
}

function functionNamed(
  source: ReturnType<typeof checkedEffectFixture>["source"],
  sourceFile: ReturnType<typeof checkedEffectFixture>["sourceFile"],
  name: string,
): Node {
  let found: Node | undefined;
  visit(source, sourceFile, (node) => {
    if (
      source.ast.is.IsFunctionDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === name
    ) {
      found = node;
    }
  });
  assert.ok(found !== undefined);
  return found;
}
