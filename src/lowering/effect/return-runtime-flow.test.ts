import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan as createClosedCooperativeEffectPlan,
} from "./effect.test-support.js";
import { lowerCooperativeEffects } from "./transform.js";

const runtimeDeclaration = `
export interface Location<T> {
  readonly storageIdentity: object;
  value: T;
}
export declare function propertyLocation<T extends object, K extends keyof T>(
  object: T,
  key: K,
): Location<T[K]>;
export declare function uncertifiedLocation(): Location<number>;
`;

const runtimeFiles = {
  "/src/node_modules/@tsonic/typescript-runtime/package.json": JSON.stringify({
    name: "@tsonic/typescript-runtime",
    version: "0.0.1",
    type: "module",
    types: "./index.d.ts",
  }),
  "/src/node_modules/@tsonic/typescript-runtime/index.d.ts": runtimeDeclaration,
};

test("settles an exact namespace-imported target-runtime location result", () => {
  const fixture = checkedEffectFixture(`
import * as runtime from "@tsonic/typescript-runtime";
const storage = { value: 42 };
function location() { return runtime.propertyLocation(storage, "value"); }
async function value(): Promise<runtime.Location<number>> { return location(); }
export const result = await value();
`, runtimeFiles);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles an aliased named target-runtime location result", () => {
  const fixture = checkedEffectFixture(`
import { propertyLocation as locate, type Location } from "@tsonic/typescript-runtime";
const storage = { value: 42 };
function location() { return locate(storage, "value"); }
async function value(): Promise<Location<number>> { return location(); }
export const result = await value();
`, runtimeFiles);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 1);
  assert.equal(result.awaitCount, 1);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 0);
});

test("settles an adapter return through an exact project helper", () => {
  const fixture = checkedEffectFixture(`
import * as runtime from "@tsonic/typescript-runtime";
import { NodeDefault } from "./node.js";
class Adapter {
  constructor(
    readonly value: runtime.Location<{ Default: { Node: number } }>,
  ) {}
  async AsNode(): Promise<runtime.Location<number> | undefined> {
    return NodeDefault.AsNode(
      runtime.propertyLocation(this.value.value, "Default"),
    );
  }
}
export const result = await new Adapter({
  storageIdentity: {},
  value: { Default: { Node: 42 } },
}).AsNode();
`, {
    ...runtimeFiles,
    "/src/node.ts": `
import * as runtime from "@tsonic/typescript-runtime";
export class NodeDefault {
  static AsNode(
    node: runtime.Location<{ Node: number }> | undefined,
  ): runtime.Location<number> | undefined {
    return node === undefined
      ? undefined
      : runtime.propertyLocation(node.value, "Node");
  }
}
`,
  });

  const plan = createClosedCooperativeEffectPlan(fixture.source);
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
    1,
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

test("does not classify a same-spelled local location constructor", () => {
  const fixture = checkedEffectFixture(`
interface Location<T> { value: T }
const hidden = {
  value: 42,
  then(resolve: (value: Location<number>) => void): void {
    resolve({ value: 43 });
  },
};
function propertyLocation(): Location<number> { return hidden; }
async function value(): Promise<Location<number>> { return propertyLocation(); }
export const result = await value();
`);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("does not classify an uncertified export from the selected runtime", () => {
  const fixture = checkedEffectFixture(`
import { uncertifiedLocation, type Location } from "@tsonic/typescript-runtime";
async function value(): Promise<Location<number>> {
  return uncertifiedLocation();
}
export const result = await value();
`, runtimeFiles);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("does not classify a same-exported operation from another package", () => {
  const fixture = checkedEffectFixture(`
import { propertyLocation, type Location } from "lookalike-runtime";
async function value(): Promise<Location<number>> { return propertyLocation(); }
export const result = await value();
`, {
    "/src/node_modules/lookalike-runtime/package.json": JSON.stringify({
      name: "lookalike-runtime",
      version: "1.0.0",
      type: "module",
      types: "./index.d.ts",
    }),
    "/src/node_modules/lookalike-runtime/index.d.ts": `
export interface Location<T> { value: T }
export declare function propertyLocation(): Location<number>;
`,
  });

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});

test("preserves a runtime operation whose checked result is thenable", () => {
  const fixture = checkedEffectFixture(`
import * as runtime from "@tsonic/typescript-runtime";
const storage = { value: Promise.resolve(42) };
async function value(): Promise<number> {
  return runtime.propertyLocation(storage, "value").value;
}
export const result = await value();
`, runtimeFiles);

  const plan = createClosedCooperativeEffectPlan(fixture.source);
  const result = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(result.callableCount, 0);
  assert.equal(result.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, result.sourceFile), 1);
});
