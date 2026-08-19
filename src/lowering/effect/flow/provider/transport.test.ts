import assert from "node:assert/strict";
import { test } from "node:test";

import { KindCallExpression } from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  countAsyncCallables,
} from "../../test-support/fixture.test-support.js";
import { createClosedCooperativeEffectPlan } from "../../planning/plan.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { providerInvocationFactKey } from "./fact.js";
import {
  checkedProviderFixture,
  providerContract,
  providerSession,
  testProviderSpecifier,
} from "./provider.test-support.js";
import { createProviderInvocationTransport } from "./transport.js";

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

test("settles an exact callback transported directly through a provider", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
run();
`, [forward]);

  assert.equal(rewrittenAsyncCount(source), 0);
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
run();
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
run();
`, [zero, alias, store, load]);

  assert.equal(rewrittenAsyncCount(source), 0);
});

test("retains when direct provider result provenance is omitted", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
run();
`, [{ ...forward, resultOriginParameters: Object.freeze([]) }]);

  assert.equal(rewrittenAsyncCount(source), 1);
});

test("retains when direct provider ingress is omitted", () => {
  const source = checkedProviderFixture(`
import { Operations } from "${testProviderSpecifier}";
const callback = async (): Promise<void> => {};
const forwarded = Operations.forward(callback);
async function run(): Promise<void> { await forwarded(); }
run();
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
run();
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
export const result = run();
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
export const result = run();
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
run();
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
    declarationPath: "other.d.ts",
    declarationFileName: "/src/node_modules/@test/provider/other.d.ts",
  }]);

  assert.equal(rewrittenAsyncCount(source), 2);
});

test("rejects a stale provider target type before lowering", () => {
  const session = providerSession(`
import { Operations } from "${testProviderSpecifier}";
export const callback = Operations.forward(async () => {});
`, [{ ...forward, targetType: "(value: number) => number" }]);
  assert.throws(
    () => session.checkSource(),
    /expected type/u,
  );
});

function rewrittenAsyncCount(
  source: ReturnType<typeof checkedProviderFixture>,
): number {
  const program = createProgram(source);
  const transports = createProviderInvocationTransport(source, program);
  const plan = createClosedCooperativeEffectPlan(
    source,
    program,
    (sourceFile) => source.documents.forFile(sourceFile).identity,
    undefined,
    transports,
  );
  const sourceFile = source.sourceFiles.find((candidate) =>
    source.ast.getFileName(candidate) === "/src/index.ts"
  );
  assert.ok(sourceFile !== undefined);
  const rewritten = lowerCooperativeEffects(sourceFile, plan);
  plan.finish();
  return countAsyncCallables(source, rewritten.sourceFile);
}

function createProgram(
  source: ReturnType<typeof checkedProviderFixture>,
) {
  return createTargetProgramIndex(source, {
    bindingWrites: true,
    memberDispatch: true,
    declarationReferences: true,
  });
}
