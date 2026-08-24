import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import { createTargetProgramIndex } from "../../../program-index.js";
import { checkedEffectFixture, visit } from "../../test-support/fixture.test-support.js";
import {
  collectStorageOwnerCarriers,
  ownersWithinStorageType,
  storageOwnerMembershipContains,
  universalStorageOwnerMembership,
} from "./owner-types.js";
import { createStorageOwnerTopology } from "./owner-topology.js";

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

test("retains positive memberships without a negative-result ledger", () => {
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
  const unrelated = declarations.get("Unrelated");
  const ownerValue = namedVariable(fixture.source, fixture.sourceFile, "ownerValue");
  const unrelatedValue = namedVariable(
    fixture.source,
    fixture.sourceFile,
    "unrelatedValue",
  );
  assert.ok(
    owner !== undefined &&
    unrelated !== undefined &&
    ownerValue !== undefined &&
    unrelatedValue !== undefined,
  );
  const carrierIndex = collectStorageOwnerCarriers(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
    new Set([owner]),
  );
  const { carriers } = carrierIndex;
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
    carrierIndex.owners,
  );
  const secondEmpty = ownersWithinStorageType(
    unrelatedSemantics,
    unrelatedType,
    carriers,
    cache,
    carrierIndex.owners,
  );
  assert.equal(firstEmpty, secondEmpty);
  assert.equal(cache.size, 0);

  const carried = ownersWithinStorageType(
    ownerSemantics,
    ownerType,
    carriers,
    cache,
    carrierIndex.owners,
  );
  assert.equal(carried.kind, "sparse");
  assert.equal(carried.kind === "sparse" ? carried.owners.length : 0, 1);
  assert.equal(carried.kind === "sparse" ? carried.owners[0] : undefined, owner);
  assert.equal(Object.isFrozen(carried), true);
  assert.equal(
    carried.kind === "sparse" && Object.isFrozen(carried.owners),
    true,
  );
  assert.equal(cache.size, 1);

  const emptyDomainCache = new Map();
  const emptyDomain = ownersWithinStorageType(
    ownerSemantics,
    ownerType,
    new Map(),
    emptyDomainCache,
    [],
  );
  assert.equal(emptyDomain.kind, "empty");
  assert.equal(emptyDomainCache.size, 0);
});

test("compresses opaque carrier closure without a Cartesian owner graph", () => {
  const measurements = [8, 16, 32].map(measureOpaqueCarrierGraph);
  for (let index = 1; index < measurements.length; index += 1) {
    const previous = measurements[index - 1];
    const current = measurements[index];
    assert.ok(previous !== undefined && current !== undefined);
    assert.ok(
      current.operationCount < previous.operationCount * 2.5,
      `opaque carrier work grew ${previous.operationCount} -> ${current.operationCount}`,
    );
  }
});

test("retains only positive storage-owner topology rows", () => {
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
  const unrelated = declarations.get("Unrelated");
  const ownerValue = namedVariable(fixture.source, fixture.sourceFile, "ownerValue");
  const unrelatedValue = namedVariable(
    fixture.source,
    fixture.sourceFile,
    "unrelatedValue",
  );
  assert.ok(
    owner !== undefined &&
    unrelated !== undefined &&
    ownerValue !== undefined &&
    unrelatedValue !== undefined,
  );
  const program = createTargetProgramIndex(fixture.source, {
    bindingWrites: false,
    memberDispatch: false,
  });

  const topology = createStorageOwnerTopology(
    fixture.source,
    program,
    new Set([owner]),
  );

  assert.equal(
    topology.valueFlows.some((flow) => flow.node === ownerValue),
    true,
  );
  assert.equal(
    topology.valueFlows.some((flow) => flow.node === unrelatedValue),
    false,
  );
  assert.equal(Object.isFrozen(topology.valueFlows), true);
  assert.equal(topology.covers(fixture.source, program, new Set([owner])), true);
  assert.equal(topology.covers(fixture.source, program, new Set()), true);
  assert.equal(
    topology.covers(fixture.source, program, new Set([unrelated])),
    false,
  );
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
  assert.equal(storageOwnerMembershipContains(outerCarriers, owner), true);
  return { operationCount: index.operationCount };
}

function measureOpaqueCarrierGraph(size: number): {
  readonly operationCount: number;
} {
  const fixture = checkedEffectFixture(opaqueCarrierSourceFor(size));
  const declarations = classDeclarations(fixture.source, fixture.sourceFile);
  const owners = new Set<Node>();
  for (let index = 0; index < size; index += 1) {
    const owner = declarations.get(`Owner${index}`);
    assert.ok(owner !== undefined);
    owners.add(owner);
  }
  const index = collectStorageOwnerCarriers(
    fixture.source,
    createTargetProgramIndex(fixture.source, {
      bindingWrites: false,
      memberDispatch: false,
    }),
    owners,
  );
  assert.equal(index.owners.length, size);
  assert.equal(Object.isFrozen(index.owners), true);
  assert.equal(Object.isFrozen(universalStorageOwnerMembership), true);
  for (let opaque = 0; opaque < size; opaque += 1) {
    const declaration = declarations.get(`Opaque${opaque}`);
    assert.ok(declaration !== undefined);
    assert.equal(index.carriers.get(declaration), universalStorageOwnerMembership);
  }
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

function opaqueCarrierSourceFor(size: number): string {
  return [
    ...Array.from(
      { length: size },
      (_, index) => `class Owner${index} {}`,
    ),
    ...Array.from(
      { length: size },
      (_, index) => `class Opaque${index} { value: any; }`,
    ),
  ].join("\n");
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
