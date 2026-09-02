import type { TargetSelection } from "@tsonic/target-api";

import {
  canonicalTypeScriptOptimizationProfile,
  createTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfile,
} from "../lowering/profile.js";
import type {
  TypeScriptSourceExecutionProfile,
} from "../source-contract/execution.js";
import type {
  RepresentationTransportContract,
} from "../lowering/representation/transport-contract.js";
import { readRepresentationTransportContract } from "./representation-transports.js";

export interface TypeScriptAstPrinterOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
}

export interface TypeScriptTargetOptions {
  readonly printer: TypeScriptAstPrinterOptions;
  readonly execution: TypeScriptSourceExecutionProfile;
  readonly optimizations: TypeScriptOptimizationProfile;
  readonly representationTransports: RepresentationTransportContract;
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
    new Set([
      "printer",
      "execution",
      "optimizations",
      "representationTransports",
    ]),
    "TypeScript target options",
  );
  return Object.freeze({
    printer: readPrinter(options["printer"]),
    execution: readExecution(options["execution"]),
    optimizations: readOptimizationOptions(options["optimizations"]),
    representationTransports: readRepresentationTransportContract(
      options["representationTransports"],
    ),
  });
}

function readExecution(value: unknown): TypeScriptSourceExecutionProfile {
  if (value === undefined || value === "unrestricted") {
    return "unrestricted";
  }
  if (value === "synchronous") {
    return value;
  }
  throw new Error(
    "TypeScript target option 'execution' must be 'unrestricted' or 'synchronous'",
  );
}

function readPrinter(value: unknown): TypeScriptAstPrinterOptions {
  if (!isRecord(value)) {
    throw new Error("TypeScript target option 'printer' must be an object");
  }
  rejectUnknownKeys(
    value,
    new Set(["executable", "arguments"]),
    "TypeScript target printer",
  );
  const executable = value["executable"];
  if (typeof executable !== "string" || executable.length === 0) {
    throw new Error(
      "TypeScript target printer 'executable' must be a non-empty string",
    );
  }
  const rawArguments = value["arguments"];
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
  return Object.freeze({
    executable,
    arguments: Object.freeze(arguments_),
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
  });
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
