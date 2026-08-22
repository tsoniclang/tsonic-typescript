import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../../program-index.js";
import { checkedEffectFixture, visit } from "../../test-support/fixture.test-support.js";
import {
  collectStorageOwnerCarriers,
  ownersWithinStorageType,
} from "./owner-types.js";

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

test("retains only positive immutable owner memberships", () => {
  const fixture = checkedEffectFixture(`
class Owner {
  constructor(public callback: (() => number) | undefined) {}
}
class Unrelated { value = 1; }
let ownerValue!: Owner;
let unrelatedValue!: Unrelated;
`);
  const declarations = classDeclarations(fixture.source, fixture.sourceFile);
  const owner = declarations.get("Owner");
  const ownerValue = namedVariable(fixture.source, fixture.sourceFile, "ownerValue");
  const unrelatedValue = namedVariable(
    fixture.source,
    fixture.sourceFile,
    "unrelatedValue",
  );
  assert.ok(owner !== undefined && ownerValue !== undefined && unrelatedValue !== undefined);
  const carriers = collectStorageOwnerCarriers(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
    new Set([owner]),
  ).carriers;
  const cache = new Map();
  const ownerSemantics = fixture.source.semantics.forNode(ownerValue);
  const ownerType = ownerSemantics.types.expressionType(ownerValue);
  const unrelatedSemantics = fixture.source.semantics.forNode(unrelatedValue);
  const unrelatedType = unrelatedSemantics.types.expressionType(unrelatedValue);
  assert.ok(ownerType !== undefined && unrelatedType !== undefined);

  const firstEmpty = ownersWithinStorageType(
    unrelatedSemantics,
    unrelatedType,
    carriers,
    cache,
  );
  const secondEmpty = ownersWithinStorageType(
    unrelatedSemantics,
    unrelatedType,
    carriers,
    cache,
  );
  assert.equal(firstEmpty, secondEmpty);
  assert.equal(cache.size, 0);

  const carried = ownersWithinStorageType(
    ownerSemantics,
    ownerType,
    carriers,
    cache,
  );
  assert.equal(carried.length, 1);
  assert.equal(carried[0], owner);
  assert.equal(Object.isFrozen(carried), true);
  assert.equal(cache.size, 1);
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
  const outerCarriers = index.carriers.get(outer);
  assert.ok(outerCarriers !== undefined);
  assert.equal(outerCarriers.length, 1);
  assert.equal(outerCarriers[0], owner);
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

function namedVariable(
  source: ReturnType<typeof checkedEffectFixture>["source"],
  root: Node,
  expected: string,
): Node | undefined {
  let match: Node | undefined;
  visit(source, root, (node) => {
    if (
      match === undefined &&
      source.ast.is.IsVariableDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === expected
    ) {
      match = source.ast.name(node);
    }
  });
  return match;
}
