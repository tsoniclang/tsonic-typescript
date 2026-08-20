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
        declarationReferences: true,
      }),
    );
    assert.equal(graph.components.length, 1);
    assertNoInterfaceBoundaryCauses(graph.components[0]);
  });
}

test("does not retain an opaque callback input that never reaches behavior", () => {
  const fixture = checkedEffectFixture(`${prelude}
declare function inspect(callback: (reader: Reader) => void): void;
inspect((reader) => {
  const copied = reader;
  void copied;
});
export const result = await read(new Pair());
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assertNoInterfaceBoundaryCauses(graph.components[0]);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("retains an opaque callback input at its exact interface dispatch", () => {
  const fixture = checkedEffectFixture(`${prelude}
const visit = async (reader: Reader): Promise<void> => {
  await reader.Read();
};
declare function inspect(callback: (reader: Reader) => void): void;
inspect(visit);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
    cause.reason === "opaque-call-transport"
  ));
});

test("retains an opaque callback input forwarded through a project call", () => {
  const fixture = checkedEffectFixture(`${prelude}
async function forward(reader: Reader): Promise<number> {
  return await reader.Read();
}
declare function inspect(callback: (reader: Reader) => void): void;
inspect(async (reader): Promise<void> => {
  await forward(reader);
});
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
    cause.reason === "opaque-call-transport"
  ));
});

test("retains a callback without one exact project implementation", () => {
  const fixture = checkedEffectFixture(`${prelude}
declare const visit: (reader: Reader) => void;
declare function inspect(callback: (reader: Reader) => void): void;
inspect(visit);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
    cause.reason === "opaque-call-transport"
  ));
});

test("bounds deep opaque exposure to its exact reached contract", () => {
  const depth = 260;
  const carriers = Array.from({ length: depth }, (_, index) =>
    `interface Carrier${String(index)} { value: Carrier${String(index + 1)}; }`
  ).join("\n");
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
interface Writer { Write(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 20; }
}
class Pen implements Writer {
  async Write(): Promise<number> { return 22; }
}
${carriers}
interface Carrier${String(depth)} { reader: Reader; }
declare const carrier: Carrier0;
declare function mutate(value: Carrier0): void;
mutate(carrier);
async function read(value: Reader): Promise<number> {
  return await value.Read();
}
async function write(value: Writer): Promise<number> {
  return await value.Write();
}
export const result = [await read(new Pair()), await write(new Pen())];
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.consideredFamilyCount, 2);
  assert.equal(evidence.settledFamilyCount, 1);
  assert.equal(evidence.retainedFamilyCount, 1);
  assert.equal(
    evidence.boundaryCauses.find((cause) =>
      cause.reason === "opaque-call-transport"
    )?.occurrenceCount,
    1,
  );
  assert.equal(
    evidence.retainedFamilies.filter((family) =>
      family.boundaryCauses.some((cause) =>
        cause.reason === "opaque-call-transport"
      )
    ).length,
    1,
  );
});

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
        declarationReferences: true,
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
        declarationReferences: true,
      }),
    );
    assert.equal(graph.components.length, 1);
    assert.ok(graph.components[0]?.boundaryCauses.some((cause) =>
      cause.reason === "opaque-call-transport"
    ));
  });
}
