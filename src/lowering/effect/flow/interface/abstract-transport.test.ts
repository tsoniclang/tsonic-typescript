import assert from "node:assert/strict";
import { test } from "node:test";

import { KindCallExpression } from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { createInterfaceContractGraph } from "./graph.js";

const closedCarrierSource = `
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class ImmediateReader {
  async Read(): Promise<number> { return 42; }
}
abstract class Carrier<T> {
  declare private readonly then?: never;
  abstract replace(value: T): void;
  abstract current(): T;
}
class DirectCarrier<T> extends Carrier<T> {
  constructor(private value: T) { super(); }
  replace(value: T): void { this.value = value; }
  current(): T { return this.value; }
}
const carrier: Carrier<Reader> = new DirectCarrier<Reader>(
  new ImmediateReader(),
);
carrier.replace(new ImmediateReader());
async function read(): Promise<number> {
  return await carrier.current().Read();
}
export const result = await read();
`;

test("settles values transported through closed abstract project dispatch", () => {
  const fixture = checkedEffectFixture(closedCarrierSource);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  const graph = createInterfaceContractGraph(fixture.source, program);
  const transportedCalls = program.nodesOfKind(KindCallExpression).filter(
    (call) => graph.invocationTransports?.transportFor(call) !== undefined,
  );

  assert.equal(transportedCalls.length, 2);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("retains abstract dispatch whose implementation returns ambient ingress", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
declare const externalReader: Reader;
abstract class Carrier<T> {
  declare private readonly then?: never;
  abstract current(): T;
}
class AmbientCarrier extends Carrier<Reader> {
  current(): Reader { return externalReader; }
}
const carrier: Carrier<Reader> = new AmbientCarrier();
async function read(): Promise<number> {
  return await carrier.current().Read();
}
export const result = await read();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, rewritten.sourceFile) > 0);
});

test("retains an abstract receiver supplied by an ambient source", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
abstract class Carrier<T> {
  declare private readonly then?: never;
  abstract current(): T;
}
declare function externalCarrier(): Carrier<Reader>;
async function read(): Promise<number> {
  return await externalCarrier().current().Read();
}
export const result = await read();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, rewritten.sourceFile) > 0);
});

test("retains abstract dispatch with a bodyless project implementation", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
abstract class Carrier<T> {
  declare private readonly then?: never;
  abstract current(): T;
}
class BodylessCarrier extends Carrier<Reader> {
  declare current: () => Reader;
}
const carrier: Carrier<Reader> = new BodylessCarrier();
async function read(): Promise<number> {
  return await carrier.current().Read();
}
export const result = await read();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, rewritten.sourceFile) > 0);
});

test("retains abstract dispatch with an unresolved ambient subclass", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
abstract class Carrier<T> {
  declare private readonly then?: never;
  abstract current(): T;
}
declare class ExternalCarrier extends Carrier<Reader> {
  current(): Reader;
}
declare const carrier: ExternalCarrier;
async function read(): Promise<number> {
  return await carrier.current().Read();
}
export const result = await read();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.ok(countAsyncCallables(fixture.source, rewritten.sourceFile) > 0);
});

test("does not grant transport to an unrelated same-shaped concrete member", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class ImmediateReader {
  async Read(): Promise<number> { return 42; }
}
class SameShape<T> {
  constructor(private value: T) {}
  current(): T { return this.value; }
}
const carrier = new SameShape<Reader>(new ImmediateReader());
async function read(): Promise<number> {
  return await carrier.current().Read();
}
export const result = await read();
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  const graph = createInterfaceContractGraph(fixture.source, program);

  assert.equal(
    program.nodesOfKind(KindCallExpression).filter(
      (call) => graph.invocationTransports?.transportFor(call) !== undefined,
    ).length,
    0,
  );
});
