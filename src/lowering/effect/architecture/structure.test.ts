import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const sourceRoot = join(repositoryRoot, "src");
const effectRoot = join(sourceRoot, "lowering", "effect");

const expectedEffectDirectories = Object.freeze([
  "architecture",
  "closure",
  "flow",
  "inventory",
  "model",
  "planning",
  "provenance",
  "rewrite",
  "test-support",
]);

const expectedFlowDirectories = Object.freeze([
  "aggregate",
  "callable",
  "collection",
  "interface",
  "invocation",
  "object",
  "provider",
  "return",
  "storage",
  "value",
]);

const allowedProductionDependencies = new Map<string, ReadonlySet<string>>([
  ["closure", new Set(["closure", "provenance"])],
  ["flow", new Set([
    "closure",
    "flow",
    "inventory",
    "model",
    "provenance",
  ])],
  ["inventory", new Set(["closure", "inventory", "model", "provenance"])],
  ["model", new Set(["model"])],
  ["planning", new Set(["closure", "flow", "inventory", "model", "planning"])],
  ["provenance", new Set(["provenance"])],
  ["rewrite", new Set(["model", "planning", "rewrite"])],
]);

const externalProductionSurface = new Set([
  "closure/retention.ts",
  "flow/interface/decision.ts",
  "flow/provider/source-extension.ts",
  "planning/plan.ts",
  "planning/summary.ts",
  "rewrite/transform.ts",
]);

test("effect source is nested by semantic owner", () => {
  assert.deepEqual(directoryNames(effectRoot), expectedEffectDirectories);
  assert.deepEqual(regularFileNames(effectRoot), []);
  assert.deepEqual(directoryNames(join(effectRoot, "flow")), expectedFlowDirectories);
  assert.deepEqual(regularFileNames(join(effectRoot, "flow")), []);

  for (const path of sourceFiles(effectRoot)) {
    const effectPath = relativePath(effectRoot, path);
    const segments = effectPath.split("/");
    assert.ok(segments.length >= 2, `${effectPath} is not nested by owner`);
    assert.ok(
      !segments.some((segment) =>
        ["common", "compat", "helper", "legacy", "misc", "util", "v2"].includes(segment)
      ),
      `${effectPath} uses a forbidden catch-all or compatibility directory`,
    );
    assert.ok(
      readFileSync(path, "utf8").split("\n").length <= 600,
      `${effectPath} exceeds the maintained-file limit`,
    );
    if (segments[0] === "test-support") {
      assert.match(effectPath, /\.test-support\.ts$/u);
    }
  }
});

test("effect production imports follow the semantic layer graph", () => {
  let internalImportCount = 0;
  let crossDomainImportCount = 0;
  for (const importer of productionFiles(effectRoot)) {
    const importerPath = relativePath(effectRoot, importer);
    const importerDomain = firstPathSegment(importerPath);
    const allowed = allowedProductionDependencies.get(importerDomain);
    assert.notEqual(allowed, undefined, `${importerPath} has no layer policy`);
    for (const imported of relativeImports(importer)) {
      if (!isWithin(effectRoot, imported)) {
        continue;
      }
      internalImportCount += 1;
      const importedDomain = firstPathSegment(relativePath(effectRoot, imported));
      if (importedDomain !== importerDomain) {
        crossDomainImportCount += 1;
      }
      assert.ok(
        allowed?.has(importedDomain),
        `${importerPath} may not import ${relativePath(effectRoot, imported)}`,
      );
    }
  }
  assert.ok(internalImportCount > 0, "effect import inventory is vacuous");
  assert.ok(crossDomainImportCount > 0, "effect layer graph is vacuous");
});

test("effect internals have a closed external production surface", () => {
  let externalImportCount = 0;
  for (const importer of productionFiles(sourceRoot)) {
    if (isWithin(effectRoot, importer)) {
      continue;
    }
    for (const imported of relativeImports(importer)) {
      if (!isWithin(effectRoot, imported)) {
        continue;
      }
      externalImportCount += 1;
      const importedPath = relativePath(effectRoot, imported);
      assert.ok(
        externalProductionSurface.has(importedPath),
        `${relativePath(sourceRoot, importer)} imports internal effect module ${importedPath}`,
      );
    }
  }
  assert.ok(externalImportCount > 0, "effect external surface inventory is vacuous");
});

test("effect import inventory recognizes every supported import form", () => {
  assert.deepEqual(
    relativeImportSpecifiers(`
import "./side-effect.js";
import value from "../direct.js";
export type { Contract } from "./contract.js";
const deferred = import("../deferred.js");
`),
    ["../deferred.js", "../direct.js", "./contract.js", "./side-effect.js"],
  );
});

