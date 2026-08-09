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
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.printer));
  assert.ok(Object.isFrozen(result.printer.arguments));
});

test("fails closed on absent, unknown, and malformed target options", () => {
  assert.throws(
    () => readTypeScriptTargetOptions({ id: "typescript" }),
    /require a printer configuration/,
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
});
