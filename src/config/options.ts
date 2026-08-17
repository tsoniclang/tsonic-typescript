import type { TargetSelection } from "@tsonic/target-api";

import {
  canonicalTypeScriptOptimizationProfile,
  createTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfile,
} from "../lowering/profile.js";

export interface TypeScriptAstPrinterOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
}

export interface TypeScriptTargetOptions {
  readonly printer: TypeScriptAstPrinterOptions;
  readonly optimizations: TypeScriptOptimizationProfile;
}

export function readTypeScriptTargetOptions(
  target: TargetSelection,
): TypeScriptTargetOptions {
  const options = target.options;
  if (options === undefined) {
    throw new Error("TypeScript target options require a printer configuration");
  }
  rejectUnknownKeys(
    options,
    new Set(["printer", "optimizations"]),
    "TypeScript target options",
  );
  const printer = options["printer"];
  if (!isRecord(printer)) {
    throw new Error("TypeScript target option 'printer' must be an object");
  }
  rejectUnknownKeys(
    printer,
    new Set(["executable", "arguments"]),
    "TypeScript target printer",
  );
  const executable = printer["executable"];
  if (typeof executable !== "string" || executable.length === 0) {
    throw new Error(
      "TypeScript target printer 'executable' must be a non-empty string",
    );
  }
  const rawArguments = printer["arguments"];
  if (rawArguments !== undefined && !Array.isArray(rawArguments)) {
    throw new Error("TypeScript target printer 'arguments' must be an array");
  }
  const arguments_ = rawArguments === undefined
    ? []
    : rawArguments.map((argument, index) => {
      if (typeof argument !== "string") {
        throw new Error(
          `TypeScript target printer argument ${index} must be a string`,
        );
      }
      return argument;
    });
  const optimizations = readOptimizationOptions(options["optimizations"]);
  return Object.freeze({
    printer: Object.freeze({
      executable,
      arguments: Object.freeze(arguments_),
    }),
    optimizations,
  });
}

function readOptimizationOptions(value: unknown): TypeScriptOptimizationProfile {
  if (value === undefined) {
    return canonicalTypeScriptOptimizationProfile();
  }
  if (!isRecord(value)) {
    throw new Error("TypeScript target option 'optimizations' must be an object");
  }
  rejectUnknownKeys(
    value,
    new Set([
      "pointerFlows",
      "scalarProjections",
      "representationProjections",
      "cooperativeEffects",
      "interfaceDispatch",
    ]),
    "TypeScript target optimizations",
  );
  return createTypeScriptOptimizationProfile({
    pointerFlows: readClosedChoice(
      value["pointerFlows"],
      "pointerFlows",
      "location",
    ),
    scalarProjections: readClosedChoice(
      value["scalarProjections"],
      "scalarProjections",
      "preserve",
    ),
    representationProjections: readClosedChoice(
      value["representationProjections"],
      "representationProjections",
      "preserve",
    ),
    cooperativeEffects: readClosedChoice(
      value["cooperativeEffects"],
      "cooperativeEffects",
      "preserve",
    ),
    interfaceDispatch: readInterfaceDispatch(value["interfaceDispatch"]),
  });
}

function readInterfaceDispatch(
  value: unknown,
): "open-structural" | "declared-closed" {
  if (value === undefined || value === "open-structural") {
    return "open-structural";
  }
  if (value === "declared-closed") {
    return value;
  }
  throw new Error(
    "TypeScript target optimization 'interfaceDispatch' must be 'open-structural' or 'declared-closed'",
  );
}

function readClosedChoice<Canonical extends string>(
  value: unknown,
  name: string,
  canonical: Canonical,
): Canonical | "closed-direct" {
  if (value === undefined || value === canonical) {
    return canonical;
  }
  if (value === "closed-direct") {
    return value;
  }
  throw new Error(
    `TypeScript target optimization '${name}' must be '${canonical}' or 'closed-direct'`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  subject: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`${subject} has unsupported field '${unexpected}'`);
  }
}