test("origin selection consumes the resolver-owned component graph", () => {
  const source = readFileSync(
    join(
      effectRoot,
      "provenance",
      "origin-index.ts",
    ),
    "utf8",
  );

  assert.match(source, /resolutions\.forEachComponentDependency/u);
  assert.match(source, /resolutions\.componentFor/u);
  assert.match(source, /new Map<number, Set<number>>\(\)/u);
  assert.doesNotMatch(source, /graph\.edges|condenseEffectProvenance/u);
  assert.doesNotMatch(source, /emptyComponentSets/u);
  assert.doesNotMatch(source, /graph\.vertices\.map/u);

  for (const consumer of [
    join(
      effectRoot,
      "flow",
      "invocation",
      "indirect",
      "origin-selection.ts",
    ),
    join(effectRoot, "flow", "callable", "provenance-flow.ts"),
    join(effectRoot, "flow", "return", "provenance.ts"),
    join(effectRoot, "flow", "value", "slot", "resolution.ts"),
  ]) {
    const consumerSource = readFileSync(consumer, "utf8");
    assert.match(consumerSource, /createEffectProvenanceOriginIndex/u);
    assert.doesNotMatch(consumerSource, /\.origins\.filter/u);
    assert.doesNotMatch(consumerSource, /\.originEvidence/u);
  }
  const valueSlotFlow = readFileSync(
    join(effectRoot, "flow", "value", "slot", "flow.ts"),
    "utf8",
  );
  assert.match(valueSlotFlow, /materializeExactValueSlotResolutions/u);
  assert.doesNotMatch(valueSlotFlow, /\.originEvidence/u);
});

test("provenance condensation uses compact sparse storage", () => {
  const condensation = readFileSync(
    join(effectRoot, "provenance", "scc.ts"),
    "utf8",
  );
  const resolution = readFileSync(
    join(effectRoot, "provenance", "resolution.ts"),
    "utf8",
  );

  assert.match(condensation, /new Uint32Array\(vertices\.length\)/u);
  assert.match(condensation, /componentCount/u);
  assert.doesNotMatch(condensation, /number\[\]\s*=>\s*\[\]/u);
  assert.doesNotMatch(condensation, /readonly \(readonly EffectProvenanceVertex\[\]\)\[\]/u);
  assert.match(resolution, /new Map<number, Set<number>>\(\)/u);
  assert.doesNotMatch(resolution, /emptySets\(componentCount\)/u);
  assert.doesNotMatch(resolution, /emptyLists/u);
});

test("return-local topology is demand-driven from source references", () => {
  const source = readFileSync(
    join(effectRoot, "flow", "return", "local", "topology.ts"),
    "utf8",
  );

  assert.match(source, /referencesToDeclaration/u);
  assert.doesNotMatch(source, /nodesOfKind\(KindVariableDeclaration\)/u);
});

test("return provenance resolves only queried roots", () => {
  const source = readFileSync(
    join(effectRoot, "flow", "return", "provenance.ts"),
    "utf8",
  );

  assert.match(source, /queryVertices = new Map<Node, EffectProvenanceVertex>/u);
  assert.match(source, /return resolvedFor\(vertex\)/u);
  assert.match(source, /context\.expressions\.clear\(\)/u);
  assert.match(source, /context\.declarations\.clear\(\)/u);
  assert.doesNotMatch(source, /new Set\(queryStates\.values\(\)\)/u);
  assert.doesNotMatch(source, /state\.resolution/u);
  assert.doesNotMatch(source, /expressionResolutions/u);
});

test("callable, return, and consumer flows share one storage-owner analysis", () => {
  const plan = readFileSync(
    join(effectRoot, "planning", "plan.ts"),
    "utf8",
  );
  const fields = readFileSync(
    join(effectRoot, "flow", "storage", "fields.ts"),
    "utf8",
  );
  const returns = readFileSync(
    join(effectRoot, "flow", "return", "storage.ts"),
    "utf8",
  );
  const consumer = readFileSync(
    join(effectRoot, "flow", "return", "consumer", "graph.ts"),
    "utf8",
  );
  const consumerFacts = readFileSync(
    join(effectRoot, "flow", "return", "consumer", "facts.ts"),
    "utf8",
  );

  assert.match(plan, /createClosedStorageOwnerAnalysis\(source, program\)/u);
  assert.match(plan, /collectCallableFields\(source, program, storageOwners\)/u);
  assert.match(fields, /storageOwners\.topology\(planningObserver\)/u);
  assert.match(returns, /storageOwners\.topology\(planningObserver\)/u);
  assert.match(plan, /storageOwners,/u);
  assert.match(consumer, /closedStorageOwners: ReadonlySet<Node>/u);
  assert.doesNotMatch(fields, /createStorageOwnerTopology/u);
  assert.doesNotMatch(returns, /createStorageOwnerTopology/u);
  assert.doesNotMatch(consumerFacts, /collectClosedStorageOwners/u);
});

