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
  assert.match(source, /createTransitivePredicateIndex/u);
  assert.match(source, /\.contains\.matches\(type\)/u);
  assert.match(
    source,
    /contains\(semantics: SourceFileSemantics, type: Type\): boolean \{\s*containsQueries \+= 1;\s*return cacheFor\(semantics\)\.contains\.matches\(type\)/u,
  );
  assert.doesNotMatch(
    source,
    /return selectedContracts\(semantics, type\)\.length/u,
  );
  assert.doesNotMatch(source, /sourceFile !== semantics\.sourceFile/u);
});

test("interface call transport caches exact file-local queries for the transaction", () => {
  const callTransport = readFileSync(
    join(effectRoot, "flow", "interface", "call-transport.ts"),
    "utf8",
  );
  const transport = readFileSync(
    join(effectRoot, "flow", "interface", "transport.ts"),
    "utf8",
  );

  assert.match(
    callTransport,
    /new WeakMap<Node, Map<Type, boolean>>\(\)/u,
  );
  assert.match(callTransport, /opaqueRelevanceCacheFor/u);
  assert.doesNotMatch(
    callTransport,
    /opaqueInterfaceSourceContainsContracts\([\s\S]{0,160}new Map\(\)/u,
  );
  assert.match(transport, /roots: new WeakMap\(\)/u);
  assert.match(
    transport,
    /state\.roots\.get\(semantics\.sourceFile\)/u,
  );
  assert.doesNotMatch(transport, /state\.roots\.clear\(\)/u);
});
