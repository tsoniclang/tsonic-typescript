import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  IsAwaitExpression,
  IsTypeReferenceNode,
  KindCallExpression,
} from "@tsonic/tsts/target-ast";

import {
  checkedEffectFixture,
  countAsyncCallables,
  countNodes,
  createFixtureEffectPlan,
  visit,
} from "./effect.test-support.js";
import { createInterfaceContractGraph } from "./interface-contract-graph.js";
import { createDeclaredInterfaceDispatch } from "./interface-dispatch.js";
import { lowerCooperativeEffects } from "./transform.js";
import { createTargetProgramIndex } from "../program-index.js";

const declaredFamily = `
type Awaitable<T> = T | PromiseLike<T>;

interface Reader {
  Read(): Awaitable<number>;
}

class First implements Reader {
  async Read(): Promise<number> { return 20; }
}

class Second implements Reader {
  async Read(): Promise<number> { return 22; }
}

async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}

async function top(): Promise<number> {
  return (await read(new First())) + (await read(new Second()));
}

export const result = await top();
`;

test("settles one explicitly selected declared interface family atomically", () => {
  const fixture = checkedEffectFixture(declaredFamily);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 4);
  assert.equal(plan.summary.settledCallableCount, 4);
  assert.equal(rewritten.callableCount, 4);
  assert.equal(rewritten.awaitCount, 4);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
  assert.equal(
    countNodes(
      fixture.source,
      rewritten.sourceFile,
      IsAwaitExpression,
    ),
    0,
  );
  assert.equal(
    countNodes(fixture.source, rewritten.sourceFile, (node) =>
      IsTypeReferenceNode(node) &&
      ["Promise", "PromiseLike", "Awaitable"].includes(
        fixture.source.ast.text(fixture.source.ast.name(node)),
      )
    ),
    0,
  );
});

test("does not infer closed interface dispatch from cooperative effects", () => {
  const fixture = checkedEffectFixture(declaredFamily);
  const plan = createFixtureEffectPlan(fixture.source);
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 4);
  assert.equal(plan.summary.settledCallableCount, 2);
  assert.equal(rewritten.callableCount, 2);
  assert.equal(rewritten.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 2);
});

test("retains an entire declared interface family when one implementation suspends", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
interface Reader { Read(): Awaitable<number>; }
class First implements Reader {
  async Read(): Promise<number> { return 20; }
}
class Second implements Reader {
  async Read(): Promise<number> { return await remote(); }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return await read(new First());
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 4);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(rewritten.callableCount, 0);
  assert.equal(rewritten.awaitCount, 0);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 4);
  assert.deepEqual(plan.summary.interfaceDispatch, {
    profile: "declared-closed",
    analyzed: true,
    consideredContractCount: 1,
    consideredFamilyCount: 1,
    admittedFamilyCount: 1,
    rejectedFamilyCount: 0,
    consideredCallCount: 1,
    admittedCallCount: 1,
    rejectedCallCount: 0,
    implementationCount: 2,
    candidateImplementationCount: 2,
    settledFamilyCount: 0,
    retainedFamilyCount: 1,
    settledCallCount: 0,
    retainedCallCount: 1,
    retainedFamilies: [{
      reason: "unresolved-call",
      contracts: [{
        kind: "authored",
        documentIdentity: "/src/index.ts",
        start: 104,
        end: 130,
        syntaxKind: "KindMethodSignature",
      }],
      callCount: 1,
      boundaryCauses: [],
    }],
  });
});

test("does not admit an unrelated same-named method into the family", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
interface Reader { Read(): Awaitable<number>; }
class First implements Reader {
  async Read(): Promise<number> { return 42; }
}
class Unrelated {
  async Read(): Promise<number> { return await remote(); }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return await read(new First());
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 4);
  assert.equal(plan.summary.settledCallableCount, 3);
  assert.equal(rewritten.callableCount, 3);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 1);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.implementationCount, 1);
});

