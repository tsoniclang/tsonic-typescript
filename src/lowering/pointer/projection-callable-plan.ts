import {
  pointerOperationFactKey,
  type Node,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { SourceIdentityResolver } from "../occurrence.js";
import type { TypeScriptPointerFlowProfile } from "../profile.js";
import type { TargetProgramIndex } from "../program-index.js";
import {
  createOptimizationRetentionLedger,
  type BoundedOptimizationReasonEvidence,
} from "../retention-evidence.js";
import { createRepresentationBindingProof } from "../representation/binding-proof.js";
import { forwardingCallableTarget } from "../representation/shape.js";

export const projectionCallableRetentionReasons = Object.freeze([
  "profile-preserved",
  "open-call",
  "unstable-binding",
] as const);

export type ProjectionCallableRetentionReason =
  typeof projectionCallableRetentionReasons[number];

export interface ProjectionCallableTargets {
  readonly fromSource?: Node;
  readonly toSource?: Node;
}

export interface PointerProjectionCallablePlan {
  readonly profile: TypeScriptPointerFlowProfile;
  readonly candidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    ProjectionCallableRetentionReason
  >[];
  owns(candidate: TargetSourceProgram): boolean;
  targetsFor(call: Node): ProjectionCallableTargets | undefined;
}

export function createPointerProjectionCallablePlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  profile: TypeScriptPointerFlowProfile,
  sourceIdentityFor: SourceIdentityResolver,
): PointerProjectionCallablePlan {
  const bindingProof = createRepresentationBindingProof(source, program);
  const retentions = createOptimizationRetentionLedger(
    source,
    sourceIdentityFor,
    projectionCallableRetentionReasons,
  );
  const selected = new Map<Node, ProjectionCallableTargets>();
  let candidateCount = 0;
  let optimizedCount = 0;
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const operation = source.sourceFacts.getFact(call, pointerOperationFactKey);
    if (operation?.operation !== "project-pointer") {
      continue;
    }
    const fromSource = decide(operation.fromSourceExpression);
    const toSource = decide(operation.toSourceExpression);
    if (fromSource !== undefined || toSource !== undefined) {
      selected.set(call, Object.freeze({
        ...(fromSource === undefined ? {} : { fromSource }),
        ...(toSource === undefined ? {} : { toSource }),
      }));
    }
  }
  const fallbackReasons = retentions.seal();
  if (
    optimizedCount + retentions.count !== candidateCount ||
    fallbackReasons.reduce((sum, row) => sum + row.count, 0) !== retentions.count
  ) {
    throw new Error("pointer projection-callable decisions are incoherent");
  }
  return Object.freeze({
    profile,
    candidateCount,
    optimizedCount,
    retainedCount: retentions.count,
    fallbackReasons,
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    targetsFor(call: Node): ProjectionCallableTargets | undefined {
      return selected.get(call);
    },
  });

  function decide(expression: Node): Node | undefined {
    const shape = forwardingCallableTarget(source, program, bindingProof, expression);
    if (shape.kind === "unrelated") {
      return undefined;
    }
    candidateCount += 1;
    if (profile !== "closed-direct") {
      retentions.record("profile-preserved", expression);
      return undefined;
    }
    if (shape.kind === "retained") {
      retentions.record(shape.reason, expression);
      return undefined;
    }
    optimizedCount += 1;
    return shape.target;
  }
}
