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

test("preserves a shared nested contract through exact project callables", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
type SourceCarrier = (reader: Reader) => Reader;
type TargetCarrier = (reader: Reader) => Reader;
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
function consume(carrier: TargetCarrier): Reader {
  return carrier(new Pair());
}
const carrier: SourceCarrier = (reader) => reader;
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(consume(carrier));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
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

test("pairs direct and awaitable callable result payloads", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
type SourceFactory = () => Promise<Pair>;
type TargetFactory = () => Awaitable<Reader>;
async function create(factory: TargetFactory): Promise<Reader> {
  return await factory();
}
const factory: SourceFactory = async () => new Pair();
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(await create(factory));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 2);
});

test("retains an ambiguous callable result payload", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
type SourceFactory = () => Promise<any>;
type TargetFactory = () => Awaitable<Reader>;
async function create(factory: TargetFactory): Promise<Reader> {
  return await factory();
}
const factory: SourceFactory = async () => new Pair();
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(await create(factory));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, true);
});

test("preserves a shared nested contract through a project overload", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
type Carrier = (reader: Reader) => Reader;
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
function consume(carrier: Carrier): Reader;
function consume(carrier: Carrier): Reader { return carrier(new Pair()); }
const carrier: Carrier = (reader) => reader;
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(consume(carrier));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("retains a shared nested contract at an ambient callable boundary", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
type SourceCarrier = (reader: Reader) => Reader;
type TargetCarrier = (reader: Reader) => Reader;
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare function consume(carrier: TargetCarrier): Reader;
const carrier: SourceCarrier = (reader) => reader;
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(consume(carrier));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
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

test("allows one-way contract erasure through an immediate fresh argument", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare function observe(values: object[]): void;
observe([new Pair()]);
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new Pair());
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
});

test("retains one-way contract erasure from shared mutable storage", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare function observe(values: object[]): void;
const readers: Reader[] = [new Pair()];
observe(readers);
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(readers[0]!);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
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

test("retains a fresh aggregate after it enters erased storage", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare function observe(values: object[]): void;
const erased: object[] = [new Pair()];
observe(erased);
const recovered = erased as Reader[];
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(recovered[0]!);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
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

test("retains a fresh aggregate returned through erased storage", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
declare function identity(values: object[]): object[];
const recovered = identity([new Pair()]) as Reader[];
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(recovered[0]!);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
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

test("preserves an exact project class through a fresh adapter resolver", () => {
  const fixture = checkedEffectFixture(`
import { createAdapter, register } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  declare private readonly brand: void;
  async Read(): Promise<number> { return 42; }
}
const PairAdapter: {
  new (value: Pair): { readonly value: Pair };
  is(value: object): value is { readonly value: Pair };
} = createAdapter<Pair>();
register<Pair>(() => PairAdapter);
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new Pair());
`, {
    "/node_modules/provider/index.d.ts": `
export interface Adapter<T> {
  new (value: T): { readonly value: T };
  is(value: object): value is { readonly value: T };
}
export type AdapterResolver<T> = () => Adapter<T>;
export declare function createAdapter<T>(): Adapter<T>;
export declare function register<T>(resolver: AdapterResolver<T>): void;
`,
  });
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );

  assert.equal(graph.components.length, 1);
  assert.deepEqual(
    graph.components[0]?.boundaryCauses.map((cause) => ({
      reason: cause.reason,
      occurrenceCount: cause.occurrenceCount,
      examples: cause.examples,
    })),
    [],
  );
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("retains an interface supplied to an outbound project callback", () => {
  const fixture = checkedEffectFixture(`
import { observe } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
observe<Reader>(async (reader): Promise<void> => {
  await reader.Read();
});
`, {
    "/node_modules/provider/index.d.ts": `
export declare function observe<T>(
  callback: (reader: T) => void,
): void;
`,
  });
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );

  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, true);
});

test("retains a readable interface value produced by an opaque call", () => {
  const fixture = checkedEffectFixture(`
import { createBox } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
export interface Reader { Read(): Awaitable<number>; }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(createBox<Reader>().value);
`, {
    "/node_modules/provider/index.d.ts": `
export declare function createBox<T>(): {
  readonly value: T;
};
`,
  });
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );

  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.boundary, true);
});
