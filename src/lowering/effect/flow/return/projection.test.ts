import assert from "node:assert/strict";
import { test } from "node:test";

import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { createTargetProgramIndex } from "../../../program-index.js";
import { createExactAggregateProjectionIndex } from "../aggregate/projection.js";
import { collectReturnProjectionCandidates } from "./projection/candidates.js";

test("roots return projection only at values that may be thenable", () => {
  const fixture = checkedEffectFixture(`
interface ThenableValue {
  then(resolve: (value: number) => void): void;
}
declare function pair(): [ThenableValue | undefined, number];
const possiblyThenable = pair()[0];
const scalar = pair()[1];
export const result = [possiblyThenable, scalar];
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  const projections = createExactAggregateProjectionIndex(
    fixture.source,
    program,
  );
  const candidates = collectReturnProjectionCandidates(
    fixture.source,
    projections,
  );

  assert.equal(projections.roots.length, 2);
  assert.deepEqual(
    candidates.map((candidate) => {
      const argument = fixture.source.ast.as.AsElementAccessExpression(candidate)
        ?.ArgumentExpression;
      return argument === undefined ? undefined : fixture.source.ast.text(argument);
    }),
    ["0"],
  );
});

test("settles an exact nonthenable result projected from a direct tuple call", () => {
  const fixture = checkedEffectFixture(`
class Failure { constructor(readonly message: string) {} }
async function pair(selected: boolean): Promise<[number, Failure | undefined]> {
  return selected ? [1, new Failure("failed")] : [0, undefined];
}
async function consume(): Promise<Failure | undefined> {
  const results = await pair(false);
  const value = results[0];
  const result = results[1];
  if (value > 0) return result;
  return undefined;
}
export const result = await consume();
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

test("settles a tuple slot forwarded through direct checked callables", () => {
  const fixture = checkedEffectFixture(`
class Failure { constructor(readonly message: string) {} }
async function base(): Promise<[number, Failure | undefined]> {
  return [1, new Failure("failed")];
}
async function forward(): Promise<[number, Failure | undefined]> {
  return await base();
}
async function consume(): Promise<Failure | undefined> {
  const results = await forward();
  return results[1];
}
export const result = await consume();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves a tuple slot produced by an open value call", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
declare function externalFailure(): Failure;
async function pair(selected: boolean): Promise<[number, Failure | undefined]> {
  return selected ? [1, externalFailure()] : [0, undefined];
}
async function consume(): Promise<Failure | undefined> {
  const results = await pair(true);
  return results[1];
}
export const result = await consume();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a projected tuple after its aggregate escapes", () => {
  const fixture = checkedEffectFixture(`
class Failure { constructor(readonly message: string) {} }
declare function expose(value: [number, Failure | undefined]): void;
async function pair(): Promise<[number, Failure | undefined]> {
  return [1, new Failure("failed")];
}
async function consume(): Promise<Failure | undefined> {
  const results = await pair();
  expose(results);
  return results[1];
}
export const result = await consume();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a projected tuple after an element write", () => {
  const fixture = checkedEffectFixture(`
class Failure { constructor(readonly message: string) {} }
class ThenableFailure extends Failure {
  then(resolve: (value: number) => void): void { resolve(42); }
}
async function pair(): Promise<[number, Failure | undefined]> {
  return [1, new Failure("failed")];
}
async function consume(): Promise<Failure | undefined> {
  const results = await pair();
  results[1] = new ThenableFailure("changed");
  return results[1];
}
export const result = await consume();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("settles a projection through a stack-independent result chain", () => {
  const depth = 2_500;
  const declarations = [
    "async function step0(): Promise<[number, undefined]> { return [1, undefined]; }",
  ];
  for (let index = 1; index < depth; index += 1) {
    declarations.push(
      `async function step${index}(): Promise<[number, undefined]> { return await step${index - 1}(); }`,
    );
  }
  const fixture = checkedEffectFixture(`
${declarations.join("\n")}
export const result = (await step${depth - 1}())[1];
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, depth);
  assert.equal(result.awaitCount, depth);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("bounds a recursively deepening projection as open", () => {
  const fixture = checkedEffectFixture(`
type Nested = readonly [Nested];
async function cycle(): Promise<Nested> {
  return (await cycle())[0];
}
export const result = (await cycle())[0];
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    2,
  );
});
