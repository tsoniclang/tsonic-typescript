import assert from "node:assert/strict";
import { test } from "node:test";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { createInterfaceContractGraph } from "./graph.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("records one checker-proven implicit interface ingress exactly", () => {
  const sourceText = `
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class StructuralReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new StructuralReader());
`;
  const fixture = checkedEffectFixture(sourceText);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.consideredFamilyCount, 1);
  assert.equal(evidence.admittedFamilyCount, 1);
  assert.equal(evidence.rejectedFamilyCount, 0);
  assert.equal(evidence.settledFamilyCount, 1);
  assert.equal(evidence.retainedFamilyCount, 0);
  assert.equal(evidence.settledCallCount, 1);
  assert.equal(evidence.implementationCount, 1);
  assert.deepEqual(evidence.retainedFamilies, []);
});

test("retains mutable interface storage after one ambient write", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare const external: Reader;
let reader: Reader | undefined = undefined;
reader = new Pair();
reader = external;
async function read(): Promise<number> {
  return await reader!.Read();
}
export const result = await read();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.retainedFamilyCount, 1);
  assert.deepEqual(
    evidence.retainedFamilies[0]?.boundaryCauses.map((cause) => cause.reason),
    ["unproven-value-origin", "open-interface-receiver"],
  );
});

for (const [name, sourceText] of [
  [
    "an opaque result",
    `
declare function create(): Reader;
export const result = await read(create());
`,
  ],
  [
    "a refined argument",
    `
declare const external: object;
declare function isReader(value: object): value is Reader;
let result = 0;
if (isReader(external)) {
  result = await read(external);
}
export { result };
`,
  ],
  [
    "an ambient property",
    `
declare const holder: { readonly reader: Reader };
export const result = await read(holder.reader);
`,
  ],
  [
    "an ambient element",
    `
declare const readers: readonly Reader[];
export const result = await read(readers[0]!);
`,
  ],
  [
    "an inferred ambient alias",
    `
declare const external: Reader;
const alias = external;
export const result = await read(alias);
`,
  ],
  [
    "a project result sourced from ambient storage",
    `
declare const external: Reader;
function create(): Reader { return external; }
export const result = await read(create());
`,
  ],
  [
    "an inferred project result sourced from ambient storage",
    `
declare const external: Reader;
function create() { return external; }
export const result = await read(create());
`,
  ],
  [
    "an inferred project arrow result sourced from ambient storage",
    `
declare const external: Reader;
const create = () => external;
export const result = await read(create());
`,
  ],
  [
    "a project property initialized through ambient construction",
    `
declare const external: Reader;
class Holder {
  constructor(public readonly reader: Reader) {}
}
const holder = new Holder(external);
export const result = await read(holder.reader);
`,
  ],
] as const) {
  test(`retains interface ingress from ${name}`, () => {
    const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
${sourceText}
`);
    const graph = createInterfaceContractGraph(
      fixture.source,
      createTargetProgramIndex(fixture.source, {
        bindingWrites: false,
        memberDispatch: false,
      }),
    );
    assert.equal(graph.components.length, 1);
    assert.equal(graph.components[0]?.boundary, true);

    const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
    lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();
    const evidence = plan.summary.interfaceDispatch;
    assert.equal(evidence.analyzed, true);
    if (!evidence.analyzed) {
      throw new Error("declared interface dispatch was not analyzed");
    }
    assert.equal(evidence.settledFamilyCount, 0);
  });
}

test("settles interface storage rooted in an exact project object", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
class Holder {
  constructor(public readonly reader: Reader) {}
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
const holder = new Holder(new Pair());
export const result = await read(holder.reader);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

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
});

test("settles an inferred project result", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
function create() { return new Pair(); }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(create());
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("settles an exact awaited project result", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
async function create(): Promise<Reader> { return new Pair(); }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(await create());
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 1);
});

test("retains an awaited ambient interface result", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare function create(): Promise<Reader>;
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(await create());
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, true);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 1);
});

test("settles an exact project property rooted at this", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
class Holder {
  constructor(public readonly reader: Reader) {}
  async Read(): Promise<number> { return await this.reader.Read(); }
}
export const result = await new Holder(new Pair()).Read();
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("settles an exact project class value entering an interface", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Factory { Create(): Awaitable<number>; }
class PairFactory {
  static async Create(): Promise<number> { return 42; }
}
async function create(factory: Factory): Promise<number> {
  return await factory.Create();
}
export const result = await create(PairFactory);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});
