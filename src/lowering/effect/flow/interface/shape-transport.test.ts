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

for (const [name, declarations, expression] of [
  [
    "tuple and array elements",
    `type Source = { readonly values: readonly [Pair, Pair[]] };
type Target = { readonly values: readonly [Reader, readonly Reader[]] };
function select(value: Target): Reader { return value.values[1][0]!; }
const source: Source = { values: [new Pair(), [new Pair()]] };`,
    "select(source)",
  ],
  [
    "generic members",
    `type Source<T> = { readonly value: T };
type Target<T> = { readonly value: T };
function select(value: Target<Reader>): Reader { return value.value; }
const source: Source<Pair> = { value: new Pair() };`,
    "select(source)",
  ],
  [
    "union members",
    `type Source = { readonly value: Pair | number };
type Target = { readonly value: Reader | number };
function select(value: Target): Reader {
  return typeof value.value === "number" ? new Pair() : value.value;
}
const source: Source = { value: new Pair() };`,
    "select(source)",
  ],
  [
    "optional absent members",
    `type Source = {};
type Target = { readonly value?: Reader };
function select(_value: Target): Reader { return new Pair(); }
const source: Source = {};`,
    "select(source)",
  ],
  [
    "string index members",
    `type Source = { readonly [name: string]: Pair };
type Target = { readonly [name: string]: Reader };
function select(value: Target): Reader { return value.first!; }
const source: Source = { first: new Pair() };`,
    "select(source)",
  ],
  [
    "number index members",
    `type Source = { readonly [index: number]: Pair };
type Target = { readonly [index: number]: Reader };
function select(value: Target): Reader { return value[0]!; }
const source: Source = { 0: new Pair() };`,
    "select(source)",
  ],
  [
    "callable parameters and results",
    `type Source = { readonly map: (value: Reader) => Pair };
type Target = { readonly map: (value: Pair) => Reader };
function select(value: Target): Reader { return value.map(new Pair()); }
const source: Source = { map: (_value) => new Pair() };`,
    "select(source)",
  ],
] as const) {
  test(`conserves interface contracts through ${name}`, () => {
    const fixture = checkedEffectFixture(`${prelude}
${declarations}
export const result = await read(${expression});
`);
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

test("retains an asserted incompatible nested contract", () => {
  const fixture = checkedEffectFixture(`${prelude}
const erased: object[] = [new Pair()];
const readers = erased as Reader[];
export const result = await read(readers[0]!);
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
    cause.reason === "unmatched-nested-contract" ||
    cause.reason === "unproven-value-origin"
  ));
});
