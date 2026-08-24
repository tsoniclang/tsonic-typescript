import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  countAsyncCallables,
  createFixtureEffectPlan,
  checkedEffectFixture,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { createExactStructuralSlotWriteIndex } from "../value/slot/structural-writes.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";

const generatedStorageFixture = `
type Awaitable<T> = T | PromiseLike<T>;

interface NodeData {
  ForEachChild(visitor: Visitor): Awaitable<boolean>;
}

type NodeStorage = {
  data: NodeData | undefined;
};

class NodeValue {
  private readonly storage: NodeStorage;

  constructor(storage: NodeStorage) {
    this.storage = storage;
  }

  static storageOf(value: NodeValue): NodeStorage {
    return value.storage;
  }

  static async ForEachChild(
    value: NodeValue,
    visitor: Visitor,
  ): Promise<boolean> {
    const receiver = NodeValue.storageOf(value).data;
    return await receiver!.ForEachChild(visitor);
  }
}

class Visitor {
  private readonly callback: (value: NodeValue) => Awaitable<boolean>;

  constructor(callback: (value: NodeValue) => Awaitable<boolean>) {
    this.callback = callback;
  }

  async Visit(value: NodeValue): Promise<boolean> {
    return await this.callback(value);
  }
}

class Adapter {
  private readonly child: NodeValue | undefined;

  constructor(child: NodeValue | undefined) {
    this.child = child;
  }

  async ForEachChild(visitor: Visitor): Promise<boolean> {
    return this.child === undefined ? false : await visitor.Visit(this.child);
  }
}

function create(data: NodeData): NodeValue {
  const value = new NodeValue({ data: undefined });
  NodeValue.storageOf(value).data = data;
  return value;
}

async function mark(value: NodeValue): Promise<boolean> {
  await NodeValue.ForEachChild(value, new Visitor(mark));
  return false;
}

const leaf = create(new Adapter(undefined));
export const result = await mark(leaf);
`;

test("settles an exact interface stored behind generated structural storage", () => {
  const rewritten = rewriteFixture(generatedStorageFixture);
  assert.equal(
    rewritten.asyncCount,
    0,
    JSON.stringify(rewritten.interfaceDispatch),
  );
});

test("retains a stored callable with an explicit receiver contract", () => {
  const source = generatedStorageFixture.replaceAll(
    "(value: NodeValue) => Awaitable<boolean>",
    "(this: Visitor, value: NodeValue) => Awaitable<boolean>",
  );
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains an exported callable origin", () => {
  const source = generatedStorageFixture.replace(
    "async function mark(value: NodeValue)",
    "export async function mark(value: NodeValue)",
  );
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains the same storage owner at an unrelated interface boundary", () => {
  const source = `${generatedStorageFixture}\n
interface NodeValueSink {
  accept(value: NodeValue): void;
}
declare const sink: NodeValueSink;
sink.accept(leaf);
`;
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains a structural write mediated through a helper parameter", () => {
  const source = generatedStorageFixture
    .replace(
      "class NodeValue {",
      `function assignStorage(
  storage: NodeStorage,
  data: NodeData,
): void {
  storage.data = data;
}

class NodeValue {`,
    )
    .replace(
      "NodeValue.storageOf(value).data = data;",
      "assignStorage(NodeValue.storageOf(value), data);",
    );
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains structural storage exposed to an opaque mutator", () => {
  const source = `${generatedStorageFixture}\n
declare function mutate(storage: NodeStorage): void;
mutate(NodeValue.storageOf(leaf));
`;
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains an opaque value written directly to structural storage", () => {
  const source = `${generatedStorageFixture}\n
declare function unknownData(): NodeData;
NodeValue.storageOf(leaf).data = unknownData();
`;
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains a structurally aliased slot with independent writes", () => {
  const source = `${generatedStorageFixture}\n
const alternate: { data: NodeData | undefined } = {
  data: new Adapter(undefined),
};
const aliasedNode = new NodeValue(alternate);
alternate.data = undefined;
export const aliasResult = aliasedNode;
`;
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("retains a mutable local alias of a structural slot", () => {
  const source = `${generatedStorageFixture}\n
declare function unknownData(): NodeData;
async function inspect(value: NodeValue, visitor: Visitor): Promise<boolean> {
  let receiver = NodeValue.storageOf(value).data;
  receiver = unknownData();
  return await receiver.ForEachChild(visitor);
}
export const inspectResult = inspect;
`;
  assert.ok(rewriteFixture(source).asyncCount > 0);
});

test("expands each opaque structural type pair once", () => {
  const single = countOpaqueStructuralTypeQueries(1);
  const repeated = countOpaqueStructuralTypeQueries(64);
  assert.equal(repeated, single);
});

test("does not query semantics for irrelevant structural syntax", () => {
  const fixture = checkedEffectFixture(`
const values = [${Array.from({ length: 256 }, (_, index) => index).join(",")}];
export const result = values;
`);
  let queries = 0;
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    semantics: Object.freeze({
      ...fixture.source.semantics,
      forNode(node: Node) {
        queries += 1;
        return fixture.source.semantics.forNode(node);
      },
    }),
  });
  createExactStructuralSlotWriteIndex(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: true,
      memberDispatch: true,
    }),
    new Set(),
  );
  assert.equal(queries, 0);
});

