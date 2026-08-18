import assert from "node:assert/strict";
import { test } from "node:test";
import { AsTypeReferenceNode } from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { collectCallableStorageInputs } from "../storage/inputs.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

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
  const selectedCallable: (() => Awaitable<number>) | undefined = await choose(selected);
  return await selectedCallable!();
}
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);

  assert.equal(result.callableCount, 4);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(countNamedTypeReferences(
    fixture.source,
    result.sourceFile,
    "Awaitable",
  ), 0);
});

test("rewrites a synchronous producer contract with its returned callable", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

function produce(): (() => Awaitable<number>) | undefined {
  return (): number => 40;
}

async function invoke(): Promise<number> {
  const selected: (() => Awaitable<number>) | undefined = produce();
  return await selected!();
}
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(countNamedTypeReferences(
    fixture.source,
    result.sourceFile,
    "Awaitable",
  ), 0);
});

test("settles a generic callable factory through a concrete wrapper and field", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;

function memoizeKernel<T>(
  copy: (value: T) => T,
  zero: () => T,
  create: (() => Awaitable<T>) | undefined,
): (() => Awaitable<T>) | undefined {
  let value = zero();
  return async (): Promise<T> => {
    if (create !== undefined) {
      value = copy(await create());
      create = undefined;
    }
    return copy(value);
  };
}

function memoizeNumber(
  create: (() => Awaitable<number>) | undefined,
): (() => Awaitable<number>) | undefined {
  return memoizeKernel((value) => value, () => 0, create);
}

class Checker {
  declare private readonly then?: never;
  public constructor(
    public callback: (() => Awaitable<number>) | undefined,
  ) {}
}

const checker = new Checker(undefined);
checker.callback = memoizeNumber(async (): Promise<number> => 42);

async function invoke(): Promise<number> {
  return await checker.callback!();
}

export const result = await invoke();
`);

  const storage = collectCallableStorageInputs(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    new Set(),
  );
  assert.deepEqual(
    [...storage.closed].map((node) => fixture.source.ast.text(
      fixture.source.ast.name(node),
    )),
    ["copy", "zero", "create", "create", "callback"],
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.deepEqual(plan.summary.fallbackReasons, []);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(countNamedTypeReferences(
    fixture.source,
    result.sourceFile,
    "Awaitable",
  ), 0);
});

test("retains a shared generic callable factory after one open input", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;

function memoizeKernel<T>(
  copy: (value: T) => T,
  zero: () => T,
  create: (() => Awaitable<T>) | undefined,
): (() => Awaitable<T>) | undefined {
  let value = zero();
  return async (): Promise<T> => {
    if (create !== undefined) {
      value = copy(await create());
      create = undefined;
    }
    return copy(value);
  };
}

const closed = memoizeKernel((value) => value, () => 0, async () => 40);
const open = memoizeKernel(
  (value) => value,
  () => 0,
  async (): Promise<number> => await remote(),
);

async function invoke(): Promise<number> {
  return (await closed!()) + (await open!());
}

export const result = await invoke();
`);

  const originalAsyncCallables = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsyncCallables,
  );
});

for (const [name, assignment] of [
  ["compound write", "create ??= async () => zero();"],
  ["provider assignment", "create = remote;"],
] as const) {
  test(`retains generic callable flow after ${name}`, () => {
    const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote<T>(): Promise<T>;

function memoizeKernel<T>(
  copy: (value: T) => T,
  zero: () => T,
  create: (() => Awaitable<T>) | undefined,
): (() => Awaitable<T>) | undefined {
  let value = zero();
  return async (): Promise<T> => {
    if (create !== undefined) {
      value = copy(await create());
      ${assignment}
    }
    return copy(value);
  };
}

const callback = memoizeKernel((value) => value, () => 0, async () => 42);

async function invoke(): Promise<number> {
  return await callback!();
}

export const result = await invoke();
`);

    const originalAsyncCallables = countAsyncCallables(
      fixture.source,
      fixture.sourceFile,
    );
    const plan = createFixtureEffectPlan(fixture.source);
    const result = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();

    assert.equal(result.callableCount, 0);
    assert.equal(
      countAsyncCallables(fixture.source, result.sourceFile),
      originalAsyncCallables,
    );
  });
}

test("rewrites an imported exact awaitable parameter with its calls", () => {
  const fixture = checkedEffectFixture(`
import type { Awaitable } from "./runtime.js";

class Host {
  static async invoke(
    callback: ((value: number) => Awaitable<number>) | undefined,
  ): Promise<number> {
    const selected = callback;
    const result: number = await selected!(40);
    return result + 1;
  }
}

export const result = await Host.invoke((value): number => value);
`, {
    "/src/runtime.d.ts": `
export type Awaitable<T> = T | Promise<T>;
`,
  });

  const plan = createFixtureEffectPlan(fixture.source);
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    2,
  );
  assert.equal(
    results.reduce((total, result) =>
      total + countNodes(
        fixture.source,
        result.sourceFile,
        (node) => {
          const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
          return reference !== undefined &&
            fixture.source.ast.text(reference.TypeName) === "Awaitable";
        },
      ), 0),
    0,
  );
});

test("retains an indirect await whose Promise-only contract cannot narrow", () => {
  const fixture = checkedEffectFixture(`
type PromiseOnly<T> = Promise<T>;

async function invoke(
  callback: ((value: number) => PromiseOnly<number>) | undefined,
): Promise<number> {
  return await callback!(40);
}

export const result = await invoke(async (value): Promise<number> => value);
`);

  const originalAsyncCallables = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const originalAwaits = countNodes(
    fixture.source,
    fixture.sourceFile,
    fixture.source.ast.is.IsAwaitExpression,
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsyncCallables,
  );
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      fixture.source.ast.is.IsAwaitExpression,
    ),
    originalAwaits,
  );
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

function countNamedTypeReferences(
  source: ReturnType<typeof checkedEffectFixture>["source"],
  root: ReturnType<typeof checkedEffectFixture>["sourceFile"],
  name: string,
): number {
  return countNodes(source, root, (node) =>
    source.ast.is.IsTypeReferenceNode(node) &&
    source.ast.text(AsTypeReferenceNode(node)?.TypeName) === name
  );
}
