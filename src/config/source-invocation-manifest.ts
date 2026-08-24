import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface SourceInvocationContract {
  readonly identity: string;
  readonly semanticKey: string;
  readonly sourceIdentity: string;
  readonly exportName: string;
  readonly file: SourceInvocationFileContract;
  readonly exactImplementation: boolean;
  readonly inputParameters: readonly number[];
  readonly resultOriginParameters: readonly number[];
}

export interface SourceInvocationFileContract {
  readonly identity: string;
  readonly sourcePath: string;
  readonly sourceFileName: string;
  readonly sourceDigest: string;
  readonly exact: boolean;
}

export interface SourceInvocationManifest {
  readonly path: string;
  readonly identity: string;
  readonly semanticDigest: string;
  readonly contractDigest: string;
  readonly files: readonly SourceInvocationFileContract[];
  readonly contracts: readonly SourceInvocationContract[];
}

const sectionKeys = new Set([
  "schemaVersion",
  "contractDigest",
  "files",
  "invocations",
]);

const fileKeys = new Set([
  "sourcePath",
  "sourceDigest",
  "exact",
]);

const invocationKeys = new Set([
  "sourceIdentity",
  "sourcePath",
  "export",
  "exactImplementation",
  "inputParameters",
  "resultOriginParameters",
]);

export function readSourceInvocationManifests(
  projectDirectory: string,
  configuredPaths: readonly string[],
): readonly SourceInvocationManifest[] {
  const seenPaths = new Set<string>();
  const seenContracts = new Set<string>();
  const seenSourceIdentities = new Set<string>();
  const sourceFileExactness = new Map<string, boolean>();
  const sourceFileDigests = new Map<string, string>();
  const seenSourceFiles = new Set<string>();
  const manifests = configuredPaths.map((configuredPath) => {
    const path = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(projectDirectory, configuredPath);
    if (seenPaths.has(path)) {
      throw new Error(`Source invocation manifest '${path}' is duplicated`);
    }
    seenPaths.add(path);
    const manifest = readSourceInvocationManifest(path);
    for (const contract of manifest.contracts) {
      if (seenContracts.has(contract.semanticKey)) {
        throw new Error(
          `Source invocation contract '${contract.semanticKey}' has multiple semantic owners`,
        );
      }
      seenContracts.add(contract.semanticKey);
      if (seenSourceIdentities.has(contract.sourceIdentity)) {
        throw new Error(
          `Source invocation identity '${contract.sourceIdentity}' has multiple semantic owners`,
        );
      }
      seenSourceIdentities.add(contract.sourceIdentity);
    }
    for (const file of manifest.files) {
      const existingExactness = sourceFileExactness.get(file.sourceFileName);
      if (
        existingExactness !== undefined &&
        existingExactness !== file.exact
      ) {
        throw new Error(
          `Source invocation file '${file.sourceFileName}' has conflicting exactness across manifests`,
        );
      }
      sourceFileExactness.set(
        file.sourceFileName,
        file.exact,
      );
      const existingDigest = sourceFileDigests.get(file.sourceFileName);
      if (
        existingDigest !== undefined &&
        existingDigest !== file.sourceDigest
      ) {
        throw new Error(
          `Source invocation file '${file.sourceFileName}' has conflicting digests across manifests`,
        );
      }
      sourceFileDigests.set(file.sourceFileName, file.sourceDigest);
      if (seenSourceFiles.has(file.sourceFileName)) {
        throw new Error(
          `Source invocation file '${file.sourceFileName}' has multiple semantic owners`,
        );
      }
      seenSourceFiles.add(file.sourceFileName);
    }
    return manifest;
  });
  return Object.freeze(manifests);
}

