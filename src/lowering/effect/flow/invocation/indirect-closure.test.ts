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

test("settles callbacks through nested exact indirect invocations", () => {
  const fixture = checkedEffectFixture(`
type Callback = () => number | PromiseLike<number>;
type Invoke = (callback: Callback) => number | PromiseLike<number>;
function inner(callback: Callback): number | PromiseLike<number> {
  return callback();
}
function outer(callback: Callback): number | PromiseLike<number> {
  const invoke: Invoke = inner;
  return invoke(callback);
}
const selected: Invoke = outer;
async function leaf(): Promise<number> { return 42; }
async function top(): Promise<number> { return await selected(leaf); }
export const result = await top();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  assert.equal(countTypeReferences(fixture, result.sourceFile, "PromiseLike"), 0);
});

test("constructs callable-storage topology once across closure rounds", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  declare private readonly brand: void;
  public constructor(public value: (() => Awaitable<number>) | undefined) {}
  static zero(): Slot { return new Slot(undefined); }
}
async function base(): Promise<number> { return 42; }
const slot = Slot.zero();
slot.value = async (): Promise<number> => await base();
async function top(): Promise<number> { return await slot.value!(); }
export const result = await top();
`);
  const phases: string[] = [];

  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    (phase) => phases.push(phase),
  );
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(
    phases.filter((phase) => phase === "effect-indirect-round").length > 1,
  );
  assert.equal(
    phases.filter((phase) => phase === "effect-indirect-storage-topology").length,
    1,
  );
});

test("settles a callable returned by an exact indirect invocation", () => {
  const fixture = checkedEffectFixture(`
type Callback = () => number | PromiseLike<number>;
type Factory = () => Callback;
function produce(): Callback {
  return async (): Promise<number> => 42;
}
const factory: Factory = produce;
const selected = factory();
async function top(): Promise<number> { return await selected(); }
export const result = await top();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  assert.equal(countTypeReferences(fixture, result.sourceFile, "Awaitable"), 0);
});

test("settles a callable reached through a closed object owner", () => {
  const fixture = checkedEffectFixture(`
type Callback = () => number | PromiseLike<number>;
type Invoke = (callback: Callback) => number | PromiseLike<number>;
function invoke(callback: Callback): number | PromiseLike<number> {
  return callback();
}
const holder: { readonly invoke: Invoke } = { invoke };
const selected = holder.invoke;
async function leaf(): Promise<number> { return 42; }
async function top(): Promise<number> { return await selected(leaf); }
export const result = await top();
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

test("settles a callable returned by admitted interface dispatch", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
type Callback = () => Awaitable<number>;
interface Factory { Create(): Awaitable<Callback>; }
class ProjectFactory implements Factory {
  async Create(): Promise<Callback> {
    return async (): Promise<number> => 42;
  }
}
async function select(factory: Factory): Promise<Callback> {
  return await factory.Create();
}
const selected = await select(new ProjectFactory());
async function top(): Promise<number> { return await selected(); }
export const result = await top();
`);
  const phases: string[] = [];

  const plan = createFixtureEffectPlan(
    fixture.source,
    "declared-closed",
    (phase) => phases.push(phase),
  );
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    0,
  );
  assert.equal(
    phases.filter((phase) => phase === "effect-projection-candidate-order").length,
    2,
  );
  const interfacePhase = phases.indexOf("effect-interface-dispatch");
  assert.notEqual(interfacePhase, -1);
  assert.equal(
    phases.slice(interfacePhase + 1).filter(
      (phase) => phase === "effect-projection-candidate-order",
    ).length,
    1,
  );
});

test("retains a nested indirect chain with one open callable origin", () => {
  const fixture = checkedEffectFixture(`
type Callback = () => number | PromiseLike<number>;
type Invoke = (callback: Callback) => number | PromiseLike<number>;
declare const externalInvoke: Invoke;
function inner(callback: Callback): number | PromiseLike<number> {
  return callback();
}
const selected: Invoke = Math.random() > 0.5 ? inner : externalInvoke;
async function leaf(): Promise<number> { return 42; }
async function top(): Promise<number> { return await selected(leaf); }
export const result = await top();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    2,
  );
});

test("retains a reassigned indirect implementation binding", () => {
  const fixture = checkedEffectFixture(`
type Callback = () => number | PromiseLike<number>;
function invoke(callback: Callback): number | PromiseLike<number> {
  return callback();
}
declare const externalInvoke: typeof invoke;
let selected = invoke;
selected = externalInvoke;
async function leaf(): Promise<number> { return 42; }
async function top(): Promise<number> { return await selected(leaf); }
export const result = await top();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("retains a closed alias family with one exported sibling reference", () => {
  const fixture = checkedEffectFixture(`
type Callback = () => number | PromiseLike<number>;
type Invoke = (callback: Callback) => number | PromiseLike<number>;
function invoke(callback: Callback): number | PromiseLike<number> {
  return callback();
}
const holder: { readonly invoke: Invoke } = { invoke };
const selected = holder.invoke;
export const escaped = invoke;
async function leaf(): Promise<number> { return 42; }
async function top(): Promise<number> { return await selected(leaf); }
export const result = await top();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, result.sourceFile) > 0);
});

test("settles a closed callback origin inside mixed awaitable storage", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
type Callback = () => Awaitable<number>;
declare const external: Callback;
class Slot {
  constructor(public readonly value: Callback) {}
}
async function closed(): Promise<number> { return 42; }
const local = new Slot(closed);
const remote = new Slot(external);
async function invoke(slot: Slot): Promise<number> {
  const selected = slot.value;
  return await selected();
}
export const result = [await invoke(local), await invoke(remote)];
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 1);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("retains a mixed-storage callback whose Promise identity is observed", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
type Callback = () => Awaitable<number>;
declare const external: Callback;
class Slot {
  constructor(public readonly value: Callback) {}
}
async function closed(): Promise<number> { return 42; }
const local = new Slot(closed);
const remote = new Slot(external);
function observe(slot: Slot): boolean {
  const selected = slot.value;
  return selected() instanceof Promise;
}
export const result = [observe(local), observe(remote)];
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("retains an extracted interface method without receiver evidence", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
const reader: Reader = new Pair();
const selected = reader.Read;
async function top(): Promise<number> { return await selected(); }
export const result = await top();
`);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, result.sourceFile) > 0);
});

function countTypeReferences(
  fixture: ReturnType<typeof checkedEffectFixture>,
  root: Parameters<typeof countNodes>[1],
  name: string,
): number {
  return countNodes(fixture.source, root, (node) => {
    const reference = AsTypeReferenceNode(node);
    return reference !== undefined &&
      fixture.source.ast.text(reference.TypeName) === name;
  });
}
