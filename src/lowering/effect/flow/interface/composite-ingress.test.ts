import assert from "node:assert/strict";
import { test } from "node:test";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { createInterfaceContractGraph } from "./graph.js";
import { assertNoInterfaceBoundaryCauses } from "./boundary.test-support.js";

const prelude = `
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
`;

for (const [name, sourceText] of [
  [
    "conditional branches",
    `const selected: Reader = true ? new Pair() : new Pair();
export const result = await read(selected);`,
  ],
  [
    "logical branches",
    `const selected: Reader =
  (Math.random() > 0.5 && new Pair()) || new Pair();
export const result = await read(selected);`,
  ],
  [
    "nullish branches",
    `function maybePair(): Pair | undefined {
  return Math.random() > 0.5 ? new Pair() : undefined;
}
const selected: Reader = maybePair() ?? new Pair();
export const result = await read(selected);`,
  ],
  [
    "comma results",
    `export const result = await read((Math.random(), new Pair()));`,
  ],
  [
    "simple assignment results",
    `let selected: Reader = new Pair();
export const result = await read(selected = new Pair());`,
  ],
  [
    "an object member",
    `const holder: { readonly reader: Reader } = { reader: new Pair() };
export const result = await read(holder.reader);`,
  ],
  [
    "an object shorthand member",
    `const reader = new Pair();
const holder: { readonly reader: Reader } = { reader };
export const result = await read(holder.reader);`,
  ],
  [
    "an array element",
    `const readers: readonly Reader[] = [new Pair()];
export const result = await read(readers[0]!);`,
  ],
  [
    "an object spread",
    `const base = { reader: new Pair() };
const holder: { readonly reader: Reader } = { ...base };
export const result = await read(holder.reader);`,
  ],
] as const) {
  test(`settles exact interface origins through ${name}`, () => {
    const fixture = checkedEffectFixture(`${prelude}\n${sourceText}`);
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
}

test("retains an ambient conditional origin", () => {
  const fixture = checkedEffectFixture(`${prelude}
declare const external: Reader;
const selected: Reader = true ? new Pair() : external;
export const result = await read(selected);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
    cause.reason === "unproven-value-origin"
  ));
});

test("retains an object-spread origin with an opaque sibling use", () => {
  const fixture = checkedEffectFixture(`${prelude}
declare function escape(value: { readonly reader: Reader }): void;
const base = { reader: new Pair() };
escape(base);
const holder: { readonly reader: Reader } = { ...base };
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
  assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
    cause.reason === "unproven-value-origin"
  ));
});

for (const [name, sourceText] of [
  [
    "object member",
    `declare const external: Reader;
const holder: { readonly reader: Reader } = { reader: external };
export const result = await read(holder.reader);`,
  ],
  [
    "array element",
    `declare const external: Reader;
const readers: readonly Reader[] = [external];
export const result = await read(readers[0]!);`,
  ],
  [
    "object spread",
    `declare const external: { readonly reader: Reader };
const holder: { readonly reader: Reader } = { ...external };
export const result = await read(holder.reader);`,
  ],
] as const) {
  test(`retains an ambient ${name} origin`, () => {
    const fixture = checkedEffectFixture(`${prelude}\n${sourceText}`);
    const graph = createInterfaceContractGraph(
      fixture.source,
      createTargetProgramIndex(fixture.source, {
        bindingWrites: false,
        memberDispatch: false,
      }),
    );
    assert.equal(graph.components.length, 1);
    assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
      cause.reason === "unproven-value-origin"
    ));
  });
}
