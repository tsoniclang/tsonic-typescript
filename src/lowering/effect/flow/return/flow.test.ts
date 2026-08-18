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

test("settles a return value carried only through awaited replacement aliases", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
async function normalize(_value: Failure | undefined): Promise<Failure | undefined> {
  return undefined;
}
async function value(): Promise<Failure | undefined> {
  let result: Failure | undefined = undefined;
  const first = result;
  const second = first;
  result = await normalize(second);
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

test("preserves a return alias exposed outside its awaited replacement", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
function expose(_value: Failure | undefined): void {}
async function normalize(_value: Failure | undefined): Promise<Failure | undefined> {
  return undefined;
}
async function value(): Promise<Failure | undefined> {
  let result: Failure | undefined = undefined;
  const alias = result;
  expose(alias);
  result = await normalize(alias);
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a return alias captured by a nested callable", () => {
  const fixture = checkedEffectFixture(`
interface Failure { readonly message: string }
async function normalize(_value: Failure | undefined): Promise<Failure | undefined> {
  return undefined;
}
async function value(): Promise<Failure | undefined> {
  let result: Failure | undefined = undefined;
  const alias = result;
  const read = (): Failure | undefined => alias;
  result = await normalize(result);
  read();
  return result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("settles a fresh exact project-class return", () => {
  const fixture = checkedEffectFixture(`
class Result {
  constructor(readonly value: number) {}
}
async function value(): Promise<Result> { return new Result(42); }
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves a fresh project class with callable then", () => {
  const fixture = checkedEffectFixture(`
class Thenable {
  constructor(readonly value: number) {}
  then(resolve: (value: number) => void): void { resolve(this.value); }
}
async function value(): Promise<unknown> { return new Thenable(42); }
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("settles an exact direct return producer", () => {
  const fixture = checkedEffectFixture(`
class Result {
  constructor(readonly value: number) {}
}
function produce(): unknown { return new Result(42); }
async function forward(): Promise<unknown> {
  return produce();
}
export const result = await forward();
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

test("settles an exact direct producer argument flow", () => {
  const fixture = checkedEffectFixture(`
class Result {
  constructor(readonly value: number) {}
}
function identity(value: unknown): unknown { return value; }
async function forward(): Promise<unknown> {
  return identity(new Result(42));
}
export const result = await forward();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves hidden thenability behind an open structural return", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
const hiddenThenable = {
  value: 42,
  then(resolve: (value: Result) => void): void { resolve({ value: 43 }); },
};
function produce(): Result {
  return hiddenThenable;
}
async function forward(): Promise<Result> {
  return produce();
}
export const result = await forward();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves an awaited hidden thenable from a synchronous producer", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
const hiddenThenable = {
  value: 42,
  then(resolve: (value: Result) => void): void { resolve({ value: 43 }); },
};
function produce(): Result {
  return hiddenThenable;
}
async function forward(): Promise<Result> {
  return await produce();
}
export const result = await forward();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
  assert.equal(
    countNodes(fixture.source, result.sourceFile, IsAwaitExpression),
    2,
  );
});

test("settles a closed field whose complete write set is non-thenable", () => {
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
const holder = Holder.create(undefined);
holder.result = Result.create(42);
async function value(): Promise<Result | undefined> {
  return holder.result;
}
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("preserves a field after one hidden thenable write", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
const hiddenThenable = {
  value: 42,
  then(resolve: (value: Result) => void): void { resolve({ value: 43 }); },
};
const holder = Holder.create(undefined);
holder.result = hiddenThenable;
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

test("preserves a field when its owner crosses a provider boundary", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function expose(value: unknown): void;
const holder = Holder.create({ value: 42 });
expose(holder);
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

test("preserves a field after its owner widens before escape", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function expose(value: unknown): void;
const holder = Holder.create({ value: 42 });
const escaped: unknown = holder;
expose(escaped);
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

test("preserves a field when its owner enters a structural carrier", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function expose(value: unknown): void;
const holder = Holder.create({ value: 42 });
const carrier = { holder };
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

test("preserves a field after an assertion erases its owner", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
const holder = Holder.create({ value: 42 });
const erased = holder as unknown;
void erased;
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

test("propagates a provider escape through nominal owner containment", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
class Outer {
  declare private readonly brand: void;
  private constructor(public holder: Holder) {}
  static create(holder: Holder): Outer {
    return new Outer(holder);
  }
}
declare function expose(value: unknown): void;
const holder = Holder.create({ value: 42 });
const outer = Outer.create(holder);
expose(outer);
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

test("preserves a field when its factory callable escapes", () => {
  const fixture = checkedEffectFixture(`
interface Result { readonly value: number }
class Holder {
  declare private readonly brand: void;
  private constructor(public result: Result | undefined) {}
  static create(result: Result | undefined): Holder {
    return new Holder(result);
  }
}
declare function invoke(factory: (value: Result) => Holder): Holder;
const holder = invoke(Holder.create);
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

test("keeps closed field proof linear across independent instances", () => {
  const measure = (count: number): number => {
    const instances = Array.from({ length: count }, (_, index) =>
      `const holder${index} = Holder.create(Result.create(${index}));\n` +
      `async function value${index}(): Promise<Result | undefined> { ` +
      `return holder${index}.result; }`
    ).join("\n");
    const values = Array.from(
      { length: count },
      (_, index) => `await value${index}()`,
    ).join(", ");
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
${instances}
export const results = [${values}];
`);
    let semanticQueries = 0;
    const source = Object.freeze({
      ...fixture.source,
      semantics: Object.freeze({
        ...fixture.source.semantics,
        forNode(node: Parameters<typeof fixture.source.semantics.forNode>[0]) {
          semanticQueries += 1;
          return fixture.source.semantics.forNode(node);
        },
      }),
    });
    const plan = createClosedCooperativeEffectPlan(source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();
    assert.equal(result.callableCount, count);
    assert.equal(result.awaitCount, count);
    return semanticQueries;
  };

  const smaller = measure(8);
  const larger = measure(16);
  assert.ok(
    larger <= smaller * 2.25,
    `expected linear storage queries, got ${smaller} then ${larger}`,
  );
});

test("keeps direct return-flow proof linear across shared producer tails", () => {
  const measure = (count: number): number => {
    const producers = Array.from({ length: count }, (_, index) =>
      index + 1 === count
        ? `function produce${index}(): unknown { return new Result(42); }`
        : `function produce${index}(): unknown { return produce${index + 1}(); }`
    ).join("\n");
    const wrappers = Array.from({ length: count }, (_, index) =>
      `async function value${index}(): Promise<unknown> { return produce${index}(); }`
    ).join("\n");
    const results = Array.from(
      { length: count },
      (_, index) => `await value${index}()`,
    ).join(", ");
    const fixture = checkedEffectFixture(`
class Result { constructor(readonly value: number) {} }
${producers}
${wrappers}
export const results = [${results}];
`);
    let semanticQueries = 0;
    const source = Object.freeze({
      ...fixture.source,
      semantics: Object.freeze({
        ...fixture.source.semantics,
        forNode(node: Parameters<typeof fixture.source.semantics.forNode>[0]) {
          semanticQueries += 1;
          return fixture.source.semantics.forNode(node);
        },
      }),
    });
    const plan = createClosedCooperativeEffectPlan(source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();
    assert.equal(result.callableCount, count);
    assert.equal(result.awaitCount, count);
    return semanticQueries;
  };

  const smaller = measure(16);
  const larger = measure(32);
  assert.ok(
    larger <= smaller * 2.25,
    `expected linear semantic queries, got ${smaller} then ${larger}`,
  );
});