test("joins an implementation through exact declared interface inheritance", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
interface DerivedReader extends Reader {}
class First implements DerivedReader {
  async Read(): Promise<number> { return 42; }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return await read(new First());
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 3);
  assert.equal(plan.summary.settledCallableCount, 3);
  assert.equal(rewritten.callableCount, 3);
  assert.equal(rewritten.awaitCount, 3);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
});

test("joins one inherited overloaded implementation body", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Base {
  Read(): Promise<number>;
  async Read(): Promise<number> { return 42; }
}
class Derived extends Base implements Reader {}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return await read(new Derived());
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 3);
  assert.equal(plan.summary.settledCallableCount, 0);
  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 3);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.admittedFamilyCount, 1);
  assert.equal(evidence.implementationCount, 1);
  assert.equal(evidence.candidateImplementationCount, 1);
});

test("settles a family with exact synchronous and cooperative implementations", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Direct implements Reader {
  Read(): number { return 20; }
}
class Cooperative implements Reader {
  async Read(): Promise<number> { return 22; }
}
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
async function top(): Promise<number> {
  return (await read(new Direct())) + (await read(new Cooperative()));
}
export const result = await top();
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(plan.summary.candidateCount, 3);
  assert.equal(plan.summary.settledCallableCount, 3);
  assert.equal(rewritten.callableCount, 3);
  assert.equal(rewritten.awaitCount, 4);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.implementationCount, 2);
  assert.equal(evidence.candidateImplementationCount, 1);
});

test("keeps same-shaped declared interfaces in separate families", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
declare function remote(): Promise<number>;
interface DirectReader { Read(): Awaitable<number>; }
interface RemoteReader { Read(): Awaitable<number>; }
class Direct implements DirectReader {
  async Read(): Promise<number> { return 42; }
}
class Remote implements RemoteReader {
  async Read(): Promise<number> { return await remote(); }
}
async function readDirect(reader: DirectReader): Promise<number> {
  return await reader.Read();
}
async function readRemote(reader: RemoteReader): Promise<number> {
  return await reader.Read();
}
export const result = [await readDirect(new Direct()), await readRemote(new Remote())];
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 2);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.consideredFamilyCount, 2);
  assert.equal(evidence.settledFamilyCount, 1);
  assert.equal(evidence.retainedFamilyCount, 1);
});

test("joins a generic declared family across source files", () => {
  const fixture = checkedEffectFixture(`
import type { Reader } from "./contract.js";
import { Box } from "./implementation.js";
async function read(reader: Reader<number>): Promise<number> {
  return await reader.Read();
}
export const result = await read(new Box());
`, {
    "/src/contract.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export interface Reader<T> { Read(): Awaitable<T>; }
`,
    "/src/implementation.ts": `
import type { Reader } from "./contract.js";
export class Box implements Reader<number> {
  async Read(): Promise<number> { return 42; }
}
`,
  });
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    rewritten.reduce(
      (total, result) =>
        total + countAsyncCallables(fixture.source, result.sourceFile),
      0,
    ),
    0,
  );
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.consideredFamilyCount, 1);
  assert.equal(evidence.implementationCount, 1);
  assert.equal(evidence.settledFamilyCount, 1);
});

test("consumes multiple interface calls sharing one source line", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 21; }
}
async function read(reader: Reader): Promise<number> {
  return (await reader.Read()) + (await reader.Read());
}
export const result = await read(new Pair());
`);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.admittedCallCount, 2);
  assert.equal(evidence.settledCallCount, 2);
});

