import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const effectRoot = join(repositoryRoot, "src", "lowering", "effect");

test("interface post-validation consumes detached callable evidence", () => {
  const evidence = readFileSync(
    join(
      effectRoot,
      "flow",
      "callable",
      "provenance",
      "interface-evidence.ts",
    ),
    "utf8",
  );
  const settlement = readFileSync(
    join(effectRoot, "flow", "settlement", "program.ts"),
    "utf8",
  );
  const callableConstruction = readFileSync(
    join(effectRoot, "flow", "callable", "provenance-flow.ts"),
    "utf8",
  );
  const postValidationStart = settlement.indexOf(
    "function postValidateInterfaceDispatch(",
  );
  const postValidationEnd = settlement.indexOf(
    "\nfunction createRoundCallableValueRequest(",
    postValidationStart,
  );
  const postValidation = settlement.slice(
    postValidationStart,
    postValidationEnd,
  );

  assert.doesNotMatch(
    evidence,
    /CallableContext|TargetSourceProgram|EffectProvenanceGraph|EffectProvenanceResolutionIndex/u,
  );
  assert.match(evidence, /implementationsByCall/u);
  assert.match(evidence, /resolutionsByDeclaration/u);
  assert.match(evidence, /allowedReferences/u);
  assert.match(settlement, /createCallableInterfaceEvidence\(/u);
  assert.doesNotMatch(settlement, /\.interfaceEvidence\(\)/u);
  assert.match(
    callableConstruction,
    /finalization === "interface-evidence"[\s\S]*finalizeGraphCallableInterfaceEvidence\(/u,
  );
  assert.match(
    callableConstruction,
    /finalizeGraphCallableInterfaceEvidence\([\s\S]*const callContractRequirements/u,
  );
  assert.match(
    settlement,
    /postValidateInterfaceDispatch\([\s\S]*callableEvidence/u,
  );
  assert.doesNotMatch(
    postValidation,
    /valueFlow: CallableValueFlow/u,
  );
});
