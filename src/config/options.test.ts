import assert from "node:assert/strict";
import { test } from "node:test";

import type { TargetSelection } from "@tsonic/target-api";

import { readTypeScriptTargetOptions } from "./options.js";

test("validates and freezes the external printer configuration", () => {
  const inputArguments = ["--mode", "batch"];
  const target: TargetSelection = {
    id: "typescript",
    options: {
      printer: {
        executable: "/tools/tsgo-ast-printer",
        arguments: inputArguments,
      },
    },
  };

  const result = readTypeScriptTargetOptions(target);
  inputArguments.push("--mutated");

  assert.equal(result.printer.executable, "/tools/tsgo-ast-printer");
  assert.deepEqual(result.printer.arguments, ["--mode", "batch"]);
  assert.deepEqual(result.optimizations, {
    identity:
      "typescript-optimization-v3/pointer=location/scalar=preserve/representations=preserve/effects=preserve/interfaces=open-structural",
    pointerFlows: "location",
    scalarProjections: "preserve",
    representationProjections: "preserve",
    cooperativeEffects: "preserve",
    interfaceDispatch: "open-structural",
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.printer));
  assert.ok(Object.isFrozen(result.printer.arguments));
  assert.ok(Object.isFrozen(result.optimizations));
});

test("validates and freezes explicit closed-flow optimizations", () => {
  const target: TargetSelection = {
    id: "typescript",
    options: {
      printer: { executable: "/tools/tsgo-ast-printer" },
      optimizations: {
        pointerFlows: "closed-direct",
        scalarProjections: "closed-direct",
        representationProjections: "closed-direct",
        cooperativeEffects: "closed-direct",
        interfaceDispatch: "declared-closed",
      },
    },
  };

  const result = readTypeScriptTargetOptions(target);

  assert.deepEqual(result.optimizations, {
    identity:
      "typescript-optimization-v3/pointer=closed-direct/scalar=closed-direct/representations=closed-direct/effects=closed-direct/interfaces=declared-closed",
    pointerFlows: "closed-direct",
    scalarProjections: "closed-direct",
    representationProjections: "closed-direct",
    cooperativeEffects: "closed-direct",
    interfaceDispatch: "declared-closed",
  });
  assert.ok(Object.isFrozen(result.optimizations));
});

test("fails closed on absent, unknown, and malformed target options", () => {
  assert.throws(
    () => readTypeScriptTargetOptions({ id: "typescript" }),
    /require a printer configuration/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: {
        printer: { executable: "tsgo-ast-printer" },
        optimizations: { representationProjections: "shape-inferred" },
      },
    }),
    /'representationProjections' must be 'preserve' or 'closed-direct'/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: { printer: {}, unexpected: true },
    }),
    /unsupported field 'unexpected'/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: {
        printer: { executable: "tsgo-ast-printer" },
        typescriptCompatibility: "strict-native",
      },
    }),
    /unsupported field 'typescriptCompatibility'/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: { printer: "tsgo-ast-printer" },
    }),
    /'printer' must be an object/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: {
        printer: { executable: "tsgo-ast-printer", arguments: ["--ok", 1] },
      },
    }),
    /argument 1 must be a string/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: {
        printer: { executable: "tsgo-ast-printer" },
        optimizations: { pointerFlows: "automatic" },
      },
    }),
    /'pointerFlows' must be 'location' or 'closed-direct'/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: {
        printer: { executable: "tsgo-ast-printer" },
        optimizations: { interfaceDispatch: "structural-inferred" },
      },
    }),
    /'interfaceDispatch' must be 'open-structural' or 'declared-closed'/,
  );
  assert.throws(
    () => readTypeScriptTargetOptions({
      id: "typescript",
      options: {
        printer: { executable: "tsgo-ast-printer" },
        optimizations: { scalarProjections: "closed-direct", extra: true },
      },
    }),
    /optimizations has unsupported field 'extra'/,
  );

  for (const unsupported of ["interfaces", "containers", "reachability"]) {
    assert.throws(
      () => readTypeScriptTargetOptions({
        id: "typescript",
        options: {
          printer: { executable: "tsgo-ast-printer" },
          optimizations: { [unsupported]: "closed-direct" },
        },
      }),
      new RegExp(`optimizations has unsupported field '${unsupported}'`, "u"),
    );
  }
});
