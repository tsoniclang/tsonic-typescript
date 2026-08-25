import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const resolutionRoot = join(
  repositoryRoot,
  "src",
  "lowering",
  "effect",
  "flow",
  "interface",
  "ingress",
  "resolution",
);

test("interface origin transactions retain only their live work frontier", () => {
  const resolution = readFileSync(join(resolutionRoot, "..", "resolution.ts"), "utf8");
  const graph = readFileSync(join(resolutionRoot, "contract-graph.ts"), "utf8");
  const queue = readFileSync(join(resolutionRoot, "work-queue.ts"), "utf8");

  assert.match(resolution, /createInterfaceOriginWorkQueue<OriginState>/u);
  assert.match(graph, /createInterfaceOriginWorkQueue<number>/u);
  assert.doesNotMatch(resolution, /pending\.push|next < context\.pending\.length/u);
  assert.doesNotMatch(graph, /pending\.push|next < pending\.length/u);
  assert.match(queue, /entries\[head\] = undefined/u);
  assert.match(queue, /highWaterMark/u);
  assert.doesNotMatch(graph, /contracts\.slice\(\)/u);
});
