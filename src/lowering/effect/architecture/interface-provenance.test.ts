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

test("interface origin decisions query compact boundary reasons", () => {
  const source = readFileSync(
    join(effectRoot, "flow", "interface", "ingress", "resolution.ts"),
    "utf8",
  );

  assert.match(source, /hasBoundaryReason\("opaque-call-transport"\)/u);
  assert.doesNotMatch(source, /\.boundaries\.(some|find|filter)/u);
});

test("interface implementation forwarding consumes the selected closure profile", () => {
  const source = readFileSync(
    join(
      effectRoot,
      "flow",
      "interface",
      "ingress",
      "implementation-inputs.ts",
    ),
    "utf8",
  );

  assert.match(
    source,
    /isModuleForwardingReference\(source, reference\)[\s\S]*cooperativeEffects === "closed-program"/u,
  );
  assert.doesNotMatch(
    source,
    /isModuleForwardingReference\(source, reference\)[\s\S]{0,80}return false/u,
  );
});

test("interface type relevance is cached per checked source file", () => {
  const source = readFileSync(
    join(effectRoot, "flow", "interface", "relevance.ts"),
    "utf8",
  );

  assert.match(
    source,
    /new WeakMap<Node, InterfaceContractRelevanceCache>\(\)/u,
  );
  assert.match(source, /caches\.get\(semantics\.sourceFile\)/u);
  assert.match(source, /createTransitiveSetIndex/u);
  assert.match(source, /\.contracts\.valuesFor\(type\)/u);
  assert.doesNotMatch(source, /function collectContracts/u);
  assert.doesNotMatch(source, /sourceFile !== semantics\.sourceFile/u);
});