test("settles structurally transported project contracts as one component", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface SourceReader { Read(): Awaitable<number>; }
interface TargetReader { Read(): Awaitable<number>; }
class Pair implements SourceReader {
  async Read(): Promise<number> { return 42; }
}
function consume(reader: TargetReader): void { void reader; }
async function read(reader: SourceReader): Promise<number> {
  consume(reader);
  return await reader.Read();
}
export const result = await read(new Pair());
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.entries.length, 2);
  assert.equal(graph.components[0]?.boundary, false);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
  assert.equal(
    countNodes(fixture.source, rewritten.sourceFile, (node) =>
      IsTypeReferenceNode(node) &&
      ["Promise", "PromiseLike", "Awaitable"].includes(
        fixture.source.ast.text(fixture.source.ast.name(node)),
      )
    ),
    0,
  );
});

test("retains project contracts nested in a structural container", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface SourceReader { Read(): Awaitable<number>; }
interface TargetReader { Read(): Awaitable<number>; }
class Pair implements SourceReader {
  async Read(): Promise<number> { return 42; }
}
function consume(readers: readonly TargetReader[]): void { void readers; }
async function read(readers: readonly SourceReader[]): Promise<number> {
  consume(readers);
  return await readers[0]!.Read();
}
export const result = await read([new Pair()]);
`);
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.entries.length, 1);
  assert.equal(graph.components[0]?.boundary, true);

  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.rejectedFamilyCount, 1);
});

test("retains a contract transported through an external interface", () => {
  const fixture = checkedEffectFixture(`
import type { ExternalReader } from "provider";
type Awaitable<T> = T | PromiseLike<T>;
interface GeneratedReader { Read(): Awaitable<number>; }
class Pair implements GeneratedReader {
  async Read(): Promise<number> { return 42; }
}
declare function install(view: (reader: ExternalReader) => void): void;
const forward = (reader: GeneratedReader): void => { void reader; };
install(forward);
async function read(reader: GeneratedReader): Promise<number> {
  return await reader.Read();
}
export const result = await read(new Pair());
`, {
    "/node_modules/provider/index.d.ts": `
export type Awaitable<T> = T | PromiseLike<T>;
export interface ExternalReader { Read(): Awaitable<number>; }
`,
  });
  const graph = createInterfaceContractGraph(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
  );
  assert.equal(graph.components.length, 1);
  assert.equal(graph.components[0]?.entries.length, 1);
  assert.equal(graph.components[0]?.boundary, true);
  const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
  const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
  plan.finish();

  assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 1);
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.settledFamilyCount, 0);
  assert.equal(evidence.rejectedFamilyCount, 1);
});

test("rejects same-identity foreign declarations before semantic queries", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
`);
  const foreign = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
`);
  let foreignDeclaration: Node | undefined;
  visit(foreign.source, foreign.sourceFile, (node) => {
    if (foreign.source.ast.is.IsMethodSignatureDeclaration(node)) {
      foreignDeclaration = node;
    }
  });
  assert.ok(foreignDeclaration !== undefined);
  const foreignFile = fixture.source.ast.getSourceFile(foreignDeclaration);
  assert.ok(foreignFile !== undefined);
  assert.equal(
    fixture.source.navigation.isProjectDeclaration(foreignDeclaration),
    true,
  );
  assert.equal(fixture.source.semantics.includes(foreignFile), false);

  const indexed = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
  });
  const call = indexed.nodesOfKind(KindCallExpression)[0];
  assert.ok(call !== undefined);
  const callSemantics = fixture.source.semantics.forNode(call);
  const source = Object.freeze({
    ...fixture.source,
    semantics: Object.freeze({
      ...fixture.source.semantics,
      forNode(node: Parameters<typeof fixture.source.semantics.forNode>[0]) {
        const semantics = fixture.source.semantics.forNode(node);
        return node !== call
          ? semantics
          : Object.freeze({
              ...callSemantics,
              getSignatureDeclaration() {
                return foreignDeclaration;
              },
            });
      },
    }),
  });

  const dispatch = createDeclaredInterfaceDispatch(
    source,
    createTargetProgramIndex(source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
    new Map(),
    "declared-closed",
  );
  assert.equal(dispatch.consideredFamilyCount, 0);
});
