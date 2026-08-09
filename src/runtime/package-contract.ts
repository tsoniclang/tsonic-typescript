import { readFileSync } from "node:fs";

import type { TargetRuntimeReference } from "@tsonic/target-api";

export const typeScriptRuntimeModule = "@tsonic/typescript-runtime";

interface TypeScriptRuntimePackageContract {
  readonly name: typeof typeScriptRuntimeModule;
  readonly version: string;
}

const packageContract = readPackageContract();

export function typeScriptRuntimeReference(): TargetRuntimeReference {
  return Object.freeze({
    kind: "npm-package",
    include: packageContract.name,
    version: packageContract.version,
  });
}

function readPackageContract(): TypeScriptRuntimePackageContract {
  const packageUrl = import.meta.resolve(`${typeScriptRuntimeModule}/package.json`);
  const document: unknown = JSON.parse(readFileSync(new URL(packageUrl), "utf8"));
  if (!isRecord(document)) {
    throw new Error("TypeScript runtime package metadata must be an object");
  }
  const name = document["name"];
  const version = document["version"];
  if (name !== typeScriptRuntimeModule) {
    throw new Error(
      `TypeScript runtime package name '${String(name)}' does not match '${typeScriptRuntimeModule}'`,
    );
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("TypeScript runtime package version must be a non-empty string");
  }
  return Object.freeze({ name, version });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