test("resolves value-slot roots in more than one bounded transaction", () => {
  const declarations = Array.from(
    { length: 300 },
    (_, index) => `
async function use${index}(worker: Worker): Promise<number> {
  return await worker.Work();
}`,
  ).join("\n");
  const calls = Array.from(
    { length: 300 },
    (_, index) => `await use${index}(new SyncWorker())`,
  ).join(",\n");
  const source = `
type Awaitable<T> = T | PromiseLike<T>;

interface Worker {
  Work(): Awaitable<number>;
}

class SyncWorker {
  async Work(): Promise<number> {
    return 1;
  }
}

${declarations}

export const result = [${calls}];
`;
  const batches: number[] = [];
  const rewritten = rewriteFixture(source, (phase, measurements) => {
    if (
      phase === "effect-value-slot-roots" &&
      measurements?.batches !== undefined
    ) {
      batches.push(measurements.batches);
    }
  });

  assert.equal(rewritten.asyncCount, 0);
  assert.ok(Math.max(...batches) >= 300);
});

function rewriteFixture(
  sourceText: string,
  planningObserver?: TypeScriptPlanningObserver,
) {
  const fixture = checkedEffectFixture(sourceText);
  const plan = createFixtureEffectPlan(
    fixture.source,
    "declared-closed",
    planningObserver,
  );
  const rewritten = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();
  return Object.freeze({
    asyncCount: rewritten.reduce(
      (total, file) =>
        total + countAsyncCallables(fixture.source, file.sourceFile),
      0,
    ),
    interfaceDispatch: plan.summary.interfaceDispatch,
  });
}

function countOpaqueStructuralTypeQueries(callCount: number): number {
  const calls = Array.from({ length: callCount }, () => "mutate(value);").join(
    "\n",
  );
  const fixture = checkedEffectFixture(`
interface RecursiveStorage {
  next: RecursiveStorage | undefined;
  callback: (() => number) | undefined;
}
declare function mutate(value: RecursiveStorage): void;
const value = {} as RecursiveStorage;
${calls}
`);
  let queries = 0;
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    semantics: Object.freeze({
      ...fixture.source.semantics,
      forNode(node: Node) {
        const semantics = fixture.source.semantics.forNode(node);
        return Object.freeze({
          ...semantics,
          types: Object.freeze({
            ...semantics.types,
            propertyInfos(
              type: Parameters<typeof semantics.types.propertyInfos>[0],
            ) {
              queries += 1;
              return semantics.types.propertyInfos(type);
            },
          }),
        });
      },
    }),
  });
  createExactStructuralSlotWriteIndex(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: true,
      memberDispatch: true,
    }),
    new Set(),
  );
  return queries;
}
