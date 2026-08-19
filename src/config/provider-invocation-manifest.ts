import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type ProviderInvocationStateKind =
  | "create"
  | "alias"
  | "access";

export interface ProviderInvocationStateContract {
  readonly kind: ProviderInvocationStateKind;
  readonly carrierParameter?: number;
  readonly read: boolean;
  readonly writeParameters: readonly number[];
}

export interface ProviderInvocationContract {
  readonly identity: string;
  readonly semanticKey: string;
  readonly sourceIdentity: string;
  readonly specifier: string;
  readonly sourcePath: string;
  readonly declarationPath: string;
  readonly declarationFileName: string;
  readonly exportName: string;
  readonly member: string;
  readonly targetType: string;
  readonly targetFingerprint: string;
  readonly inputParameters: readonly number[];
  readonly resultOriginParameters: readonly number[];
  readonly state?: ProviderInvocationStateContract;
}

export interface ProviderInvocationManifest {
  readonly path: string;
  readonly identity: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly manifestDigest: string;
  readonly declarationRoot: string;
  readonly contracts: readonly ProviderInvocationContract[];
}

const transportKeys = new Set([
  "sourceIdentity",
  "specifier",
  "sourcePath",
  "declarationPath",
  "export",
  "member",
  "targetType",
  "targetFingerprint",
  "inputParameters",
  "resultOriginParameters",
  "state",
]);

const stateKeys = new Set([
  "kind",
  "carrierParameter",
  "read",
  "writeParameters",
]);

const contractKeys = new Set([
  "schemaVersion",
  "declarationRoot",
  "transports",
]);

export function readProviderInvocationManifests(
  projectDirectory: string,
  configuredPaths: readonly string[],
): readonly ProviderInvocationManifest[] {
  const seenPaths = new Set<string>();
  const seenContracts = new Set<string>();
  const result = configuredPaths.map((configuredPath) => {
    const path = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(projectDirectory, configuredPath);
    if (seenPaths.has(path)) {
      throw new Error(`Provider invocation manifest '${path}' is duplicated`);
    }
    seenPaths.add(path);
    const manifest = readProviderInvocationManifest(path);
    for (const contract of manifest.contracts) {
      if (seenContracts.has(contract.semanticKey)) {
        throw new Error(
          `Provider invocation contract '${contract.semanticKey}' has multiple semantic owners`,
        );
      }
      seenContracts.add(contract.semanticKey);
    }
    return manifest;
  });
  return Object.freeze(result);
}

