import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IsAwaitExpression,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import { typeHasDefinitelyNonThenableContract } from "../../../thenability.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a generic result with an independent nominal then exclusion", () => {
  const fixture = checkedEffectFixture(`
class RuntimeSlice<T> {
  declare private readonly then?: never;
  constructor(readonly value: T) {}
  read(): T { return this.value; }
}
async function select<T>(
  values: RuntimeSlice<T>,
  selected: boolean,
): Promise<RuntimeSlice<T> | undefined> {
  values.read();
  return selected ? values : undefined;
}
export const result = await select(new RuntimeSlice(42), true);
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

test("settles a direct generic nominal result", () => {
  const fixture = checkedEffectFixture(`
class RuntimeSlice<T> {
  declare private readonly then?: never;
  constructor(readonly value: T) {}
}
async function select<T>(value: RuntimeSlice<T>): Promise<RuntimeSlice<T>> {
  return value;
}
export const result = await select(new RuntimeSlice(42));
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

test("settles an inherited generic nominal then exclusion", () => {
  const fixture = checkedEffectFixture(`
class NonThenable<T> {
  declare private readonly then?: never;
  constructor(readonly value: T) {}
}
class Derived<T> extends NonThenable<T> {}
async function select<T>(value: T): Promise<Derived<T>> {
  return new Derived(value);
}
export const result = await select(42);
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

test("settles a bare generic result from complete non-thenable call inputs", () => {
  const fixture = checkedEffectFixture(`
async function select<T>(value: T): Promise<T> { return value; }
export const result = await select(42);
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

test("retains a generic result with one open exported call surface", () => {
  const fixture = checkedEffectFixture(`
export async function select<T>(value: T): Promise<T> { return value; }
export const result = await select(42);
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("retains an exported generic arrow call surface", () => {
  const fixture = checkedEffectFixture(`
export const select = async <T>(value: T): Promise<T> => value;
export const result = await select(42);
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("retains an exported generic method call surface", () => {
  const fixture = checkedEffectFixture(`
export class Selector {
  async select<T>(value: T): Promise<T> { return value; }
}
const selector = new Selector();
export const result = await selector.select(42);
`);

  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("rejects a nominal then exclusion whose contract depends on T", () => {
  const fixture = checkedEffectFixture(`
class GenericThen<T> {
  declare private readonly then?: T;
  constructor(readonly value: number) {}
}
const value = new GenericThen<() => void>(42);
`);

  const declaration = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
    declarationReferences: true,
  }).nodesOfKind(KindVariableDeclaration).find((node) =>
    fixture.source.ast.text(fixture.source.ast.name(node)) === "value"
  );
  assert.ok(declaration !== undefined);
  const name = fixture.source.ast.name(declaration);
  assert.ok(name !== undefined);
  const semantics = fixture.source.semantics.forNode(name);
  const type = semantics.getTypeAtLocation(name);
  assert.ok(type !== undefined);
  assert.equal(
    typeHasDefinitelyNonThenableContract(fixture.source, semantics, type),
    false,
  );
});

test("retains a generic result with only a structural then exclusion", () => {
  const fixture = checkedEffectFixture(`
class Structural<T> {
  declare readonly then?: never;
  constructor(readonly value: T) {}
}
async function select<T>(value: T): Promise<Structural<T>> {
  return new Structural(value);
}
export const result = await select(42);
`);

  const originalAsync = countAsyncCallables(
    fixture.source,
    fixture.sourceFile,
  );
  const plan = createFixtureEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(
    countAsyncCallables(fixture.source, result.sourceFile),
    originalAsync,
  );
});
