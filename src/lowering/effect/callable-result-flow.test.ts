import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "./effect.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

test("settles a callable returned by an exact checked call", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

async function base(): Promise<number> { return 40; }
async function choose(selected: boolean): Promise<(() => Awaitable<number>) | undefined> {
  if (selected) {
    return async (): Promise<number> => (await base()) + 1;
  }
  return (): number => 42;
}

async function invoke(selected: boolean): Promise<number> {
  const selectedCallable = await choose(selected);
  return await selectedCallable!();
}
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);

  assert.equal(result.callableCount, 4);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("retains returned callable flow across open method dispatch", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

class Producer {
  public async choose(): Promise<() => Awaitable<number>> {
    return async (): Promise<number> => 40;
  }
}

class DerivedProducer extends Producer {
  public override async choose(): Promise<() => Awaitable<number>> {
    return async (): Promise<number> => 41;
  }
}

async function invoke(producer: Producer): Promise<number> {
  const selectedCallable = await producer.choose();
  return await selectedCallable();
}

void DerivedProducer;
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 5);
  assert.equal(plan.summary.retainedCallableCount, 5);
});

test("retains a returned callable when its producer binding changes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

class Producer {
  public static async choose(): Promise<() => Awaitable<number>> {
    return async (): Promise<number> => 40;
  }
}

Producer.choose = async function replacement(): Promise<() => Awaitable<number>> {
  return async (): Promise<number> => 41;
};

async function invoke(): Promise<number> {
  const selectedCallable = await Producer.choose();
  return await selectedCallable();
}
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 5);
  assert.equal(plan.summary.retainedCallableCount, 5);
});

test("does not treat an existing callable reference as fresh", () => {
  const fixture = checkedEffectFixture(`
type Callable = () => number;
const hiddenThenable: Callable = Object.assign(
  (): number => 40,
  { then(resolve: (value: Callable) => void): void { resolve(() => 41); } },
);

async function produce(): Promise<Callable> {
  return hiddenThenable;
}
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});
