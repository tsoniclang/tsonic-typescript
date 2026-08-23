import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AsTypeReferenceNode,
  IsAwaitExpression,
} from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a callable selected from one exact tuple slot", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

async function base(): Promise<number> { return 40; }
declare function remote(): Promise<number>;
function pair(): [() => Awaitable<number>, () => Promise<number>] {
  return [async (): Promise<number> => (await base()) + 1, remote];
}
async function invoke(): Promise<number> {
  const results = pair();
  const selected = results[0];
  return await selected();
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  assert.equal(countAwaitableReferences(fixture, result.sourceFile), 0);
});

test("settles a tuple callable through conditional checked forwarders", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

function base(): [() => Awaitable<number>, boolean] {
  return [async (): Promise<number> => 41, true];
}
function forward(selected: boolean): [() => Awaitable<number>, boolean] {
  return selected ? base() : [(): number => 42, false];
}
async function invoke(): Promise<number> {
  const results = forward(true);
  return await results[0]();
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  assert.equal(countAwaitableReferences(fixture, result.sourceFile), 0);
});

function countAwaitableReferences(
  fixture: ReturnType<typeof checkedEffectFixture>,
  root: Parameters<typeof countNodes>[1],
): number {
  return countNodes(fixture.source, root, (node) => {
    const reference = AsTypeReferenceNode(node);
    return reference !== undefined &&
      fixture.source.ast.text(reference.TypeName) === "Awaitable";
  });
}

test("settles an awaited tuple producer and its selected callable", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

async function pair(): Promise<[() => Awaitable<number>, boolean]> {
  return [async (): Promise<number> => 42, true];
}
async function invoke(): Promise<number> {
  const results = await pair();
  return await results[0]();
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("settles a callable parameter forwarded through a tuple kernel", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

function kernel(
  callback: () => Awaitable<number>,
): [() => Awaitable<number>, boolean] {
  return [callback, true];
}
function wrapper(
  callback: () => Awaitable<number>,
): [() => Awaitable<number>, boolean] {
  return kernel(callback);
}
async function selected(): Promise<number> { return 42; }
async function invoke(): Promise<number> {
  return await wrapper(selected)[0]();
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
});

test("retains tuple transport when one producer result escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function expose(value: [() => Awaitable<number>, boolean]): void;

function kernel(
  callback: () => Awaitable<number>,
): [() => Awaitable<number>, boolean] {
  return [callback, true];
}
async function selected(): Promise<number> { return 42; }
async function invoke(): Promise<number> {
  expose(kernel(selected));
  return await kernel(selected)[0]();
}
export const result = await invoke();
`);

  const originalAsync = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const originalAwaits = countNodes(
    fixture.source,
    fixture.sourceFile,
    IsAwaitExpression,
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsync,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    originalAwaits,
  );
});

test("retains tuple transport when one projected callable escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

function kernel(
  callback: () => Awaitable<number>,
): [() => Awaitable<number>, boolean] {
  return [callback, true];
}
async function selected(): Promise<number> { return 42; }
export const exposed = kernel(selected)[0];
async function invoke(): Promise<number> {
  return await kernel(selected)[0]();
}
export const result = await invoke();
`);

  const originalAsync = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsync,
  );
});

test("retains a direct tuple callable when one projection escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

function pair(): [() => Awaitable<number>, boolean] {
  return [async (): Promise<number> => 42, true];
}
export const exposed = pair()[0];
async function invoke(): Promise<number> {
  return await pair()[0]();
}
export const result = await invoke();
`);

  const originalAsync = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsync,
  );
});

for (const [name, statement] of [
  ["aggregate escape", "expose(results);"],
  ["element write", "results[0] = remote;"],
] as const) {
  test(`retains a projected callable after ${name}`, () => {
    const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
declare function expose(value: [() => Awaitable<number>, boolean]): void;

function pair(): [() => Awaitable<number>, boolean] {
  return [async (): Promise<number> => 42, true];
}
async function invoke(): Promise<number> {
  const results = pair();
  ${statement}
  return await results[0]();
}
export const result = await invoke();
`);

    const originalAsync = countAsyncCallables(
      fixture.source,
      fixture.sourceFile,
    );
    const originalAwaits = countNodes(
      fixture.source,
      fixture.sourceFile,
      IsAwaitExpression,
    );
    const plan = createFixtureEffectPlan(fixture.source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();

    assert.equal(
      countAsyncCallables(fixture.source, result.sourceFile),
      originalAsync,
    );
    assert.equal(
      countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
      originalAwaits,
    );
  });
}

for (const [name, selection] of [
  ["dynamic index", "results[selected ? 0 : 1]"],
  ["spread slot", "results[0]"],
] as const) {
  test(`retains a projected callable with a ${name}`, () => {
    const producer = name === "spread slot"
      ? `
const values: [() => Awaitable<number>] = [
  async (): Promise<number> => 42,
];
function pair(): [() => Awaitable<number>, () => Awaitable<number>] {
  return [...values, (): number => 43];
}`
      : `
function pair(): [() => Awaitable<number>, () => Awaitable<number>] {
  return [async (): Promise<number> => 42, (): number => 43];
}`;
    const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
${producer}
async function invoke(selected: boolean): Promise<number> {
  const results = pair();
  return await ${selection}();
}
export const result = await invoke(true);
`);

    const originalAsync = countAsyncCallables(
      fixture.source,
      fixture.sourceFile,
    );
    const plan = createFixtureEffectPlan(fixture.source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();

    assert.equal(
      countAsyncCallables(fixture.source, result.sourceFile),
      originalAsync,
    );
  });
}
