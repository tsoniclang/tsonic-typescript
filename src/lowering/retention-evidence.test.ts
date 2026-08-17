import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";

import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
} from "./occurrence.js";
import { createOptimizationRetentionLedger } from "./retention-evidence.js";
import {
  checkedScalarFixture,
  fixtureSourceIdentityFor,
  visit,
} from "./scalar/scalar.test-support.js";

test("retains exact counts with only bounded canonical examples", () => {
  const fixture = checkedScalarFixture(
    `export const values = [${Array.from({ length: 16 }, (_, index) => index).join(",")}];`,
  );
  const nodes: Node[] = [];
  visit(fixture.source, fixture.sourceFile, (node) => {
    if (fixture.source.ast.is.IsNumericLiteral(node)) {
      nodes.push(node);
    }
  });
  assert.equal(nodes.length, 16);
  const identityFor = fixtureSourceIdentityFor(fixture.source);
  const ledger = createOptimizationRetentionLedger(
    fixture.source,
    identityFor,
    ["retained"] as const,
  );
  for (let repetition = 0; repetition < 100; repetition += 1) {
    for (const node of [...nodes].reverse()) {
      ledger.record("retained", node);
    }
  }
  const summary = ledger.seal();
  const expected = nodes
    .map((node) => optimizationOccurrence(fixture.source, node, identityFor))
    .sort(compareOptimizationOccurrences)[0];

  assert.equal(ledger.count, 1_600);
  assert.equal(summary[0]?.count, 1_600);
  assert.equal(summary[0]?.examples.length, 8);
  assert.deepEqual(summary[0]?.examples[0], expected);
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary[0]?.examples));
  assert.throws(() => ledger.record("retained", nodes[0]!), /already sealed/u);
});

test("rejects reasons outside the closed owner", () => {
  const fixture = checkedScalarFixture("export const value = 1;");
  const ledger = createOptimizationRetentionLedger(
    fixture.source,
    fixtureSourceIdentityFor(fixture.source),
    ["known"] as const,
  );
  assert.throws(
    () => ledger.record("unknown" as "known", fixture.sourceFile),
    /unknown retention reason/u,
  );
});
