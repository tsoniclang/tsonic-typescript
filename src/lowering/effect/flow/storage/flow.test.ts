import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  countAsyncCallables,
  countNodes,
  checkedEffectFixture,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { collectCallableStorageInputs } from "./inputs.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a closed callable storage field through an exact factory", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
  static zero(): Slot { return Slot.make(undefined); }
  static copy(source: Slot): Slot { return Slot.make(source.value); }
}
async function base(): Promise<number> { return 40; }
const slot = Slot.zero();
slot.value = async (): Promise<number> => (await base()) + 1;
export async function invoke(): Promise<number> { return (await slot.value!()) + 1; }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      fixture.source.ast.is.IsAwaitExpression,
    ),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, (node) => {
      const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
      return reference !== undefined &&
        fixture.source.ast.text(reference.TypeName) === "Awaitable";
    }),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, (node) => {
      const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
      return reference !== undefined &&
        fixture.source.ast.text(reference.TypeName) === "Promise";
    }),
    0,
  );
});

test("settles a callback parameter beside an independently bound rest slot", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
async function base(): Promise<number> { return 40; }
async function invoke(
  callback: () => Awaitable<number>,
  ...labels: string[]
): Promise<number> {
  return (await callback()) + labels.length;
}
export const result = await invoke(
  async (): Promise<number> => (await base()) + 1,
  "one",
);
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 3);
  assert.equal(result.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a closed callable field through an exact location", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Location<T> { constructor(public value: T) {} }
class Slot {
  private constructor(public callback: (() => Awaitable<number>) | undefined) {}
  static make(callback: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(callback);
  }
  static zero(): Slot { return Slot.make(undefined); }
  static copy(source: Slot): Slot { return Slot.make(source.callback); }
}
const slot = new Location(Slot.zero());
slot.value.callback = async (): Promise<number> => 41;
export async function invoke(): Promise<number> {
  let callback: (() => Awaitable<number>) | undefined = slot.value.callback;
  return (await callback!()) + 1;
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a closed callable field across checked source files", () => {
  const fixture = checkedEffectFixture(`
import { type Awaitable, Location, Slot } from "./slot.js";
const slot = new Location(Slot.zero());
slot.value.callback = async (): Promise<number> => 41;
export async function invoke(): Promise<number> {
  let callback: (() => Awaitable<number>) | undefined = slot.value.callback;
  return (await callback!()) + 1;
}
export const result = await invoke();
`, {
    "/src/slot.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export class Location<T> { constructor(public value: T) {} }
export class Slot {
  private constructor(public callback: (() => Awaitable<number>) | undefined) {}
  static make(callback: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(callback);
  }
  static zero(): Slot { return Slot.make(undefined); }
  static copy(source: Slot): Slot { return Slot.make(source.callback); }
}
`,
  });

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
    )).sort(),
    ["callback", "callback", "callback"],
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    2,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    2,
  );
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("settles a closed singleton callable field", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class State {
  declare callback: (() => Awaitable<number>) | undefined;
  count = 0;
}
export const state = new State();
state.callback = undefined;
state.callback = async (): Promise<number> => 41;
export async function invoke(): Promise<number> {
  return (await state.callback!()) + state.count + 1;
}
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles an imported closed singleton callable field", () => {
  const fixture = checkedEffectFixture(`
import { state } from "./state.js";
state.callback = undefined;
state.callback = async (): Promise<number> => 41;
export async function invoke(): Promise<number> {
  return (await state.callback!()) + 1;
}
export const result = await invoke();
`, {
    "/src/state.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
class State {
  declare callback: (() => Awaitable<number>) | undefined;
}
export const state = new State();
`,
  });

  const plan = createFixtureEffectPlan(fixture.source);
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    2,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    2,
  );
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("settles a forwarded package-state callable through a staged local", () => {
  const fixture = checkedEffectFixture(`
import { state } from "./package.js";
import type { GoError } from "./state.js";
export async function invoke(): Promise<GoError | undefined> {
  const callee = state.callback;
  return await callee!(undefined, undefined);
}
export const result = await invoke();
`, {
    "/src/state.ts": `
export type Awaitable<T> = T | Promise<T>;
export abstract class GoInterfaceValue {
  declare private readonly then?: never;
}
export interface GoError extends GoInterfaceValue {
  Error(): Awaitable<string>;
}
export class PackageState {
  declare callback: ((value: object | undefined, failure: GoError | undefined) => Awaitable<GoError | undefined>) | undefined;
  declare count: number;
  declare private readonly then?: never;
}
export const state = new PackageState();
`,
    "/src/package.ts": `
import { state } from "./state.js";
export function initialize(): void {
  state.callback = undefined;
  state.count = 0;
}
initialize();
export { state };
`,
  });

  const storage = collectCallableStorageInputs(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    new Set(),
  );
  const closedNames = [...storage.closed].map((node) => fixture.source.ast.text(
    fixture.source.ast.name(node),
  ));
  assert.ok(closedNames.includes("callback"));
  assert.ok(closedNames.includes("callee"));
  const plan = createFixtureEffectPlan(fixture.source);
  const results = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    results.reduce((total, result) => total + result.callableCount, 0),
    1,
  );
  assert.equal(
    results.reduce((total, result) => total + result.awaitCount, 0),
    2,
  );
  assert.equal(
    results.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
});

test("keeps a singleton callable field canonical when its instance escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function expose(value: object): void;
class State {
  declare callback: (() => Awaitable<number>) | undefined;
}
export const state = new State();
state.callback = async (): Promise<number> => 42;
expose(state);
async function invoke(): Promise<number> { return await state.callback!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("settles a callable field across every exact project construction", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class State {
  declare callback: (() => Awaitable<number>) | undefined;
}
export const state = new State();
const other = new State();
state.callback = async (): Promise<number> => 42;
other.callback = state.callback;
async function invoke(): Promise<number> { return await state.callback!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles a closed callable field through a mutable local", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
  static zero(): Slot { return Slot.make(undefined); }
}
const slot = Slot.zero();
slot.value = async (): Promise<number> => 41;
export async function invoke(selected: boolean): Promise<number> {
  let callback: (() => Awaitable<number>) | undefined = slot.value;
  if (selected) callback = slot.value;
  return (await callback!()) + 1;
}
export const result = await invoke(true);
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 2);
  assert.equal(result.awaitCount, 2);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
  assert.equal(
    countNodes(
      fixture.source,
      result.sourceFile,
      fixture.source.ast.is.IsAwaitExpression,
    ),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, (node) => {
      const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
      return reference !== undefined &&
        fixture.source.ast.text(reference.TypeName) === "Awaitable";
    }),
    0,
  );
  assert.equal(
    countNodes(fixture.source, result.sourceFile, (node) => {
      const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
      return reference !== undefined &&
        fixture.source.ast.text(reference.TypeName) === "Promise";
    }),
    0,
  );
});