test("result-consumer provenance is rooted only at selected queries", () => {
  const graph = readFileSync(
    join(effectRoot, "flow", "return", "consumer", "graph.ts"),
    "utf8",
  );

  assert.match(graph, /for \(const call of queries\)/u);
  assert.doesNotMatch(
    graph,
    /for \(const call of program\.nodesOfKind\(KindCallExpression\)\)/u,
  );
});

test("callable value finalization severs transient census state", () => {
  const source = readFileSync(
    join(effectRoot, "flow", "callable", "value-inputs.ts"),
    "utf8",
  );

  assert.match(source, /const evidence = collectCallableValueInputEvidence\(/u);
  assert.match(source, /return finalizeCallableValueInputs\(/u);
  assert.match(source, /function collectCallableValueInputEvidence\(/u);
  assert.match(source, /function finalizeCallableValueInputs\(/u);
  assert.doesNotMatch(
    source.slice(source.indexOf("function finalizeCallableValueInputs(")),
    /classReferences|propertyReferences|constructorClasses/u,
  );
});

test("effect flow finalizers retain only settled query capabilities", () => {
  const callableConstruction = readFileSync(
    join(effectRoot, "flow", "callable", "provenance-flow.ts"),
    "utf8",
  );
  const callableFinalization = readFileSync(
    join(
      effectRoot,
      "flow",
      "callable",
      "provenance",
      "finalization.ts",
    ),
    "utf8",
  );
  const indirectConstruction = readFileSync(
    join(effectRoot, "flow", "invocation", "indirect.ts"),
    "utf8",
  );
  const indirectFinalization = readFileSync(
    join(
      effectRoot,
      "flow",
      "invocation",
      "indirect",
      "finalization.ts",
    ),
    "utf8",
  );
  const plan = readFileSync(
    join(effectRoot, "planning", "plan.ts"),
    "utf8",
  );

  assert.match(callableConstruction, /finalizeGraphCallableValueFlow\(/u);
  assert.doesNotMatch(
    callableFinalization,
    /CallableContext|EffectProvenanceGraphBuilder|resolveEffectProvenance|collectUnsafeCallableUses/u,
  );
  assert.match(indirectConstruction, /finalizeExactIndirectInvocationFacts\(/u);
  assert.doesNotMatch(
    indirectFinalization,
    /TargetSourceProgram|ExactIndirectInvocationDomain|ExactIndirectInvocationRound|settleExactIndirectInvocationAnalysis|projectionCandidates|refine\s*\(/u,
  );
  assert.match(plan, /preliminaryAnalysis\.finalize\(\)/u);
  assert.match(plan, /\)\.finalize\(\)/u);
});

test("callable result projection owns one value-slot graph", () => {
  const flow = readFileSync(
    join(effectRoot, "flow", "callable", "provenance-flow.ts"),
    "utf8",
  );
  const projections = readFileSync(
    join(effectRoot, "flow", "callable", "projection-inputs.ts"),
    "utf8",
  );
  const results = readFileSync(
    join(effectRoot, "flow", "callable", "result-inputs.ts"),
    "utf8",
  );

  assert.doesNotMatch(flow, /createExactValueSlotFlow/u);
  assert.match(projections, /createExactValueSlotFlow/u);
  assert.match(results, /resultOriginsForCall/u);
});

test("every value-slot analysis requires an explicit semantic root domain", () => {
  const flow = readFileSync(
    join(effectRoot, "flow", "value", "slot", "flow.ts"),
    "utf8",
  );

  assert.match(flow, /rootExpressions: readonly Node\[\]/u);
  assert.doesNotMatch(
    flow,
    /rootExpressions: readonly Node\[\]\s*=\s*Object\.freeze/u,
  );
});

function directoryNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
}

function regularFileNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function productionFiles(root: string): string[] {
  return sourceFiles(root).filter((path) =>
    !path.endsWith(".test.ts") && !path.endsWith(".test-support.ts")
  );
}

function relativeImports(importer: string): string[] {
  const source = readFileSync(importer, "utf8");
  return relativeImportSpecifiers(source).map((specifier) =>
    normalize(join(dirname(importer), `${specifier.slice(0, -3)}.ts`))
  );
}

function relativeImportSpecifiers(source: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bfrom\s+["'](\.\.?\/[^"']+\.js)["']/gu,
    /\bimport\s*\(\s*["'](\.\.?\/[^"']+\.js)["']\s*\)/gu,
    /\bimport\s+["'](\.\.?\/[^"']+\.js)["']/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) {
        throw new Error("relative import has no specifier");
      }
      imports.push(specifier);
    }
  }
  return imports.sort(compareCodeUnits);
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== "" && !pathFromRoot.startsWith("../");
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function firstPathSegment(path: string): string {
  const segment = path.split("/")[0];
  if (segment === undefined || segment.length === 0) {
    throw new Error(`path has no semantic owner: ${path}`);
  }
  return segment;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
