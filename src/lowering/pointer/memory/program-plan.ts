import type { Node } from "@tsonic/tsts";
import { KindCallExpression } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { createTsonicMemoryMetadataIndex, selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact, TsonicMemoryMetadataIndex } from "@tsonic/source-core/facts";
import type { TargetProgramIndex } from "../../program-index.js";
import type { ProgramGeneratedNames } from "../../generated-names.js";
import { createMemoryReferencePlan } from "./references/plan.js";
import type { MemoryReferencePlan } from "./references/plan.js";

export interface MemoryProgramPlan {
  readonly references: MemoryReferencePlan;
  readonly metadata: TsonicMemoryMetadataIndex;
  requiresCodec(subject: Node): boolean;
}

export function createMemoryProgramPlan(source: TargetSourceProgram, program: TargetProgramIndex, names: ProgramGeneratedNames): MemoryProgramPlan {
  const required = new Set<Node>();
  const pending: TsonicMemoryLayoutFact[] = [];
  for (const node of program.nodesOfKind(KindCallExpression)) {
    const selected = selectTsonicRawLocationOperation(source.ast, source.sourceFacts, node);
    if (selected?.kind === "resolved") pending.push(selected.layout);
  }
  while (pending.length !== 0) {
    const layout = pending.pop();
    if (layout === undefined || required.has(layout.call)) continue;
    required.add(layout.call);
    if (layout.kind === "array") pending.push(layout.elementLayout);
    else for (const field of layout.fields) {
      required.add(field.call);
      pending.push(field.fieldLayout);
    }
  }
  return Object.freeze({
    references: createMemoryReferencePlan(source, program, names, required),
    metadata: createTsonicMemoryMetadataIndex(source),
    requiresCodec: (subject: Node) => required.has(subject),
  });
}
