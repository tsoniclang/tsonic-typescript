import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import {
  checkedEffectFixture,
  visit,
} from "../../test-support/fixture.test-support.js";
import { compareOptimizationOccurrences } from "../../../occurrence.js";
import { createInterfaceContractBoundaryLedger } from "./boundary.js";

test("records duplicate boundary occurrences once with bounded evidence", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
export const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
`);
  const nodes: Node[] = [];
  visit(fixture.source, fixture.sourceFile, (node) => {
    if (fixture.source.documents.occurrenceFor(node).kind === "authored") {
      nodes.push(node);
    }
  });
  const contract = nodes.find((node) =>
    fixture.source.ast.kindName(node) === "KindMethodSignature"
  );
  assert.ok(contract !== undefined);
  const occurrences = nodes.slice(-12);
  assert.equal(occurrences.length, 12);
  const ledger = createInterfaceContractBoundaryLedger(
    fixture.source,
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );

  for (const occurrence of occurrences) {
    ledger.mark(contract, "unproven-value-origin", occurrence);
  }
  ledger.mark(contract, "unproven-value-origin", occurrences[0]!);

  assert.equal(ledger.has(contract), true);
  const causes = ledger.causesFor([contract]);
  assert.equal(causes.length, 1);
  assert.equal(causes[0]?.reason, "unproven-value-origin");
  assert.equal(causes[0]?.occurrenceCount, 12);
  assert.equal(causes[0]?.examples.length, 8);
  assert.deepEqual(
    causes[0]?.examples,
    [...causes[0]?.examples ?? []].sort(compareOptimizationOccurrences),
  );
  assert.deepEqual(Object.keys(causes[0] ?? {}).sort(), [
    "examples",
    "occurrenceCount",
    "reason",
  ]);
});

test("unions overlapping contract occurrences exactly", () => {
  const fixture = checkedEffectFixture(`
type Awaitable<T> = T | PromiseLike<T>;
interface Reader { Read(): Awaitable<number>; }
interface Writer { Write(): Awaitable<number>; }
export const first = 1;
export const second = 2;
`);
  const nodes: Node[] = [];
  visit(fixture.source, fixture.sourceFile, (node) => nodes.push(node));
  const contracts = nodes.filter((node) =>
    fixture.source.ast.kindName(node) === "KindMethodSignature"
  );
  assert.equal(contracts.length, 2);
  const occurrences = nodes.filter((node) =>
    fixture.source.documents.occurrenceFor(node).kind === "authored"
  ).slice(-3);
  assert.equal(occurrences.length, 3);
  const ledger = createInterfaceContractBoundaryLedger(
    fixture.source,
    (sourceFile) => fixture.source.documents.forFile(sourceFile).identity,
  );

  ledger.mark(contracts[0]!, "opaque-call-transport", occurrences[0]!);
  ledger.mark(contracts[1]!, "opaque-call-transport", occurrences[0]!);
  ledger.mark(contracts[1]!, "opaque-call-transport", occurrences[1]!);
  ledger.mark(contracts[0]!, "unproven-value-origin", occurrences[2]!);

  assert.deepEqual(
    ledger.causesFor(contracts).map((cause) => ({
      reason: cause.reason,
      occurrenceCount: cause.occurrenceCount,
    })),
    [
      { reason: "unproven-value-origin", occurrenceCount: 1 },
      { reason: "opaque-call-transport", occurrenceCount: 2 },
    ],
  );
});