export function readProviderInvocationManifest(
  path: string,
): ProviderInvocationManifest {
  const text = readFileSync(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid provider invocation manifest '${path}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const root = record(value, "provider invocation manifest");
  integer(root["schemaVersion"], "schemaVersion");
  const packageName = nonemptyString(root["packageName"], "packageName");
  const packageVersion = nonemptyString(
    root["packageVersion"],
    "packageVersion",
  );
  const manifestDigest = digest(root["manifestDigest"], "manifestDigest");
  const actualDigest = canonicalManifestDigest(root);
  if (actualDigest !== manifestDigest) {
    throw new Error(
      `Provider invocation manifest '${path}' content digest does not match payload`,
    );
  }
  const section = exactRecord(
    root["invocationTransportContract"],
    "invocationTransportContract",
    contractKeys,
  );
  if (integer(section["schemaVersion"], "invocationTransportContract.schemaVersion") !== 1) {
    throw new Error(`Provider invocation manifest '${path}' has unsupported invocation-transport schema`);
  }
  const declarationRootValue = nonemptyString(
    section["declarationRoot"],
    "invocationTransportContract.declarationRoot",
  );
  if (isAbsolute(declarationRootValue)) {
    throw new Error("invocationTransportContract.declarationRoot must be relative");
  }
  const declarationRoot = resolve(dirname(path), declarationRootValue);
  const rawContracts = section["transports"];
  if (!Array.isArray(rawContracts) || rawContracts.length === 0) {
    throw new Error("invocationTransportContract.transports must be a non-empty array");
  }
  const contracts = rawContracts.map((entry, index) =>
    readTransport(entry, manifestDigest, declarationRoot, index)
  );
  for (let index = 1; index < contracts.length; index += 1) {
    if (contracts[index - 1]!.identity >= contracts[index]!.identity) {
      throw new Error(
        "provider invocation contracts are not strictly ordered",
      );
    }
  }
  return Object.freeze({
    path,
    identity: `${packageName}@${packageVersion}:${manifestDigest}`,
    packageName,
    packageVersion,
    manifestDigest,
    declarationRoot,
    contracts: Object.freeze(contracts),
  });
}

function readTransport(
  value: unknown,
  manifestDigest: string,
  declarationRoot: string,
  index: number,
): ProviderInvocationContract {
  const subject = `invocationTransportContract.transports[${index}]`;
  const source = exactRecord(value, subject, transportKeys);
  const specifier = nonemptyString(source["specifier"], `${subject}.specifier`);
  const exportName = nonemptyString(source["export"], `${subject}.export`);
  const member = nonemptyString(source["member"], `${subject}.member`);
  const declarationPath = providerDeclarationPath(
    source["declarationPath"],
    `${subject}.declarationPath`,
  );
  const declarationFileName = resolve(declarationRoot, declarationPath);
  const escaped = relative(declarationRoot, declarationFileName);
  if (escaped === ".." || escaped.startsWith("../") || isAbsolute(escaped)) {
    throw new Error(`${subject}.declarationPath escapes the declaration root`);
  }
  const key = `${specifier}\u0000${exportName}\u0000${member}`;
  const state = source["state"] === undefined
    ? undefined
    : readState(source["state"], `${subject}.state`);
  return Object.freeze({
    identity: `${manifestDigest}:${key}`,
    semanticKey: key,
    sourceIdentity: nonemptyString(
      source["sourceIdentity"],
      `${subject}.sourceIdentity`,
    ),
    specifier,
    sourcePath: nonemptyString(source["sourcePath"], `${subject}.sourcePath`),
    declarationPath,
    declarationFileName,
    exportName,
    member,
    targetType: nonemptyString(source["targetType"], `${subject}.targetType`),
    targetFingerprint: digest(
      source["targetFingerprint"],
      `${subject}.targetFingerprint`,
    ),
    inputParameters: indexes(source["inputParameters"], `${subject}.inputParameters`),
    resultOriginParameters: indexes(
      source["resultOriginParameters"],
      `${subject}.resultOriginParameters`,
    ),
    ...(state === undefined ? {} : { state }),
  });
}

function providerDeclarationPath(value: unknown, subject: string): string {
  const selected = nonemptyString(value, subject);
  if (
    isAbsolute(selected) ||
    selected.includes("\\") ||
    selected.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    !selected.endsWith(".d.ts")
  ) {
    throw new Error(`${subject} must be a normalized relative declaration path`);
  }
  return selected;
}

function readState(
  value: unknown,
  subject: string,
): ProviderInvocationStateContract {
  const source = exactRecord(value, subject, stateKeys);
  const kind = source["kind"];
  if (
    kind !== "create" &&
    kind !== "alias" &&
    kind !== "access"
  ) {
    throw new Error(`${subject}.kind is invalid`);
  }
  const carrierParameter = source["carrierParameter"] === undefined
    ? undefined
    : integer(source["carrierParameter"], `${subject}.carrierParameter`);
  const read = source["read"] === undefined
    ? false
    : boolean(source["read"], `${subject}.read`);
  const writeParameters = indexes(
    source["writeParameters"],
    `${subject}.writeParameters`,
  );
  if (
    (kind === "create" &&
      (read || writeParameters.length !== 0)) ||
    (kind === "alias" &&
      (carrierParameter === undefined || read || writeParameters.length !== 0)) ||
    (kind === "access" && carrierParameter === undefined)
  ) {
    throw new Error(`${subject} has an invalid ${kind} shape`);
  }
  return Object.freeze({
    kind,
    ...(carrierParameter === undefined ? {} : { carrierParameter }),
    read,
    writeParameters,
  });
}

function canonicalManifestDigest(
  source: Readonly<Record<string, unknown>>,
): string {
  const unsealed: Record<string, unknown> = { ...source };
  delete unsealed["manifestDigest"];
  const canonical = JSON.stringify(unsealed)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return createHash("sha256").update(canonical).digest("hex");
}

function indexes(value: unknown, subject: string): readonly number[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${subject} must be an array`);
  }
  const result = value.map((entry, index) =>
    integer(entry, `${subject}[${index}]`)
  );
  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1]! >= result[index]!) {
      throw new Error(`${subject} must be strictly ordered`);
    }
  }
  return Object.freeze(result);
}

function exactRecord(
  value: unknown,
  subject: string,
  allowed: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const result = record(value, subject);
  const unexpected = Object.keys(result).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`${subject} has unsupported field '${unexpected}'`);
  }
  return result;
}

function record(
  value: unknown,
  subject: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function nonemptyString(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${subject} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, subject: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${subject} must be a non-negative safe integer`);
  }
  return value;
}

function boolean(value: unknown, subject: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${subject} must be a boolean`);
  }
  return value;
}

function digest(value: unknown, subject: string): string {
  const selected = nonemptyString(value, subject);
  if (!/^[0-9a-f]{64}$/u.test(selected)) {
    throw new Error(`${subject} must be a sha256 digest`);
  }
  return selected;
}
