import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countAsyncCallables,
  createFixtureEffectPlan,
  checkedEffectFixture,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

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

function rewriteFixture(sourceText: string) {
  const fixture = checkedEffectFixture(sourceText);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
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
