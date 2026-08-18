import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  createFixtureEffectPlan,
} from "./effect.test-support.js";
import { createInterfaceContractGraph } from "./interface-contract-graph.js";
import { lowerCooperativeEffects } from "./transform.js";
import { createTargetProgramIndex } from "../program-index.js";

test("joins contracts sharing one declared class implementation", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface FirstReader { Read(): Awaitable<number>; }
interface SecondReader { Read(): Awaitable<number>; }
class Pair implements FirstReader, SecondReader {
  async Read(): Promise<number> { return 42; }
}
async function first(reader: FirstReader): Promise<number> {
  return await reader.Read();
}
async function second(reader: SecondReader): Promise<number> {
  return await reader.Read();
}
export const result = (await first(new Pair())) + (await second(new Pair()));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );

  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.entries.length, 2);
  assert.equal(graph.components[0]?.boundary, false);
});

test("retains only the declared contract whose implementation is external", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare class ExternalBase {
  Remote(): Promise<number>;
}
interface DirectReader { Read(): Awaitable<number>; }
interface RemoteReader { Remote(): Awaitable<number>; }
class Pair extends ExternalBase implements DirectReader, RemoteReader {
  async Read(): Promise<number> { return 42; }
}
async function direct(reader: DirectReader): Promise<number> {
  return await reader.Read();
}
async function remote(reader: RemoteReader): Promise<number> {
  return await reader.Remote();
}
export const result = (await direct(new Pair())) + (await remote(new Pair()));
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );

  assert.deepEqual(
    graph.components.map((component) => ({
      boundary: component.boundary,
      implementationCount: component.entries.reduce(
        (total, entry) => total + entry.implementations.length,
        0,
      ),
    })).sort((left, right) =>
      Number(left.boundary) - Number(right.boundary)
    ),
    [
      { boundary: false, implementationCount: 1 },
      { boundary: true, implementationCount: 0 },
    ],
  );
});

test("retains a declared class contract exposed to an external interface", () => {
  const fixture = checkedEffectFixture(`
import type { ExternalReader } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class Pair implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
declare function consume(reader: ExternalReader): void;
consume(new Pair());
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new Pair());
`, {
    "/node_modules/provider/index.d.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export interface ExternalReader { Read(): Awaitable<number>; }
`,
  });
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );

  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.entries.length, 1);
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
  assert.equal(evidence.rejectedFamilyCount, 1);
});

test("retains contract transport through rest and spread mapping", () => {
  const fixture = checkedEffectFixture(`
import type { ExternalReader } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class Pair implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
declare function consume(...readers: ExternalReader[]): void;
const readers: GeneratedReader[] = [new Pair()];
consume(...readers);
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new Pair());
`, {
    "/node_modules/provider/index.d.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export interface ExternalReader { Read(): Awaitable<number>; }
`,
  });
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );

  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.entries.length, 1);
  assert.equal(graph.components[0]?.boundary, true);
});
