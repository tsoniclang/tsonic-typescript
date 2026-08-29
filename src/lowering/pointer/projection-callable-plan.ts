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
import {
  forwardedStorageProjectionPair,
  forwardingCallableTarget,
  type ForwardedStorageProjectionPair,
  type ForwardingCallableShapeResult,
} from "../representation/shape.js";

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
  readonly exactProjectionCount: number;
  owns(candidate: TargetSourceProgram): boolean;
  targetsFor(call: Node): ProjectionCallableTargets | undefined;
  exactProjectionFor(call: Node): ForwardedStorageProjectionPair | undefined;
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
  const exactProjections = new Map<Node, ForwardedStorageProjectionPair>();
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
        ...(fromSource === undefined ? {} : { fromSource: fromSource.target }),
        ...(toSource === undefined ? {} : { toSource: toSource.target }),
      }));
    }
    if (fromSource !== undefined && toSource !== undefined) {
      const pair = forwardedStorageProjectionPair(
        source,
        program,
        bindingProof,
        fromSource,
        toSource,
      );
      if (pair !== undefined) {
        exactProjections.set(call, pair);
      }
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
    exactProjectionCount: exactProjections.size,
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    targetsFor(call: Node): ProjectionCallableTargets | undefined {
      return selected.get(call);
    },
    exactProjectionFor(call: Node): ForwardedStorageProjectionPair | undefined {
      return exactProjections.get(call);
    },
  });

  function decide(
    expression: Node,
  ): Extract<ForwardingCallableShapeResult, { readonly kind: "proved" }> | undefined {
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
    return shape;
  }
}
