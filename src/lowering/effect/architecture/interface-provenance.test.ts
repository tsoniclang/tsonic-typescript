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

test("interface origins share one exact contract-labelled graph", () => {
  const resolution = readFileSync(
    join(effectRoot, "flow", "interface", "ingress", "resolution.ts"),
    "utf8",
  );
  const graph = readFileSync(
    join(
      effectRoot,
      "flow",
      "interface",
      "ingress",
      "resolution",
      "contract-graph.ts",
    ),
    "utf8",
  );
  const contractSet = readFileSync(
    join(
      effectRoot,
      "flow",
      "interface",
      "ingress",
      "resolution",
      "contract-set.ts",
    ),
    "utf8",
  );
  const requirements = readFileSync(
    join(effectRoot, "flow", "interface", "ingress", "requirements.ts"),
    "utf8",
  );

  assert.match(resolution, /createInterfaceOriginContractDomain\(contracts\)/u);
  assert.match(resolution, /createInterfaceOriginContractGraph\(domain\)/u);
  assert.match(resolution, /builder\.activate\(state\.vertex, contracts\)/u);
  assert.match(resolution, /drainOriginExpansions\(shared\)/u);
  assert.doesNotMatch(
    resolution,
    /createEffectProvenanceGraphBuilder|resolveEffectProvenance/u,
  );
  assert.match(
    contractSet,
    /type InterfaceOriginContractSet = Uint32Array/u,
  );
  assert.match(contractSet, /select\([\s\S]*predicate/u);
  assert.match(graph, /propagateUnsent/u);
  assert.match(graph, /reason === "opaque-call-transport"/u);
  assert.doesNotMatch(graph, /Map<Node, Map<Node/u);
  assert.doesNotMatch(resolution, /const resolved = new Map/u);
  assert.match(resolution, /consume\(value, contract, result\)/u);
  assert.equal(
    requirements.match(/resolveInterfaceOrigins\(/gu)?.length,
    1,
  );
});

test("provenance resolution owns one compact component topology", () => {
  const adjacency = readFileSync(
    join(effectRoot, "provenance", "component-adjacency.ts"),
    "utf8",
  );
  const resolution = readFileSync(
    join(effectRoot, "provenance", "resolution.ts"),
    "utf8",
  );
  const origins = readFileSync(
    join(effectRoot, "provenance", "origin-index.ts"),
    "utf8",
  );

  assert.match(adjacency, /Uint32Array/u);
  assert.match(adjacency, /compactSorted/u);
  assert.match(resolution, /createEffectProvenanceComponentAdjacency/u);
  assert.match(origins, /componentDependencyCount/u);
  assert.match(origins, /componentDependency/u);
  assert.match(origins, /componentDependent/u);
  assert.doesNotMatch(origins, /createEffectProvenanceComponentAdjacency/u);
  assert.doesNotMatch(resolution, /Map<number, Set<number>>/u);
  assert.doesNotMatch(origins, /Map<number, Set<number>>/u);
});

test("interface origin facts cache exact checked type-contract queries", () => {
  const facts = readFileSync(
    join(effectRoot, "flow", "interface", "ingress", "origin-facts.ts"),
    "utf8",
  );
  const implementations = readFileSync(
    join(effectRoot, "flow", "interface", "implementations.ts"),
    "utf8",
  );

  assert.match(facts, /new WeakMap<Node, TypeResults>\(\)/u);
  assert.match(facts, /cache\.get\(semantics\.sourceFile\)/u);
  assert.match(facts, /contracts\.get\(contract\)/u);
  assert.match(facts, /expressions\.get\(value\)/u);
  assert.match(
    implementations,
    /attemptedTypeContracts\.get\(sourceType\)\?\.get\(contract\)/u,
  );
  assert.match(
    implementations,
    /recordAttempt\(attemptedTypeContracts, sourceType, contract, false\)/u,
  );
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

  const opaqueIndex = readFileSync(
    join(
      effectRoot,
      "flow",
      "interface",
      "opaque-exposure",
      "index.ts",
    ),
    "utf8",
  );

  assert.match(callTransport, /createOpaqueInterfaceExposureIndex/u);
  assert.match(callTransport, /opaqueExposure\.retainInputs/u);
  assert.doesNotMatch(
    callTransport,
    /analyzeOpaqueInterfaceInputs|new Map<Type, boolean>/u,
  );
  assert.match(opaqueIndex, /new WeakMap<Node, OpaqueInterfaceExposureFileCache>/u);
  assert.match(opaqueIndex, /targets\.get\(selectedTarget\)/u);
  assert.match(opaqueIndex, /replayPlan/u);
  assert.match(transport, /roots: new WeakMap\(\)/u);
  assert.match(
    transport,
    /state\.roots\.get\(semantics\.sourceFile\)/u,
  );
  assert.doesNotMatch(transport, /state\.roots\.clear\(\)/u);
});
