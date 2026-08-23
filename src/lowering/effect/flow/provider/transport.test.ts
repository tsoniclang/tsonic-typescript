import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  AsCallExpression,
  AsPropertyAccessExpression,
  KindCallExpression,
} from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  countAsyncCallables,
} from "../../test-support/fixture.test-support.js";
import { createClosedCooperativeEffectPlan } from "../../planning/plan.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { providerInvocationFactKey } from "./fact.js";
import {
  checkedProviderFixture,
  conditionalProviderContract,
  providerContract,
  providerSession,
  testProviderSpecifier,
} from "./provider.test-support.js";

const conditional = conditionalProviderContract();

const zero = providerContract(
  "zero",
  "() => State",
  [],
  [],
  Object.freeze({ kind: "create", read: false, writeParameters: [] }),
);
const store = providerContract(
  "store",
  "(state: State, value: () => Promise<void>) => void",
  [0, 1],
  [],
  Object.freeze({
    kind: "access",
    carrierParameter: 0,
    read: false,
    writeParameters: [1],
  }),
);
const load = providerContract(
  "load",
  "(state: State) => (() => Promise<void>) | undefined",
  [0],
  [],
  Object.freeze({
    kind: "access",
    carrierParameter: 0,
    read: true,
    writeParameters: [],
  }),
);
const alias = providerContract(
  "alias",
  "(state: State) => State",
  [0],
  [0],
  Object.freeze({
    kind: "alias",
    carrierParameter: 0,
    read: false,
    writeParameters: [],
  }),
);
const forward = providerContract(
  "forward",
  "(value: () => Promise<void>) => () => Promise<void>",
  [0],
  [0],
);
const forwardTuple = providerContract(
  "forwardTuple",
  "(value: [() => Promise<void>, boolean]) => [() => Promise<void>, boolean]",
  [0],
  [0],
);
const invoke = providerContract(
  "invoke",
  "<T>(callback: (value: T) => Awaitable<number>) => void",
  [0],
  [],
);

test("settles an exact callback transported directly through a provider", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
await run();
`, [forward]);

  assert.equal(rewrittenAsyncCount(source), 0);
});

test("selects a certified synchronous provider export for settled callbacks", () => {
  const source = checkedProviderFixture(`
import * as provider from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
async function run(): Promise<void> {
  await provider.conditionalInvoke(callback);
}
await run();
`, [conditional]);

  const rewritten = rewrittenProviderFixture(source, "open-structural");

  assert.equal(rewritten.asyncCount, 0);
  assert.deepEqual(propertyCallNames(source, rewritten.sourceFile), [
    "synchronousInvoke",
  ]);
});

test("retains a conditional provider export for an unresolved callback", () => {
  const source = checkedProviderFixture(`
import * as provider from "${testProviderSpecifier}";
declare const callback: () => Promise<void>;
async function run(): Promise<void> {
  await provider.conditionalInvoke(callback);
}
run();
`, [conditional]);

  const rewritten = rewrittenProviderFixture(source, "open-structural");

  assert.equal(rewritten.asyncCount, 1);
  assert.ok(
    propertyCallNames(source, rewritten.sourceFile).includes("conditionalInvoke"),
  );
});

test("retains a conditional provider call whose import shape is not rewritable", () => {
  const source = checkedProviderFixture(`
import { conditionalInvoke } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
async function run(): Promise<void> {
  await conditionalInvoke(callback);
}
run();
`, [conditional]);

  const rewritten = rewrittenProviderFixture(source, "open-structural");

  assert.equal(rewritten.asyncCount, 1);
});

test("rejects a stale conditional provider replacement", () => {
  const session = providerSession(`
import * as provider from "${testProviderSpecifier}";
export const result = provider.conditionalInvoke(async () => {});
`, [{
    ...conditional,
    conditional: Object.freeze({
      ...conditional.conditional!,
      replacement: Object.freeze({
        ...conditional.conditional!.replacement,
        targetType: "(value: number) => number",
      }),
    }),
  }]);

  assert.throws(() => session.checkSource(), /expected type/u);
});

test("settles a callable projected from one transported provider result", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const selected = Operations.forwardTuple([callback, true])[0];
async function run(): Promise<void> { await selected(); }
await run();
`, [forwardTuple]);

  assert.equal(rewrittenAsyncCount(source), 0);
});

