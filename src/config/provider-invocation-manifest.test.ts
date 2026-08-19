import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  readProviderInvocationManifest,
  readProviderInvocationManifests,
} from "./provider-invocation-manifest.js";

const scratch = resolve(".temp/provider-invocation-manifest-tests");
mkdirSync(scratch, { recursive: true });

test("reads one sealed immutable provider invocation manifest", () => {
  const path = writeManifest("valid.json", manifest([
    transport("forward", {
      inputParameters: [0],
      resultOriginParameters: [0],
    }),
    transport("store", {
      inputParameters: [0, 1],
      state: {
        kind: "access",
        carrierParameter: 0,
        writeParameters: [1],
      },
    }),
  ]));

  const result = readProviderInvocationManifest(path);

  assert.equal(result.contracts.length, 2);
  assert.equal(result.declarationRoot, scratch);
  assert.equal(result.contracts[0]?.member, "forward");
  assert.equal(
    result.contracts[0]?.declarationFileName,
    resolve(scratch, "provider.d.ts"),
  );
  assert.deepEqual(result.contracts[1]?.state, {
    kind: "access",
    carrierParameter: 0,
    read: false,
    writeParameters: [1],
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.contracts));
  assert.ok(Object.isFrozen(result.contracts[0]));
  assert.ok(Object.isFrozen(result.contracts[0]?.inputParameters));
  assert.ok(Object.isFrozen(result.contracts[1]?.state));
  assert.ok(Object.isFrozen(result.contracts[1]?.state?.writeParameters));
});

test("rejects stale digests and unsupported transport fields", () => {
  const stale = manifest([transport("forward")]);
  stale["manifestDigest"] = seal(stale);
  stale["packageVersion"] = "mutated";
  assert.throws(
    () => readProviderInvocationManifest(writeRaw("stale.json", stale)),
    /content digest does not match/u,
  );

  const unsupported = transport("forward");
  unsupported["fallback"] = true;
  assert.throws(
    () => readProviderInvocationManifest(writeManifest(
      "unsupported.json",
      manifest([unsupported]),
    )),
    /unsupported field 'fallback'/u,
  );
});

test("rejects malformed state and unordered contracts", () => {
  assert.throws(
    () => readProviderInvocationManifest(writeManifest(
      "state.json",
      manifest([transport("load", {
        state: { kind: "access", read: true },
      })]),
    )),
    /invalid access shape/u,
  );

  assert.throws(
    () => readProviderInvocationManifest(writeManifest(
      "unordered.json",
      manifest([transport("store"), transport("forward")]),
    )),
    /not strictly ordered/u,
  );
});

test("versions the invocation section independently", () => {
  const value = manifest([transport("forward")]);
  value["schemaVersion"] = 999;
  const accepted = readProviderInvocationManifest(writeManifest(
    "independent-root-schema.json",
    value,
  ));
  assert.equal(accepted.contracts.length, 1);

  const stale = manifest([transport("forward")]);
  const section = stale["invocationTransportContract"] as Record<string, unknown>;
  section["schemaVersion"] = 2;
  assert.throws(
    () => readProviderInvocationManifest(writeManifest(
      "stale-section-schema.json",
      stale,
    )),
    /unsupported invocation-transport schema/u,
  );
});

test("rejects declaration paths outside the certified root", () => {
  for (const [fileName, declarationPath] of [
    ["parent.json", "../provider.d.ts"],
    ["absolute.json", "/provider.d.ts"],
    ["backslash.json", "dist\\provider.d.ts"],
    ["nontype.json", "provider.ts"],
  ] as const) {
    const selected = transport("forward");
    selected["declarationPath"] = declarationPath;
    assert.throws(
      () => readProviderInvocationManifest(writeManifest(
        fileName,
        manifest([selected]),
      )),
      /normalized relative declaration path/u,
    );
  }
});

test("rejects duplicate semantic ownership across manifests", () => {
  const left = writeManifest("owner-left.json", manifest([
    transport("forward"),
  ]));
  const rightManifest = manifest([transport("forward")]);
  rightManifest["packageVersion"] = "2.0.0";
  const right = writeManifest("owner-right.json", rightManifest);

  assert.throws(
    () => readProviderInvocationManifests(scratch, [left, right]),
    /multiple semantic owners/u,
  );
});

interface TransportOptions {
  readonly inputParameters?: readonly number[];
  readonly resultOriginParameters?: readonly number[];
  readonly state?: Readonly<Record<string, unknown>>;
}

function transport(
  member: string,
  options: TransportOptions = {},
): Record<string, unknown> {
  return {
    sourceIdentity: `source::${member}`,
    specifier: "@provider/runtime.js",
    sourcePath: "src/runtime.ts",
    declarationPath: "provider.d.ts",
    export: "Operations",
    member,
    targetType: "(value: () => Promise<void>) => () => Promise<void>",
    targetFingerprint: "1".repeat(64),
    ...(options.inputParameters === undefined
      ? {}
      : { inputParameters: [...options.inputParameters] }),
    ...(options.resultOriginParameters === undefined
      ? {}
      : { resultOriginParameters: [...options.resultOriginParameters] }),
    ...(options.state === undefined ? {} : { state: { ...options.state } }),
  };
}

function manifest(
  transports: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    schemaVersion: 999,
    packageName: "@provider/runtime",
    packageVersion: "1.0.0",
    invocationTransportContract: {
      schemaVersion: 1,
      declarationRoot: ".",
      transports: transports.map((entry) => ({ ...entry })),
    },
    manifestDigest: "",
  };
}

function writeManifest(
  fileName: string,
  value: Record<string, unknown>,
): string {
  value["manifestDigest"] = seal(value);
  return writeRaw(fileName, value);
}

function writeRaw(
  fileName: string,
  value: Readonly<Record<string, unknown>>,
): string {
  const path = resolve(scratch, fileName);
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
  return path;
}

function seal(value: Readonly<Record<string, unknown>>): string {
  const payload = { ...value };
  delete payload["manifestDigest"];
  const canonical = JSON.stringify(payload)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return createHash("sha256").update(canonical).digest("hex");
}
