import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const effectRoot = join(repositoryRoot, "src", "lowering", "effect");

test("value-slot provenance graphs have a bounded transaction owner", () => {
  const flow = readFileSync(
    join(effectRoot, "flow", "value", "slot", "flow.ts"),
    "utf8",
  );
  const batch = readFileSync(
    join(effectRoot, "flow", "value", "slot", "batch.ts"),
    "utf8",
  );

  assert.match(flow, /maximumExactValueSlotRootsPerBatch = 256/u);
  assert.match(flow, /resolveExactValueSlotBatch/u);
  assert.doesNotMatch(flow, /createEffectProvenanceGraphBuilder/u);
  assert.match(batch, /createEffectProvenanceGraphBuilder/u);
  assert.match(batch, /resolveEffectProvenance/u);
  assert.match(batch, /materializeExactValueSlotResolutions/u);
});
