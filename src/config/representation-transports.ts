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
    new Set(["kind", "moduleSpecifier", "sourcePath", "exportName", "memberName"]),
    `representation transport callable ${index}`,
  );
  const kind = value["kind"];
  const exportName = requireText(
    value["exportName"],
    `representation transport callable ${index} exportName`,
  );
  if (kind === "generic-kernel") {
    const moduleSpecifier = requireText(
      value["moduleSpecifier"],
      `representation transport callable ${index} moduleSpecifier`,
    );
    rejectPresent(value, ["sourcePath", "memberName"], index);
    return Object.freeze({ kind, moduleSpecifier, exportName });
  }
  if (kind === "generated-generic-function-kernel") {
    const sourcePath = requireText(
      value["sourcePath"],
      `representation transport callable ${index} sourcePath`,
    );
    rejectPresent(value, ["moduleSpecifier", "memberName"], index);
    return Object.freeze({ kind, sourcePath, exportName });
  }
  if (kind === "generated-generic-member-kernel") {
    const sourcePath = requireText(
      value["sourcePath"],
      `representation transport callable ${index} sourcePath`,
    );
    const memberName = requireText(
      value["memberName"],
      `representation transport callable ${index} memberName`,
    );
    rejectPresent(value, ["moduleSpecifier"], index);
    return Object.freeze({ kind, sourcePath, exportName, memberName });
  }
  throw new Error(
    `representation transport callable ${index} kind is unsupported`,
  );
}

function requireText(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${subject} must be non-empty`);
  }
  return value;
}

function rejectPresent(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  index: number,
): void {
  const present = fields.find((field) => value[field] !== undefined);
  if (present !== undefined) {
    throw new Error(
      `representation transport callable ${index} field '${present}' is invalid for its kind`,
    );
  }
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
