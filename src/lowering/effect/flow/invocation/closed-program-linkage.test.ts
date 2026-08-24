import assert from "node:assert/strict";
import { test } from "node:test";

import { IsAwaitExpression } from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles an exported callback through exact import and re-export linkage", () => {
  const fixture = linkedCallbackFixture();
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  let asyncCallables = 0;
  let awaits = 0;

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const lowered = lowerCooperativeEffects(sourceFile, plan).sourceFile;
    asyncCallables += countAsyncCallables(fixture.source, lowered);
    awaits += countNodes(fixture.source, lowered, IsAwaitExpression);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(plan.summary.retainedCallableCount, 0);
  assert.equal(asyncCallables, 0);
  assert.equal(awaits, 0);
});

test("retains exported callback linkage under library-safe closure", () => {
  const fixture = linkedCallbackFixture();
  const plan = createFixtureEffectPlan(fixture.source);

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 2);
});

test("retains the same callback when an ambient consumer can invoke it", () => {
  const fixture = checkedEffectFixture(`
import { getText } from "./bridge.js";
declare function install(callback: () => string | PromiseLike<string>): void;
install(getText);
export const result = await getText();
`, callbackFiles);
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.ok(plan.summary.fallbackReasons.some((entry) =>
    entry.reason === "escaping-callable" && entry.retainedCallableCount === 1
  ));
});

test("settles an exported recursive callback stored by an exact constructor", () => {
  const fixture = recursiveVisitorFixture();
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  let asyncCallables = 0;
  let awaits = 0;

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const lowered = lowerCooperativeEffects(sourceFile, plan).sourceFile;
    asyncCallables += countAsyncCallables(fixture.source, lowered);
    awaits += countNodes(fixture.source, lowered, IsAwaitExpression);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(plan.summary.retainedCallableCount, 0);
  assert.equal(asyncCallables, 0);
  assert.equal(awaits, 0);
});

test("retains the recursive export under library-safe closure", () => {
  const fixture = recursiveVisitorFixture();
  const plan = createFixtureEffectPlan(fixture.source);

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 2);
});

test("retains a constructor-stored callback exposed to an ambient consumer", () => {
  const fixture = checkedEffectFixture(`
import { Visitor, visit } from "./visitor.js";
declare function expose(visitor: Visitor<number>): void;
export async function mark(value: number): Promise<boolean> {
  const visitor = new Visitor(mark);
  expose(visitor);
  await visit(value, visitor);
  return false;
}
`, recursiveVisitorFiles);
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 2);
});

test("separates a closed constructor callback from an independently escaped instance", () => {
  const fixture = checkedEffectFixture(`
import { Visitor, visit } from "./visitor.js";
declare function expose(visitor: Visitor<number>): void;
const escaped = new Visitor(async (): Promise<boolean> => true);
expose(escaped);
export async function mark(value: number): Promise<boolean> {
  await visit(value, new Visitor(mark));
  return false;
}
export const result = await mark(1);
`, recursiveVisitorFiles);
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );
  let asyncCallables = 0;
  let awaits = 0;

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    const lowered = lowerCooperativeEffects(sourceFile, plan).sourceFile;
    asyncCallables += countAsyncCallables(fixture.source, lowered);
    awaits += countNodes(fixture.source, lowered, IsAwaitExpression);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 3);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(plan.summary.retainedCallableCount, 1);
  assert.equal(asyncCallables, 1);
  assert.equal(awaits, 0);
});

test("settles an ordinary readonly field through its transparent constructor", () => {
  const fixture = checkedEffectFixture(`
import { Visitor, visit } from "./visitor.js";
export async function mark(value: number): Promise<boolean> {
  await visit(value, new Visitor(mark));
  return false;
}
export const result = await mark(1);
`, ordinaryRecursiveVisitorFiles);
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.candidateCount, 2);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(plan.summary.retainedCallableCount, 0);
});

test("retains a mutable constructor field", () => {
  const fixture = checkedEffectFixture(`
import { Visitor, visit } from "./visitor.js";
export async function mark(value: number): Promise<boolean> {
  await visit(value, new Visitor(mark));
  return false;
}
`, {
    "/src/visitor.ts": ordinaryRecursiveVisitorFiles["/src/visitor.ts"]
      .replace("readonly value", "value"),
  });
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 2);
});

test("retains a constructor slot when construction performs an opaque action", () => {
  const fixture = checkedEffectFixture(`
import { Visitor, visit } from "./visitor.js";
export async function mark(value: number): Promise<boolean> {
  await visit(value, new Visitor(mark));
  return false;
}
`, {
    "/src/visitor.ts": ordinaryRecursiveVisitorFiles["/src/visitor.ts"]
      .replace(
        "this.value = value;",
        "this.value = value;\n    expose(this);",
      )
      .replace(
        "export class Visitor<T> {",
        "declare function expose<T>(visitor: Visitor<T>): void;\nexport class Visitor<T> {",
      ),
  });
  const plan = createFixtureEffectPlan(
    fixture.source,
    "open-structural",
    undefined,
    "closed-program",
  );

  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    lowerCooperativeEffects(sourceFile, plan);
  }
  plan.finish();

  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(plan.summary.retainedCallableCount, 2);
});

const callbackFiles = Object.freeze({
  "/src/bridge.ts": `export { getText } from "./utilities.js";`,
  "/src/utilities.ts": `
export async function getText(): Promise<string> {
  return "value";
}
`,
});

function linkedCallbackFixture() {
  return checkedEffectFixture(`
import { format } from "./format.js";
import { getText } from "./bridge.js";
export const result = await format(getText);
`, {
    ...callbackFiles,
    "/src/format.ts": `
export async function format(
  getText: () => string | PromiseLike<string>,
): Promise<string> {
  return "<" + await getText() + ">";
}
`,
  });
}

const recursiveVisitorFiles = Object.freeze({
  "/src/visitor.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export class Visitor<T> {
  constructor(
    public readonly value: ((value: T) => Awaitable<boolean>) | undefined,
  ) {}
}
function missingCallable(): never {
  throw new Error("missing callable");
}
export async function visit<T>(value: T, visitor: Visitor<T>): Promise<void> {
  const callable = visitor.value;
  await (callable ?? missingCallable())(value);
}
`,
});

const ordinaryRecursiveVisitorFiles = Object.freeze({
  "/src/visitor.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export class Visitor<T> {
  readonly value: ((value: T) => Awaitable<boolean>) | undefined;
  constructor(value: ((value: T) => Awaitable<boolean>) | undefined) {
    this.value = value;
  }
}
function missingCallable(): never {
  throw new Error("missing callable");
}
export async function visit<T>(value: T, visitor: Visitor<T>): Promise<void> {
  const callable = visitor.value;
  await (callable ?? missingCallable())(value);
}
`,
});

function recursiveVisitorFixture() {
  return checkedEffectFixture(`
import { Visitor, visit } from "./visitor.js";
export async function mark(value: number): Promise<boolean> {
  await visit(value, new Visitor(mark));
  return false;
}
export const result = await mark(1);
`, recursiveVisitorFiles);
}
