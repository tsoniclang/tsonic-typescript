import {
  createRepresentationTransportContract,
  type RepresentationTransportCallable,
  type RepresentationTransportContract,
} from "../lowering/representation/transport-contract.js";

export function readRepresentationTransportContract(
  value: unknown,
): RepresentationTransportContract {
  if (value === undefined) {
    return createRepresentationTransportContract([]);
  }
  if (!Array.isArray(value)) {
    throw new Error(
      "TypeScript target option 'representationTransports' must be an array",
    );
  }
  return createRepresentationTransportContract(value.map(readCallable));
}

function readCallable(
  value: unknown,
  index: number,
): RepresentationTransportCallable {
  if (!isRecord(value)) {
    throw new Error(`representation transport callable ${index} must be an object`);
  }
  rejectUnknownKeys(
    value,
    new Set(["kind", "moduleSpecifier", "exportName"]),
    `representation transport callable ${index}`,
  );
  const kind = value["kind"];
  const moduleSpecifier = value["moduleSpecifier"];
  const exportName = value["exportName"];
  if (kind !== "generic-kernel") {
    throw new Error(
      `representation transport callable ${index} kind must be 'generic-kernel'`,
    );
  }
  if (typeof moduleSpecifier !== "string" || moduleSpecifier.length === 0) {
    throw new Error(
      `representation transport callable ${index} moduleSpecifier must be non-empty`,
    );
  }
  if (typeof exportName !== "string" || exportName.length === 0) {
    throw new Error(
      `representation transport callable ${index} exportName must be non-empty`,
    );
  }
  return Object.freeze({ kind, moduleSpecifier, exportName });
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
