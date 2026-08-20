import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api";
import { KindCallExpression, KindParameter } from "@tsonic/tsts/target-ast";

import { createTargetProgramIndex } from "../../../program-index.js";
import {
  checkedEffectFixture,
  countAsyncCallables,
  createFixtureEffectPlan,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";
import { createInterfaceContractGraph } from "./graph.js";
import {
  callHasExactBindings,
  exactSourceCallBindings,
} from "../invocation/call-binding.js";

const prelude = `
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
class Pair implements Reader {
  async Read(): Promise<number> { return 42; }
}
function consume(...readers: Reader[]): Reader { return readers[0]!; }
async function read(reader: Reader): Promise<number> {
  return await reader.Read();
}
`;

for (const [name, sourceText] of [
  [
    "ordinary rest elements",
    `export const result = await read(consume(new Pair(), new Pair()));`,
  ],
  [
    "tuple spread elements",
    `const readers: readonly [Pair, Pair] = [new Pair(), new Pair()];
export const result = await read(consume(...readers));`,
  ],
  [
    "sequence spread into rest",
    `const readers: Pair[] = [new Pair(), new Pair()];
export const result = await read(consume(...readers));`,
  ],
] as const) {
  test(`exactly binds ${name}`, () => {
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
    assert.ok(!graph.components[0]?.boundaryCauses.some((cause) =>
      cause.reason === "inexact-call-bindings"
    ));
    const restParameter = [...createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }).nodesOfKind(KindParameter)].find((node) =>
      fixture.source.ast.as.AsParameterDeclaration(node)?.DotDotDotToken !==
        undefined
    );
    assert.ok(restParameter !== undefined);
    assert.equal(
      graph.invocationInputs.restElementInputsFor(restParameter, 0)?.length,
      1,
    );
    assert.equal(
      graph.invocationInputs.restElementInputsFor(restParameter, 1)?.length,
      1,
    );
    const consumeCall = [...createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
      declarationReferences: true,
    }).nodesOfKind(KindCallExpression)].find((node) => {
      const expression = fixture.source.ast.as.AsCallExpression(node)?.Expression;
      return expression !== undefined &&
        fixture.source.ast.is.IsIdentifier(expression) &&
        fixture.source.ast.text(expression) === "consume";
    });
    assert.ok(consumeCall !== undefined);
    const exact = exactSourceCallBindings(fixture.source, consumeCall);
    assert.ok(exact !== undefined);
    assert.ok(exact.bindings.length >= 1);
    assert.equal(new Set(exact.bindings.map(({ parameter }) => parameter)).size, 1);

    const plan = createFixtureEffectPlan(fixture.source, "declared-closed");
    const rewritten = lowerCooperativeEffects(fixture.sourceFile, plan);
    plan.finish();
    assert.equal(countAsyncCallables(fixture.source, rewritten.sourceFile), 0);
  });
}

test("fails closed when any exact rest invocation omits an indexed element", () => {
  const fixture = checkedEffectFixture(`${prelude}
consume();
export const result = await read(consume(new Pair(), new Pair()));
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
    declarationReferences: true,
  });
  const graph = createInterfaceContractGraph(fixture.source, program);
  const restParameter = [...program.nodesOfKind(KindParameter)].find((node) =>
    fixture.source.ast.as.AsParameterDeclaration(node)?.DotDotDotToken !==
      undefined
  );
  assert.ok(restParameter !== undefined);
  assert.equal(
    graph.invocationInputs.restElementInputsFor(restParameter, 0),
    undefined,
  );
});

test("rejects every corrupted spread-binding dimension", () => {
  const fixture = checkedEffectFixture(`${prelude}
const readers: readonly [Pair, Pair] = [new Pair(), new Pair()];
export const result = await read(consume(...readers));
`);
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
    declarationReferences: true,
  });
  const selected = [...program.nodesOfKind(KindCallExpression)].flatMap(
    (node) => {
      const semantics = fixture.source.semantics.forNode(node);
      const call = semantics.getResolvedCallInfo(node);
      return call !== undefined &&
          call.sourceArguments.length === 1 &&
          call.sourceArgumentBindings.length === 2
        ? [{ node, call, semantics }]
        : [];
    },
  )[0];
  assert.ok(selected !== undefined);
  const declaration = selected.semantics.getSignatureDeclaration(
    selected.call.selectedSignature,
  );
  assert.equal(
    callHasExactBindings(
      fixture.source,
      selected.node,
      selected.call,
      declaration,
    ),
    true,
  );

  const bindings = selected.call.sourceArgumentBindings;
  const first = bindings[0]!;
  const second = bindings[1]!;
  const mutations: readonly ResolvedSourceCallInfo[] = [
    withBindings(selected.call, [second]),
    withBindings(selected.call, [first, first]),
    withBindings(selected.call, [second, first]),
    withBindings(selected.call, [
      first,
      { ...second, spreadElementIndex: 7 },
    ]),
    withBindings(selected.call, [
      { ...first, sourceParameterIndex: 1 },
      second,
    ]),
    { ...selected.call, call: selected.call.sourceArguments[0]!.expression },
  ];
  for (const mutation of mutations) {
    assert.equal(
      callHasExactBindings(
        fixture.source,
        selected.node,
        mutation,
        declaration,
      ),
      false,
    );
  }
});

function withBindings(
  call: ResolvedSourceCallInfo,
  bindings: ResolvedSourceCallInfo["sourceArgumentBindings"],
): ResolvedSourceCallInfo {
  return { ...call, sourceArgumentBindings: Object.freeze([...bindings]) };
}