test("keeps a mutable callable local canonical when it escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function expose(value: (() => Awaitable<number>) | undefined): void;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static zero(): Slot { return new Slot(undefined); }
}
const slot = Slot.zero();
slot.value = async (): Promise<number> => 42;
let callback: (() => Awaitable<number>) | undefined = slot.value;
expose(callback);
async function invoke(): Promise<number> { return await callback!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps a callable field open when its factory value is aliased", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const factory = Slot.make;
const slot = factory(async (): Promise<number> => 42);
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps a callable field open when its value escapes", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function expose(value: () => Awaitable<number>): void;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const slot = Slot.make(async (): Promise<number> => 42);
expose(slot.value!);
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("does not narrow a promise-only callable field", () => {
  const fixture = checkedEffectFixture(`
class Slot {
  private constructor(public value: (() => Promise<number>) | undefined) {}
  static make(value: (() => Promise<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const slot = Slot.make(async (): Promise<number> => 42);
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("keeps a suspending producer and its field caller canonical", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static make(value: (() => Awaitable<number>) | undefined): Slot {
    return new Slot(value);
  }
}
const slot = Slot.make(async (): Promise<number> => await remote());
async function invoke(): Promise<number> { return await slot.value!(); }
export const result = await invoke();
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 2);
});

test("indexes callable parameter uses with bounded whole-program traversals", () => {
  const families = Array.from({ length: 32 }, (_, index) => `
class Slot${index} {
  private constructor(public value: (() => number | PromiseLike<number>) | undefined) {}
  static make(value: (() => number | PromiseLike<number>) | undefined): Slot${index} {
    return new Slot${index}(value);
  }
}
const slot${index} = Slot${index}.make(() => ${index});
const result${index} = slot${index}.value!();
`).join("\n");
  const fixture = checkedEffectFixture(families);
  const nodeCount = countNodes(
    fixture.source,
    fixture.sourceFile,
    () => true,
  );
  let childQueries = 0;
  const source = Object.freeze({
    ...fixture.source,
    ast: Object.freeze({
      ...fixture.source.ast,
      children(node: Node | undefined) {
        childQueries += 1;
        return fixture.source.ast.children(node);
      },
    }),
  });

  collectCallableStorageInputs(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: false,
      memberDispatch: true,
    }),
    new Set(),
  );

  assert.ok(
    childQueries < nodeCount * 8,
    `expected bounded traversals, got ${childQueries} child queries for ${nodeCount} nodes`,
  );
});
