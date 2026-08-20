import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { createTargetProgramIndex } from "../../../program-index.js";
import { createInterfaceContractGraph } from "./graph.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles one checker-proven implicit interface implementation", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class StructuralReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new StructuralReader());
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 1);
  assert.equal(evidence.settledCallCount, 1);
  assert.equal(evidence.implementationCount, 1);
});

test("retains one implicit family when one reached implementation suspends", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
interface Reader { Read(): Awaitable<number>; }
class ImmediateReader {
  async Read(): Promise<number> { return 20; }
}
class RemoteReader {
  async Read(): Promise<number> { return await remote(); }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return (await read(new ImmediateReader())) +
    (await read(new RemoteReader()));
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 4);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.implementationCount, 2);
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.retainedFamilyCount, 1);
});

test("ignores a same-shaped class that never enters the interface", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
interface Reader { Read(): Awaitable<number>; }
class ImmediateReader {
  async Read(): Promise<number> { return 42; }
}
class UnrelatedReader {
  async Read(): Promise<number> { return await remote(); }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new ImmediateReader());
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 1);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.implementationCount, 1);
  assert.equal(evidence.settledFamilyCount, 1);
});

test("joins one inherited implicit implementation declaration", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class BaseReader {
  async Read(): Promise<number> { return 42; }
}
class DerivedReader extends BaseReader {}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new DerivedReader());
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components[0]?.entries[0]?.implementations.length, 1);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("retains one implicit callable-property implementation that escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class PropertyReader {
  readonly Read = async (): Promise<number> => 42;
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new PropertyReader());
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 2);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.implementationCount, 1);
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.retainedFamilyCount, 1);
  assert.equal(evidence.retainedFamilies[0]?.reason, "escaping-callable");
});
