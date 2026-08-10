import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "./effect.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

test("preserves a field through an open nominal carrier", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
class OpenCarrier {
  constructor(public holder: Holder) {}
}
declare function expose(value: unknown): void;
const holder = Holder.create({ value: 42 });
const carrier = new OpenCarrier(holder);
expose(carrier);
async function value(): Promise<Result | undefined> {
  return holder.result;
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

test("preserves a field whose stored value reaches a provider", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function expose(value: Result | undefined): void;
const holder = Holder.create({ value: 42 });
expose(holder.result);
async function value(): Promise<Result | undefined> {
  return holder.result;
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

test("preserves a field whose nominal value is itself thenable", () => {
  const fixture = checkedEffectFixture(`
class Result {
  declare private readonly brand: void;
  private constructor(readonly value: number) {}
  static create(value: number): Result { return new Result(value); }
  then(resolve: (value: number) => void): void { resolve(this.value); }
}
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
const holder = Holder.create(Result.create(42));
async function value(): Promise<unknown> {
  return holder.result;
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

test("preserves a field when a provider introduces its nominal value", () => {
  const fixture = checkedEffectFixture(`
class Result {
  declare private readonly brand: void;
  private constructor(readonly value: number) {}
  static create(value: number): Result { return new Result(value); }
}
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function remoteResult(): Result;
const holder = Holder.create(remoteResult());
async function value(): Promise<Result | undefined> {
  return holder.result;
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

test("preserves a field when any enters its nominal value flow", () => {
  const fixture = checkedEffectFixture(`
class Result {
  declare private readonly brand: void;
  private constructor(readonly value: number) {}
  static create(value: number): Result { return new Result(value); }
}
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function opaque(): any;
const introduced: Result = opaque();
const holder = Holder.create(introduced);
async function value(): Promise<Result | undefined> {
  return holder.result;
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
