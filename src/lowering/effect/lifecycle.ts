import type { SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type {
  CooperativeEffectFilePlan,
  CooperativeEffectPlan,
} from "./plan.js";
import type { CooperativeEffectPlanSummary } from "./fallback.js";

export function createCooperativeEffectPlanLifecycle(
  source: TargetSourceProgram,
  files: ReadonlyMap<SourceFile, CooperativeEffectFilePlan>,
  summary: CooperativeEffectPlanSummary,
): CooperativeEffectPlan {
  const begun = new Set<SourceFile>();
  const finished = new Set<SourceFile>();
  let sealed = false;
  return Object.freeze({
    source,
    summary,
    begin(sourceFile: SourceFile): CooperativeEffectFilePlan {
      if (sealed || begun.has(sourceFile)) {
        throw new Error("cooperative-effect file plan was opened twice");
      }
      const file = files.get(sourceFile);
      if (file === undefined) {
        throw new Error("cooperative-effect plan received a foreign source file");
      }
      begun.add(sourceFile);
      return file;
    },
    finishFile(sourceFile: SourceFile): void {
      if (!begun.has(sourceFile) || finished.has(sourceFile)) {
        throw new Error("cooperative-effect file plan was sealed out of order");
      }
      finished.add(sourceFile);
    },
    finish(): void {
      if (sealed) {
        throw new Error("cooperative-effect plan was sealed twice");
      }
      sealed = true;
      if (finished.size !== files.size) {
        throw new Error(
          `cooperative-effect plan consumed ${finished.size} source files, expected ${files.size}`,
        );
      }
    },
  });
}
