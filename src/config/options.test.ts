import assert from "node:assert/strict";
import { test } from "node:test";

import type { TargetSelection } from "@tsonic/target-api";

import { readTypeScriptTargetOptions } from "./options.js";

test("validates and freezes the canonical printer and optimization profile", () => {
  const inputArguments = ["--mode", "batch"];
  const result = readTypeScriptTargetOptions({
    id: "typescript",
    options: {
      printer: {
        executable: "/tools/tsgo-ast-printer",
        arguments: inputArguments,
      },
    },
  });
  inputArguments.push("--mutated");

  assert.deepEqual(result.printer, {
    executable: "/tools/tsgo-ast-printer",
    arguments: ["--mode", "batch"],
  });
  assert.equal(result.execution, "unrestricted");
  assert.deepEqual(result.optimizations, {
    identity:
      "typescript-optimization-v4/pointer=location/scalar=preserve/representations=preserve",
    pointerFlows: "location",
    scalarProjections: "preserve",
    representationProjections: "preserve",
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.printer));
  assert.ok(Object.isFrozen(result.printer.arguments));
  assert.ok(Object.isFrozen(result.optimizations));
});

test("selects the exact closed three-family profile", () => {
  const result = readTypeScriptTargetOptions({
    id: "typescript",
    options: {
      printer: { executable: "/tools/tsgo-ast-printer" },
      execution: "synchronous",
      optimizations: {
        pointerFlows: "closed-direct",
        scalarProjections: "closed-direct",
        representationProjections: "closed-direct",
      },
    },
  });

  assert.equal(result.execution, "synchronous");
  assert.deepEqual(result.optimizations, {
    identity:
      "typescript-optimization-v4/pointer=closed-direct/scalar=closed-direct/representations=closed-direct",
    pointerFlows: "closed-direct",
    scalarProjections: "closed-direct",
    representationProjections: "closed-direct",
  });
});

test("fails closed on absent, unknown, malformed, and effect-era options", () => {
  const read = (options?: TargetSelection["options"]) =>
    readTypeScriptTargetOptions({ id: "typescript", ...(options === undefined
      ? {}
      : { options }) });

  assert.throws(() => read(), /require a printer configuration/u);
  assert.throws(
    () => read({ printer: {}, unexpected: true }),
    /unsupported field 'unexpected'/u,
  );
  assert.throws(
    () => read({ printer: "tsgo-ast-printer" }),
    /'printer' must be an object/u,
  );
  assert.throws(
    () => read({
      printer: { executable: "tsgo-ast-printer" },
      execution: "automatic",
    }),
    /'execution' must be 'unrestricted' or 'synchronous'/u,
  );
  assert.throws(
    () => read({
      printer: { executable: "tsgo-ast-printer", arguments: ["--ok", 1] },
    }),
    /argument 1 must be a string/u,
  );
  assert.throws(
    () => read({
      printer: { executable: "tsgo-ast-printer" },
      optimizations: { pointerFlows: "automatic" },
    }),
    /'pointerFlows' must be 'location' or 'closed-direct'/u,
  );
  assert.throws(
    () => read({
      printer: { executable: "tsgo-ast-printer" },
      optimizations: {
        scalarProjections: "closed-direct",
        extra: true,
      },
    }),
    /optimizations has unsupported field 'extra'/u,
  );
  assert.throws(
    () => read({
      printer: { executable: "tsgo-ast-printer" },
      optimizations: { cooperativeEffects: "closed-program" },
    }),
    /unsupported field 'cooperativeEffects'/u,
  );
  assert.throws(
    () => read({
      printer: { executable: "tsgo-ast-printer" },
      diagnostics: { planningPhases: true },
    }),
    /unsupported field 'diagnostics'/u,
  );
});
