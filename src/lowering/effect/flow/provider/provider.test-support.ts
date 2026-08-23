import assert from "node:assert/strict";

import {
  createCompilerSessionFromFiles,
} from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  ProviderInvocationContract,
  ProviderInvocationManifest,
  ProviderInvocationStateContract,
} from "../../../../config/provider-invocation-manifest.js";
import { createProviderInvocationExtension } from "./source-extension.js";

export const testProviderSpecifier = "@test/provider";

const providerRoot = "/src/node_modules/@test/provider";
const providerDeclaration = `${providerRoot}/index.d.ts`;
const providerKernelDeclaration = `${providerRoot}/kernels.d.ts`;
const providerSource = `
export {
  conditionalInvoke,
  synchronousInvoke,
} from "./kernels.js";
export declare class State {}
export type Awaitable<T> = T | PromiseLike<T>;
export declare class Operations {
  static zero(): State;
  static alias(state: State): State;
  static observe(state: State): void;
  static store(state: State, value: () => Promise<void>): void;
  static load(state: State): (() => Promise<void>) | undefined;
  static forward(value: () => Promise<void>): () => Promise<void>;
  static forwardTuple(
    value: [() => Promise<void>, boolean],
  ): [() => Promise<void>, boolean];
  static invoke<T>(callback: (value: T) => Awaitable<number>): void;
}
`;
const providerKernelSource = `
export type Awaitable<T> = T | PromiseLike<T>;
export declare function conditionalInvoke(
  callback: () => Awaitable<void>,
): Promise<void>;
export declare function synchronousInvoke(callback: () => void): void;
`;

export function providerContract(
  member:
    | "zero"
    | "alias"
    | "store"
    | "load"
    | "observe"
    | "forward"
    | "forwardTuple"
    | "invoke",
  targetType: string,
  inputParameters: readonly number[],
  resultOriginParameters: readonly number[],
  state?: ProviderInvocationStateContract,
): ProviderInvocationContract {
  const semanticKey = `${testProviderSpecifier}\u0000Operations\u0000${member}`;
  return Object.freeze({
    identity: `manifest:${semanticKey}`,
    semanticKey,
    sourceIdentity: `test::${member}`,
    target: Object.freeze({
      specifier: testProviderSpecifier,
      sourcePath: "src/provider.ts",
      declarationPath: "index.d.ts",
      declarationFileName: providerDeclaration,
      access: "static-method",
      exportName: "Operations",
      member,
      targetType,
      targetFingerprint: "0".repeat(64),
    }),
    inputParameters: Object.freeze([...inputParameters]),
    resultOriginParameters: Object.freeze([...resultOriginParameters]),
    ...(state === undefined ? {} : { state }),
  });
}

export function conditionalProviderContract(): ProviderInvocationContract {
  const semanticKey = [
    testProviderSpecifier,
    "export",
    "conditionalInvoke",
    "",
  ].join("\u0000");
  return Object.freeze({
    identity: `manifest:${semanticKey}`,
    semanticKey,
    sourceIdentity: "test::conditionalInvoke",
    target: Object.freeze({
      specifier: testProviderSpecifier,
      sourcePath: "src/provider.ts",
      declarationPath: "index.d.ts",
      declarationFileName: providerDeclaration,
      access: "export",
      exportName: "conditionalInvoke",
      targetType: "(callback: () => Awaitable<void>) => Promise<void>",
      targetFingerprint: "1".repeat(64),
    }),
    inputParameters: Object.freeze([0]),
    resultOriginParameters: Object.freeze([]),
    conditional: Object.freeze({
      callableParameters: Object.freeze([0]),
      replacement: Object.freeze({
        specifier: testProviderSpecifier,
        sourcePath: "src/provider.ts",
        declarationPath: "index.d.ts",
        declarationFileName: providerDeclaration,
        access: "export",
        exportName: "synchronousInvoke",
        targetType: "(callback: () => void) => void",
        targetFingerprint: "2".repeat(64),
      }),
    }),
  });
}

export function checkedProviderFixture(
  sourceText: string,
  contracts: readonly ProviderInvocationContract[],
): TargetSourceProgram {
  const session = providerSession(sourceText, contracts);
  const checked = session.checkSource();
  assert.equal(
    checked.diagnostics.length,
    0,
    checked.diagnostics.map((diagnostic) => String(diagnostic)).join("\n"),
  );
  assert.equal(
    checked.extensionDiagnostics.length,
    0,
    checked.extensionDiagnostics.map((diagnostic) => diagnostic.message).join("\n"),
  );
  return createTargetSourceProgram(checked);
}

export function providerSession(
  sourceText: string,
  contracts: readonly ProviderInvocationContract[],
) {
  return createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": sourceText,
      [providerDeclaration]: providerSource,
      [providerKernelDeclaration]: providerKernelSource,
      [`${providerRoot}/package.json`]: JSON.stringify({
        name: "@test/provider",
        version: "1.0.0",
        types: "./index.d.ts",
      }),
    },
    rootFiles: ["/src/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: [createProviderInvocationExtension([manifest(contracts)])],
    },
  });
}

function manifest(
  contracts: readonly ProviderInvocationContract[],
): ProviderInvocationManifest {
  return Object.freeze({
    path: `${providerRoot}/contract/manifest.json`,
    identity: "test-provider",
    packageName: "@test/provider",
    packageVersion: "1.0.0",
    manifestDigest: "0".repeat(64),
    declarationRoot: providerRoot,
    contracts: Object.freeze([...contracts]),
  });
}
