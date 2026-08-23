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

test("value-slot result identity stays separate from callable contracts", () => {
  const model = readFileSync(
    join(effectRoot, "flow", "value", "slot", "model.ts"),
    "utf8",
  );
  const flow = readFileSync(
    join(effectRoot, "flow", "value", "slot", "flow.ts"),
    "utf8",
  );
  const engine = readFileSync(
    join(effectRoot, "flow", "value", "slot", "engine.ts"),
    "utf8",
  );
  const callableResults = readFileSync(
    join(effectRoot, "flow", "callable", "result-inputs.ts"),
    "utf8",
  );
  const returnProjection = readFileSync(
    join(effectRoot, "flow", "return", "projection.ts"),
    "utf8",
  );

  assert.match(model, /readonly resultOwner: Node/u);
  assert.match(model, /readonly contracts: readonly Node\[\]/u);
  assert.match(engine, /resultSources\.get\(source\.resultOwner\)/u);
  assert.match(engine, /contracts: source\.contracts/u);
  assert.doesNotMatch(flow, /source\.contracts \?\? \[source\.declaration\]/u);
  assert.doesNotMatch(engine, /source\.contracts \?\? \[source\.declaration\]/u);
  assert.match(callableResults, /resultOwner: call/u);
  assert.match(
    returnProjection,
    /resultOwner: declarations\.length === 1 \? declaration : call/u,
  );
});