export function readSourceInvocationManifest(
  path: string,
): SourceInvocationManifest {
  const value = parseManifest(path);
  const root = record(value, "source invocation manifest");
  if (integer(root["schemaVersion"], "schemaVersion") !== 1) {
    throw new Error(`Source invocation manifest '${path}' has unsupported schema`);
  }
  const semanticDigest = digest(root["semanticDigest"], "semanticDigest");
  const section = exactRecord(
    root["sourceInvocationContract"],
    "sourceInvocationContract",
    sectionKeys,
  );
  if (integer(section["schemaVersion"], "sourceInvocationContract.schemaVersion") !== 3) {
    throw new Error(
      `Source invocation manifest '${path}' has unsupported invocation schema`,
    );
  }
  const contractDigest = digest(
    section["contractDigest"],
    "sourceInvocationContract.contractDigest",
  );
  const rawFiles = section["files"];
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error("sourceInvocationContract.files must be non-empty");
  }
  const rootDirectory = dirname(path);
  const files = rawFiles.map((file, index) =>
    readSourceFile(file, rootDirectory, contractDigest, index)
  );
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1]!.sourcePath >= files[index]!.sourcePath) {
      throw new Error("source invocation files are not strictly ordered");
    }
  }
  const filesByPath = new Map(files.map((file) => [file.sourcePath, file]));
  const rawInvocations = section["invocations"];
  if (!Array.isArray(rawInvocations)) {
    throw new Error("sourceInvocationContract.invocations must be an array");
  }
  const contracts = rawInvocations.map((invocation, index) =>
    readInvocation(
      invocation,
      contractDigest,
      filesByPath,
      index,
    )
  );
  for (let index = 1; index < contracts.length; index += 1) {
    if (contracts[index - 1]!.semanticKey >= contracts[index]!.semanticKey) {
      throw new Error("source invocation contracts are not strictly ordered");
    }
  }
  const sourceIdentities = new Set<string>();
  for (const contract of contracts) {
    if (sourceIdentities.has(contract.sourceIdentity)) {
      throw new Error(
        `Source invocation identity '${contract.sourceIdentity}' is duplicated`,
      );
    }
    sourceIdentities.add(contract.sourceIdentity);
  }
  const actualDigest = sourceInvocationDigest(files, contracts);
  if (actualDigest !== contractDigest) {
    throw new Error(
      `Source invocation manifest '${path}' contract digest does not match payload`,
    );
  }
  return Object.freeze({
    path,
    identity: `${semanticDigest}:${contractDigest}`,
    semanticDigest,
    contractDigest,
    files: Object.freeze(files),
    contracts: Object.freeze(contracts),
  });
}

function readSourceFile(
  value: unknown,
  rootDirectory: string,
  contractDigest: string,
  index: number,
): SourceInvocationFileContract {
  const subject = `sourceInvocationContract.files[${index}]`;
  const source = exactRecord(value, subject, fileKeys);
  const sourcePath = normalizedSourcePath(
    source["sourcePath"],
    `${subject}.sourcePath`,
  );
  const sourceFileName = resolveManifestSourcePath(
    rootDirectory,
    sourcePath,
    subject,
  );
  return Object.freeze({
    identity: `${contractDigest}:file:${sourcePath}`,
    sourcePath,
    sourceFileName,
    sourceDigest: digest(source["sourceDigest"], `${subject}.sourceDigest`),
    exact: boolean(source["exact"], `${subject}.exact`),
  });
}

