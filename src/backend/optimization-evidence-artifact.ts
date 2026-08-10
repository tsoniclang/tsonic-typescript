import type { TargetArtifact } from "@tsonic/target-api";

import type { TypeScriptOptimizationEvidence } from "../lowering/evidence.js";

export const optimizationEvidenceArtifactPath =
  "tsonic-typescript-optimization.json";

export function createOptimizationEvidenceArtifact(
  evidence: TypeScriptOptimizationEvidence,
): TargetArtifact {
  return Object.freeze({
    kind: "asset",
    path: optimizationEvidenceArtifactPath,
    text: `${JSON.stringify(evidence, undefined, 2)}\n`,
  });
}