test("composes provider transport before interface ingress", () => {
  const sourceText = `
import { Operations } from "${testProviderSpecifier}";
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
Operations.invoke<Pair>(async (value: Reader) => await value.Read());
`;
  const source = checkedProviderFixture(sourceText, [invoke]);
  const omitted = checkedProviderFixture(sourceText, [{
    ...invoke,
    inputParameters: Object.freeze([]),
  }]);
  const selectedResult = rewrittenProviderFixture(source, "declared-closed");
  const omittedResult = rewrittenProviderFixture(omitted, "declared-closed");

  assert.equal(selectedResult.asyncCount, 1);
  assert.equal(omittedResult.asyncCount, 1);
  assert.equal(
    selectedResult.summary.interfaceDispatch.analyzed &&
      selectedResult.summary.interfaceDispatch.settledFamilyCount,
    1,
  );
  assert.equal(
    omittedResult.summary.interfaceDispatch.analyzed &&
      omittedResult.summary.interfaceDispatch.rejectedFamilyCount,
    1,
  );
  assert.ok(
    omittedResult.summary.interfaceDispatch.analyzed &&
      omittedResult.summary.interfaceDispatch.boundaryCauses.some((cause) =>
        cause.reason === "opaque-call-transport"
      ),
  );
});

test("settles a callback through a closed provider state carrier", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const state = Operations.zero();
const callback = async (): Promise<void> => {};
Operations.store(state, callback);
async function run(): Promise<void> {
  const selected = Operations.load(state);
  if (selected !== undefined) await selected();
}
await run();
`, [zero, store, load]);

  assert.equal(rewrittenAsyncCount(source), 0);
});

test("conserves every write through aliases and repeated provider reads", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const state = Operations.zero();
const aliasState = Operations.alias(state);
const first = async (): Promise<void> => {};
const second = async (): Promise<void> => {};
Operations.store(state, first);
Operations.store(aliasState, second);
async function run(): Promise<void> {
  const left = Operations.load(state);
  const right = Operations.load(aliasState);
  if (left !== undefined) await left();
  if (right !== undefined) await right();
}
await run();
`, [zero, alias, store, load]);

  assert.equal(rewrittenAsyncCount(source), 0);
});

test("retains when direct provider result provenance is omitted", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
await run();
`, [{ ...forward, resultOriginParameters: Object.freeze([]) }]);

  assert.equal(rewrittenAsyncCount(source), 1);
});

test("generic callable flow does not cross the exact provider boundary", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
await run();
`, [{ ...forward, resultOriginParameters: Object.freeze([]) }]);
  const providerFile = source.sourceFiles.find((sourceFile) =>
    source.ast.getFileName(sourceFile).endsWith("/@test/provider/index.d.ts")
  );
  assert.ok(providerFile !== undefined);

  assert.equal(
    rewrittenAsyncCount(withExcludedSemantics(source, providerFile)),
    1,
  );
});

test("retains when direct provider ingress is omitted", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
await run();
`, [{ ...forward, inputParameters: Object.freeze([]) }]);

  assert.equal(rewrittenAsyncCount(source), 2);
});

test("admits only transparent syntax within an exact provider input", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(
  callback as () => Promise<void>,
);
async function run(): Promise<void> { await forwarded(); }
await run();
`, [forward]);

  assert.equal(rewrittenAsyncCount(source), 0);
});

test("retains provider state after an unaccounted carrier escape", () => {
  const source = checkedProviderFixture(`
import { Operations, type State } from "${testProviderSpecifier}";
declare function expose(value: State): void;
const state = Operations.zero();
const callback = async (): Promise<void> => {};
Operations.store(state, callback);
expose(state);
async function run(): Promise<void> {
  const selected = Operations.load(state);
  if (selected !== undefined) await selected();
}
export const result = await run();
`, [zero, store, load]);

  assert.ok(rewrittenAsyncCount(source) > 0);
});

test("retains provider state after an unaccounted reassignment", () => {
  const source = checkedProviderFixture(`
import { Operations, type State } from "${testProviderSpecifier}";
declare const external: State;
let state = Operations.zero();
state = external;
const callback = async (): Promise<void> => {};
Operations.store(state, callback);
async function run(): Promise<void> {
  const selected = Operations.load(state);
  if (selected !== undefined) await selected();
}
export const result = await run();
`, [zero, store, load]);

  assert.ok(rewrittenAsyncCount(source) > 0);
});

