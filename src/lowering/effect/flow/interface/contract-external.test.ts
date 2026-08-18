import assert from "node:assert/strict";
import { test } from "node:test";

import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { createInterfaceContractGraph } from "./graph.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { assertNoInterfaceBoundaryCauses } from "./boundary.test-support.js";

test("settles an exact declaration-file synchronous interface transport", () => {
  const fixture = checkedEffectFixture(`
import { external } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class LocalReader implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = (await read(external)) + (await read(new LocalReader()));
`, {
    "/node_modules/provider/index.d.ts": `
export interface ExternalReader { Read(): number; }
export declare const external: ExternalReader;
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
  assert.equal(graph.components[0]?.boundary, false);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, rewritten.sourceFile, IsAwaitExpression),
    0,
  );
});

test("retains an external interface that may suspend", () => {
  const fixture = checkedEffectFixture(`
import { external } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class LocalReader implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = (await read(external)) + (await read(new LocalReader()));
`, {
    "/node_modules/provider/index.d.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export interface ExternalReader { Read(): Awaitable<number>; }
export declare const external: ExternalReader;
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
  assert.equal(graph.components[0]?.boundary, true);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, rewritten.sourceFile) > 0);
});

for (const [name, specifier, providerPath, declaration] of [
  [
    "promise-returning overload",
    "provider",
    "/node_modules/provider/index.d.ts",
    `export interface ExternalReader {
      Read(): number;
      Read(selected?: boolean): Promise<number>;
    }
    export declare const external: ExternalReader;`,
  ],
  [
    "implementation-file ambient contract",
    "./provider.js",
    "/src/provider.ts",
    `export interface ExternalReader { Read(): number; }
    export declare const external: ExternalReader;`,
  ],
] as const) {
  test(`retains ${name === "implementation-file ambient contract" ? "an" : "a"} ${name}`, () => {
    const fixture = checkedEffectFixture(`
import { external } from "${specifier}";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class LocalReader implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = (await read(external)) + (await read(new LocalReader()));
`, { [providerPath]: declaration });
    const graph = createInterfaceContractGraph(
      fixture.source,
      createTargetProgramIndex(fixture.source, {
        bindingWrites: false,
        memberDispatch: false,
      }),
    );

    assert.equal(graph.components.length, 1);
    assert.equal(graph.components[0]?.boundary, true);
  });
}

test("retains an unresolved generic external interface result", () => {
  const fixture = checkedEffectFixture(`
import type { ExternalReader } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader<T> { Read(): Awaitable<T>; }
class LocalReader<T> implements GeneratedReader<T> {
  async Read(): Promise<T> { throw new Error("unreachable"); }
}
async function read<T>(external: ExternalReader<T>, local: LocalReader<T>): Promise<T> {
  const selected: GeneratedReader<T> = external;
  void local;
  return await selected.Read();
}
`, {
    "/node_modules/provider/index.d.ts": `
export interface ExternalReader<T> { Read(): T; }
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
  assert.equal(graph.components[0]?.boundary, true);
});

test("settles a concrete synchronous declaration-file result", () => {
  const fixture = checkedEffectFixture(`
import { createReader } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class LocalReader implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = (await read(createReader())) +
  (await read(new LocalReader()));
`, {
    "/node_modules/provider/index.d.ts": `
export declare class RuntimeReader { Read(): number; }
export declare function createReader(): RuntimeReader;
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
  assertNoInterfaceBoundaryCauses(graph.components[0]);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("settles an overloaded synchronous declaration-file result", () => {
  const fixture = checkedEffectFixture(`
import { create } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(create());
`, {
    "/node_modules/provider/index.d.ts": `
export interface ExternalReader {
  Read(): number;
  Read(value?: undefined): number;
}
export declare function create(): ExternalReader;
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
  assertNoInterfaceBoundaryCauses(graph.components[0]);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("retains an overloaded declaration-file result that may suspend", () => {
  const fixture = checkedEffectFixture(`
import { create } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
export const result = await read(create());
`, {
    "/node_modules/provider/index.d.ts": `
export interface ExternalReader {
  Read(): number;
  Read(value?: undefined): Promise<number>;
}
export declare function create(): ExternalReader;
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
  assert.ok(graph.components[0]?.boundaryCauses.length !== 0);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.ok(countAsyncCallables(fixture.source, rewritten.sourceFile) > 0);
});
