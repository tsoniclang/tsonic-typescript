import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindArrowFunction,
  KindCallExpression,
  KindFunctionDeclaration,
} from "@tsonic/tsts/target-ast";

import type {
  SourceInvocationContract,
  SourceInvocationFileContract,
  SourceInvocationManifest,
} from "../../../../config/source-invocation-manifest.js";
import { createTargetProgramIndex } from "../../../program-index.js";
import { checkedEffectFixture } from "../../test-support/fixture.test-support.js";
import { createSourceInvocationExtension } from "./source-extension.js";
import { createSourceInvocationFlow } from "./flow.js";

const runtimeSource = `
export function make(): () => Promise<number> {
  return async (): Promise<number> => 1;
}
`;

const applicationSource = `
import { make } from "./runtime.js";
const callback = make();
export const result = await callback();
`;

test("exact file certification covers nested callable bodies", () => {
  const fixture = checkedEffectFixture(
    applicationSource,
    { "/src/runtime.ts": runtimeSource },
    [createSourceInvocationExtension([manifest(true)])],
  );
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  const flow = createSourceInvocationFlow(fixture.source, program);
  const call = program.nodesOfKind(KindCallExpression).find((node) => {
    const expression = fixture.source.ast.as.AsCallExpression(node)?.Expression;
    return expression !== undefined &&
      fixture.source.ast.text(expression) === "make";
  });

  assert.ok(call !== undefined);
  const exported = only(flow.implementationsFor(call) ?? []);
  assert.equal(fixture.source.ast.kind(exported), KindFunctionDeclaration);
  const nested = only(descendantsOfKind(
    fixture.source,
    exported,
    KindArrowFunction,
  ));
  assert.equal(flow.bodyInspectionIsCertified(exported), true);
  assert.equal(flow.bodyInspectionIsCertified(nested), true);
  assert.deepEqual(flow.implementationsFor(call), [exported]);
});

test("body-only certification does not authorize a nested sibling", () => {
  const fixture = checkedEffectFixture(
    applicationSource,
    { "/src/runtime.ts": runtimeSource },
    [createSourceInvocationExtension([manifest(false)])],
  );
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  const flow = createSourceInvocationFlow(fixture.source, program);
  const call = only(program.nodesOfKind(KindCallExpression).filter((node) => {
    const expression = fixture.source.ast.as.AsCallExpression(node)?.Expression;
    return expression !== undefined &&
      fixture.source.ast.text(expression) === "make";
  }));
  const exported = only(flow.implementationsFor(call) ?? []);
  const nested = only(descendantsOfKind(
    fixture.source,
    exported,
    KindArrowFunction,
  ));

  assert.equal(flow.bodyInspectionIsCertified(exported), true);
  assert.equal(flow.bodyInspectionIsCertified(nested), false);
});

test("exact file certification is independent of exported invocation rows", () => {
  const selected = manifest(true);
  const fixture = checkedEffectFixture(
    applicationSource,
    { "/src/runtime.ts": runtimeSource },
    [createSourceInvocationExtension([Object.freeze({
      ...selected,
      contracts: Object.freeze([]),
    })])],
  );
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: true,
    memberDispatch: true,
  });
  const flow = createSourceInvocationFlow(fixture.source, program);
  const exported = only(program.nodesOfKind(KindFunctionDeclaration).filter(
    (node) => fixture.source.ast.text(fixture.source.ast.name(node)) === "make",
  ));
  const nested = only(descendantsOfKind(
    fixture.source,
    exported,
    KindArrowFunction,
  ));

  assert.equal(flow.bodyInspectionIsCertified(exported), true);
  assert.equal(flow.bodyInspectionIsCertified(nested), true);
});

function manifest(exactFile: boolean): SourceInvocationManifest {
  const sourceDigest = createHash("sha256").update(runtimeSource).digest("hex");
  const file: SourceInvocationFileContract = Object.freeze({
    identity: "contract:file:runtime.ts",
    sourcePath: "runtime.ts",
    sourceFileName: "/src/runtime.ts",
    sourceDigest,
    exact: exactFile,
  });
  const contract: SourceInvocationContract = Object.freeze({
    identity: "contract:runtime.ts:make",
    semanticKey: "runtime.ts\0make",
    sourceIdentity: "source:make",
    exportName: "make",
    file,
    exactImplementation: true,
    inputParameters: Object.freeze([]),
    resultOriginParameters: Object.freeze([]),
  });
  return Object.freeze({
    path: "/src/gotots-manifest.json",
    identity: "manifest:source-invocation",
    semanticDigest: "a".repeat(64),
    contractDigest: "b".repeat(64),
    files: Object.freeze([file]),
    contracts: Object.freeze([contract]),
  });
}

function only(nodes: readonly Node[]): Node {
  assert.equal(nodes.length, 1);
  return nodes[0]!;
}

function descendantsOfKind(
  source: TargetSourceProgram,
  root: Node,
  kind: number,
): readonly Node[] {
  const selected: Node[] = [];
  const pending = [...source.ast.children(root)];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (source.ast.kind(node) === kind) {
      selected.push(node);
    }
    pending.push(...source.ast.children(node));
  }
  return Object.freeze(selected);
}