test("retains provider state after an uncertified provider operation", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const state = Operations.zero();
const callback = async (): Promise<void> => {};
Operations.store(state, callback);
Operations.observe(state);
async function run(): Promise<void> {
  const selected = Operations.load(state);
  if (selected !== undefined) await selected();
}
await run();
`, [zero, store, load]);

  assert.ok(rewrittenAsyncCount(source) > 0);
});

test("does not classify a same-shaped local call as provider transport", () => {
  const source = checkedProviderFixture(`
class Operations {
  static forward(value: () => Promise<void>): () => Promise<void> {
    return value;
  }
}
export const callback = Operations.forward(async () => {});
`, [forward]);
  const program = createProgram(source);
  const facts = program.nodesOfKind(KindCallExpression).filter((call) =>
    source.sourceFacts.getFact(call, providerInvocationFactKey) !== undefined
  );

  assert.equal(facts.length, 0);
});

test("does not classify a provider call through another declaration file", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const forwarded = Operations.forward(async () => {});
async function run(): Promise<void> { await forwarded(); }
run();
`, [{
    ...forward,
    target: Object.freeze({
      ...forward.target,
      declarationPath: "other.d.ts",
      declarationFileName: "/src/node_modules/@test/provider/other.d.ts",
    }),
  }]);

  assert.equal(rewrittenAsyncCount(source), 2);
});

test("rejects a stale provider target type before lowering", () => {
  const session = providerSession(`
import { Operations } from "${testProviderSpecifier}";
export const callback = Operations.forward(async () => {});
`, [{
    ...forward,
    target: Object.freeze({
      ...forward.target,
      targetType: "(value: number) => number",
    }),
  }]);
  assert.throws(
    () => session.checkSource(),
    /expected type/u,
  );
});

function rewrittenAsyncCount(
  source: ReturnType<typeof checkedProviderFixture>,
  interfaceDispatch: "open-structural" | "declared-closed" = "open-structural",
): number {
  return rewrittenProviderFixture(source, interfaceDispatch).asyncCount;
}

function rewrittenProviderFixture(
  source: ReturnType<typeof checkedProviderFixture>,
  interfaceDispatch: "open-structural" | "declared-closed",
) {
  const program = createProgram(source);
  const plan = createClosedCooperativeEffectPlan(
    source,
    program,
    (sourceFile) => source.documents.forFile(sourceFile).identity,
    undefined,
    undefined,
    interfaceDispatch,
  );
  const sourceFile = source.sourceFiles.find((candidate) =>
    source.ast.getFileName(candidate) === "/src/index.ts"
  );
  assert.ok(sourceFile !== undefined);
  const rewritten = lowerCooperativeEffects(sourceFile, plan);
  plan.finish();
  return Object.freeze({
    asyncCount: countAsyncCallables(source, rewritten.sourceFile),
    sourceFile: rewritten.sourceFile,
    summary: plan.summary,
  });
}

function propertyCallNames(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly string[] {
  const names: string[] = [];
  const pending: Node[] = [sourceFile];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    const call = source.ast.is.IsCallExpression(node)
      ? AsCallExpression(node)
      : undefined;
    const access = call?.Expression !== undefined &&
        source.ast.is.IsPropertyAccessExpression(call.Expression)
      ? AsPropertyAccessExpression(call.Expression)
      : undefined;
    const name = source.ast.text(access?.name);
    if (name !== undefined && name !== "") {
      names.push(name);
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return Object.freeze(names.sort());
}

function createProgram(
  source: ReturnType<typeof checkedProviderFixture>,
) {
  return createTargetProgramIndex(source, {
    bindingWrites: true,
    memberDispatch: true,
  });
}

function withExcludedSemantics(
  source: TargetSourceProgram,
  excluded: SourceFile,
): TargetSourceProgram {
  return Object.freeze({
    ...source,
    semantics: Object.freeze({
      ...source.semantics,
      includes(sourceFile: SourceFile): boolean {
        return sourceFile !== excluded && source.semantics.includes(sourceFile);
      },
      forFile(sourceFile: SourceFile) {
        if (sourceFile === excluded) {
          throw new Error("generic callable flow queried excluded provider semantics");
        }
        return source.semantics.forFile(sourceFile);
      },
      forNode(node: Parameters<TargetSourceProgram["semantics"]["forNode"]>[0]) {
        if (source.ast.getSourceFile(node) === excluded) {
          throw new Error("generic callable flow queried excluded provider semantics");
        }
        return source.semantics.forNode(node);
      },
    }),
  });
}
