import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
export const sourceRoot = join(repositoryRoot, "src");
export const effectRoot = join(sourceRoot, "lowering", "effect");

export const expectedEffectDirectories = Object.freeze([
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

export const expectedFlowDirectories = Object.freeze([
  "aggregate",
  "callable",
  "collection",
  "interface",
  "invocation",
  "object",
  "provider",
  "return",
  "settlement",
  "source-invocation",
  "storage",
  "value",
]);

export const allowedProductionDependencies = new Map<
  string,
  ReadonlySet<string>
>([
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

export const externalProductionSurface = new Set([
  "closure/retention.ts",
  "flow/interface/decision.ts",
  "flow/provider/source-extension.ts",
  "flow/source-invocation/source-extension.ts",
  "planning/plan.ts",
  "planning/summary.ts",
  "rewrite/transform.ts",
]);

export function directoryNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
}

export function regularFileNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
}

export function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

export function productionFiles(root: string): string[] {
  return sourceFiles(root).filter((path) =>
    !path.endsWith(".test.ts") && !path.endsWith(".test-support.ts")
  );
}

export function relativeImports(importer: string): string[] {
  const source = readFileSync(importer, "utf8");
  return relativeImportSpecifiers(source).map((specifier) =>
    normalize(join(dirname(importer), `${specifier.slice(0, -3)}.ts`))
  );
}

export function relativeImportSpecifiers(source: string): string[] {
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

export function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== "" && !pathFromRoot.startsWith("../");
}

export function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

export function firstPathSegment(path: string): string {
  const segment = path.split("/")[0];
  if (segment === undefined || segment.length === 0) {
    throw new Error(`path has no semantic owner: ${path}`);
  }
  return segment;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