function readInvocation(
  value: unknown,
  contractDigest: string,
  filesByPath: ReadonlyMap<string, SourceInvocationFileContract>,
  index: number,
): SourceInvocationContract {
  const subject = `sourceInvocationContract.invocations[${index}]`;
  const source = exactRecord(value, subject, invocationKeys);
  const sourcePath = normalizedSourcePath(
    source["sourcePath"],
    `${subject}.sourcePath`,
  );
  const file = filesByPath.get(sourcePath);
  if (file === undefined) {
    throw new Error(`${subject}.sourcePath has no source-file owner`);
  }
  const exportName = semanticString(source["export"], `${subject}.export`);
  const sourceIdentity = semanticString(
    source["sourceIdentity"],
    `${subject}.sourceIdentity`,
  );
  const exactImplementation = boolean(
    source["exactImplementation"],
    `${subject}.exactImplementation`,
  );
  if (file.exact && !exactImplementation) {
    throw new Error(
      `${subject}.exactImplementation must be true for an exact source file`,
    );
  }
  const inputParameters = indexes(
    source["inputParameters"],
    `${subject}.inputParameters`,
  );
  const resultOriginParameters = indexes(
    source["resultOriginParameters"],
    `${subject}.resultOriginParameters`,
  );
  if (
    !exactImplementation &&
    inputParameters.length === 0 &&
    resultOriginParameters.length === 0
  ) {
    throw new Error(`${subject} carries no invocation semantics`);
  }
  const semanticKey = `${sourcePath}\u0000${exportName}`;
  return Object.freeze({
    identity: `${contractDigest}:${semanticKey}`,
    semanticKey,
    sourceIdentity,
    exportName,
    file,
    exactImplementation,
    inputParameters,
    resultOriginParameters,
  });
}

function sourceInvocationDigest(
  files: readonly SourceInvocationFileContract[],
  contracts: readonly SourceInvocationContract[],
): string {
  const hash = createHash("sha256");
  hash.update("gotots-source-invocation-v3\0");
  for (const file of files) {
    for (const value of [file.sourcePath, file.sourceDigest]) {
      hash.update(value);
      hash.update("\0");
    }
    hash.update(file.exact ? "\x01" : "\x00");
  }
  for (const contract of contracts) {
    for (const value of [
      contract.sourceIdentity,
      contract.file.sourcePath,
      contract.exportName,
    ]) {
      hash.update(value);
      hash.update("\0");
    }
    hash.update(contract.exactImplementation ? "\x01" : "\x00");
    writeIndexes(hash, contract.inputParameters);
    writeIndexes(hash, contract.resultOriginParameters);
  }
  return hash.digest("hex");
}

function resolveManifestSourcePath(
  rootDirectory: string,
  sourcePath: string,
  subject: string,
): string {
  const sourceFileName = resolve(rootDirectory, sourcePath);
  const escaped = relative(rootDirectory, sourceFileName);
  if (escaped === ".." || escaped.startsWith("../") || isAbsolute(escaped)) {
    throw new Error(`${subject}.sourcePath escapes the manifest root`);
  }
  return sourceFileName;
}

function writeIndexes(
  hash: ReturnType<typeof createHash>,
  values: readonly number[],
): void {
  for (const value of values) {
    hash.update(`${value},`);
  }
  hash.update("\0");
}

function parseManifest(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid source invocation manifest '${path}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizedSourcePath(value: unknown, subject: string): string {
  const selected = semanticString(value, subject);
  if (
    isAbsolute(selected) ||
    selected.includes("\\") ||
    selected.split("/").some((segment) =>
      segment === "" || segment === "." || segment === ".."
    ) ||
    !selected.endsWith(".ts") ||
    selected.endsWith(".d.ts")
  ) {
    throw new Error(`${subject} must be a normalized TypeScript source path`);
  }
  return selected;
}

function indexes(value: unknown, subject: string): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${subject} must be an array`);
  }
  const selected = value.map((entry, index) =>
    integer(entry, `${subject}[${index}]`)
  );
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index - 1]! >= selected[index]!) {
      throw new Error(`${subject} must be strictly ordered`);
    }
  }
  return Object.freeze(selected);
}

function exactRecord(
  value: unknown,
  subject: string,
  allowed: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const selected = record(value, subject);
  const unexpected = Object.keys(selected).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`${subject} has unsupported field '${unexpected}'`);
  }
  return selected;
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

function semanticString(value: unknown, subject: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000")
  ) {
    throw new Error(`${subject} must be a non-empty semantic string`);
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
    throw new Error(`${subject} must be boolean`);
  }
  return value;
}

function digest(value: unknown, subject: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${subject} must be a sha256 digest`);
  }
  return value;
}
