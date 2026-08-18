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
    "a fresh writable sequence",
    `declare function consume(values: object[]): void;
consume([new Pair()]);`,
  ],
  [
    "a fresh writable property",
    `declare function consume(value: { reader: object }): void;
consume({ reader: new Pair() });`,
  ],
] as const) {
  test(`settles outbound-only opaque exposure through ${name}`, () => {
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
  });
}

for (const [name, sourceText] of [
  [
    "a readonly sequence",
    `declare function inspect(values: readonly object[]): void;
const readers: readonly Reader[] = [new Pair()];
inspect(readers);
export const result = await read(readers[0]!);`,
  ],
  [
    "a readonly property",
    `declare function inspect(value: { readonly reader: object }): void;
const holder: { readonly reader: Reader } = { reader: new Pair() };
inspect(holder);
export const result = await read(holder.reader);`,
  ],
  [
    "a readonly index",
    `declare function inspect(value: { readonly [key: string]: object }): void;
const holder: { readonly [key: string]: Reader } = { reader: new Pair() };
inspect(holder);
export const result = await read(holder.reader!);`,
  ],
] as const) {
  test(`settles one-way opaque exposure through ${name}`, () => {
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

for (const [name, sourceText] of [
  [
    "a writable sequence",
    `declare function mutate(values: object[]): void;
const readers: Reader[] = [new Pair()];
mutate(readers);
export const result = await read(readers[0]!);`,
  ],
  [
    "a writable property",
    `declare function mutate(value: { reader: object }): void;
const holder: { reader: Reader } = { reader: new Pair() };
mutate(holder);
export const result = await read(holder.reader);`,
  ],
  [
    "a writable index",
    `declare function mutate(value: { [key: string]: object }): void;
const holder: { [key: string]: Reader } = { reader: new Pair() };
mutate(holder);
export const result = await read(holder.reader!);`,
  ],
  [
    "a nested callback input",
    `declare function invoke(value: {
  readonly callback: (reader: Reader) => void;
}): void;
invoke({ callback: async (reader): Promise<void> => {
  await reader.Read();
} });`,
  ],
] as const) {
  test(`retains interface behavior exposed through ${name}`, () => {
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
      cause.reason === "opaque-call-transport"
    ));
  });
}
