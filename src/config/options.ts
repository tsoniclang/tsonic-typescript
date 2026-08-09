import type { TargetSelection } from "@tsonic/target-api";

export interface TypeScriptAstPrinterOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
}

export interface TypeScriptTargetOptions {
  readonly printer: TypeScriptAstPrinterOptions;
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
    new Set(["printer"]),
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
  return Object.freeze({
    printer: Object.freeze({
      executable,
      arguments: Object.freeze(arguments_),
    }),
  });
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
