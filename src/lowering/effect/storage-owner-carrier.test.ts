import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../program-index.js";
import { checkedEffectFixture, visit } from "./effect.test-support.js";
import { collectStorageOwnerCarriers } from "./storage-owner-types.js";

test("indexes nominal owner carriers with bounded graph work", () => {
  const measurements = [16, 32, 64].map(measureCarrierGraph);
  for (let index = 1; index < measurements.length; index += 1) {
    const previous = measurements[index - 1];
    const current = measurements[index];
    assert.ok(previous !== undefined && current !== undefined);
    assert.ok(
      current.operationCount < previous.operationCount * 2.25,
      `carrier work grew ${previous.operationCount} -> ${current.operationCount}`,
    );
  }
});

function measureCarrierGraph(carrierCount: number): {
  readonly operationCount: number;
} {
  const fixture = checkedEffectFixture(sourceFor(carrierCount));
  const declarations = classDeclarations(fixture.source, fixture.sourceFile);
  const owner = declarations.get("Owner");
  const outer = declarations.get(`Carrier${carrierCount - 1}`);
  assert.ok(owner !== undefined && outer !== undefined);
  const index = collectStorageOwnerCarriers(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
    new Set([owner]),
  );
  assert.deepEqual(index.carriers.get(outer), new Set([owner]));
  return { operationCount: index.operationCount };
}

function sourceFor(carrierCount: number): string {
  const carriers: string[] = [];
  for (let index = 0; index < carrierCount; index += 1) {
    const valueType = index === 0 ? "Owner" : `Carrier${index - 1}`;
    carriers.push(
      `class Carrier${index} { constructor(public value: ${valueType}) {} }`,
    );
  }
  return `
type Awaitable<T> = T | PromiseLike<T>;
class Owner {
  constructor(public callback: (() => Awaitable<number>) | undefined) {}
}
${carriers.join("\n")}
`;
}

function classDeclarations(
  source: ReturnType<typeof checkedEffectFixture>["source"],
  root: Node,
): ReadonlyMap<string, Node> {
  const declarations = new Map<string, Node>();
  visit(source, root, (node) => {
    if (source.ast.is.IsClassDeclaration(node)) {
      declarations.set(source.ast.text(source.ast.name(node)), node);
    }
  });
  return declarations;
}
