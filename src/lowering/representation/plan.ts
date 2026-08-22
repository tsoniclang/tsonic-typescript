import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { SourceIdentityResolver } from "../occurrence.js";
import type { CooperativeEffectResultProjection } from "../effect/planning/plan.js";
import {
  createOptimizationRetentionLedger,
  type BoundedOptimizationReasonEvidence,
} from "../retention-evidence.js";
import {
  createIdentityCallablePlan,
  type IdentityCallablePlan,
} from "./callable-plan.js";
import {
  identityCallArgument,
  inverseProjectionArgument,
  projectionCallShape,
  type ProjectionCallShape,
} from "./shape.js";
import {
  createStoredRepresentationFlowPlan,
  type StoredRepresentationFlowPlan,
} from "./stored-flow.js";

export type RepresentationProjectionProfile = "preserve" | "closed-direct";

export const representationProjectionRetentionReasons = Object.freeze([
  "profile-preserved",
  "open-call",
  "unstable-binding",
  "unpaired-projection",
  "observable-construction",
  "inexact-storage",
] as const);

export type RepresentationProjectionRetentionReason =
  typeof representationProjectionRetentionReasons[number];

export interface RepresentationProjectionRewrite {
  readonly call: Node;
  readonly kind: "identity" | "inverse" | "stored";
  readonly argument: Node;
}

export interface RepresentationProjectionPlan {
  readonly profile: RepresentationProjectionProfile;
  readonly identityCandidateCount: number;
  readonly inverseCandidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    RepresentationProjectionRetentionReason
  >[];
  readonly identityCallables: IdentityCallablePlan;
  readonly storedFlows: StoredRepresentationFlowPlan;
  rewriteFor(call: Node): RepresentationProjectionRewrite | undefined;
  rewritesFor(sourceFile: SourceFile): readonly RepresentationProjectionRewrite[];
}

const noRewrites = Object.freeze([]) as readonly RepresentationProjectionRewrite[];

export function createRepresentationProjectionPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  profile: RepresentationProjectionProfile,
  sourceIdentityFor: SourceIdentityResolver,
  effectProjection?: CooperativeEffectResultProjection,
): RepresentationProjectionPlan {
  if (profile !== "preserve" && profile !== "closed-direct") {
    throw new Error(`unsupported representation projection profile '${String(profile)}'`);
  }
  const rewrites: RepresentationProjectionRewrite[] = [];
  const retentions = createOptimizationRetentionLedger(
    source,
    sourceIdentityFor,
    representationProjectionRetentionReasons,
  );
  const storedCandidates: ProjectionCallShape[] = [];
  let identityCandidateCount = 0;
  let inverseCandidateCount = 0;
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const identity = identityCallArgument(source, program, call);
    if (identity.kind !== "unrelated") {
      identityCandidateCount += 1;
      if (profile === "preserve") {
        retentions.record("profile-preserved", call);
      } else if (identity.kind === "proved") {
        rewrites.push(optimized(call, "identity", identity.argument));
      } else {
        retentions.record(identity.reason, call);
      }
      continue;
    }
    const projection = projectionCallShape(source, program, call);
    if (projection.kind === "unrelated") {
      continue;
    }
    inverseCandidateCount += 1;
    if (profile === "preserve") {
      retentions.record("profile-preserved", call);
      continue;
    }
    if (projection.kind === "retained") {
      retentions.record(projection.reason, call);
      continue;
    }
    const inverse = inverseProjectionArgument(
      source,
      program,
      projection,
    );
    if (inverse.kind === "proved") {
      rewrites.push(optimized(call, "inverse", inverse.argument));
    } else if (inverse.kind === "retained" && inverse.reason !== "unpaired-projection") {
      retentions.record(inverse.reason, call);
    } else {
      storedCandidates.push(projection);
    }
  }
  const storedFlows = createStoredRepresentationFlowPlan(
    source,
    program,
    storedCandidates,
  );
  for (const projection of storedCandidates) {
    const call = source.ast.as.AsCallExpression(projection.call);
    const argument = call?.Arguments?.Nodes[0];
    if (argument !== undefined && storedFlows.projectionFor(projection.call)) {
      rewrites.push(optimized(projection.call, "stored", argument));
    } else {
      retentions.record("unpaired-projection", projection.call);
    }
  }
  const fallbackReasons = retentions.seal();
  return sealPlan(
    source,
    profile,
    identityCandidateCount,
    inverseCandidateCount,
    rewrites,
    retentions.count,
    fallbackReasons,
    storedFlows,
    createIdentityCallablePlan(
      source,
      program,
      profile,
      new Set(rewrites.map((rewrite) => rewrite.call)),
      sourceIdentityFor,
      effectProjection,
    ),
  );
}

function sealPlan(
  source: TargetSourceProgram,
  profile: RepresentationProjectionProfile,
  identityCandidateCount: number,
  inverseCandidateCount: number,
  rewrites: readonly RepresentationProjectionRewrite[],
  retainedCount: number,
  fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    RepresentationProjectionRetentionReason
  >[],
  storedFlows: StoredRepresentationFlowPlan,
  identityCallables: IdentityCallablePlan,
): RepresentationProjectionPlan {
  const expected = identityCandidateCount + inverseCandidateCount;
  if (rewrites.length + retainedCount !== expected) {
    throw new Error(
      `representation decision mismatch: candidates ${expected}, decisions ${rewrites.length + retainedCount}`,
    );
  }
  const storedProjectionCount = rewrites.filter((rewrite) =>
    rewrite.kind === "stored"
  ).length;
  if (
    storedProjectionCount !== storedFlows.projectionCount ||
    storedFlows.flowCount !== storedFlows.constructionCount
  ) {
    throw new Error("stored representation decisions are incoherent");
  }
  const byCall = new Map<Node, RepresentationProjectionRewrite>();
  const byFile = new Map<SourceFile, RepresentationProjectionRewrite[]>();
  for (const rewrite of rewrites) {
    if (byCall.has(rewrite.call)) {
      throw new Error("one representation call cannot be rewritten twice");
    }
    byCall.set(rewrite.call, rewrite);
    const sourceFile = source.ast.getSourceFile(rewrite.call);
    if (sourceFile === undefined) {
      throw new Error("planned representation call has no source file");
    }
    const rewrites = byFile.get(sourceFile);
    if (rewrites === undefined) {
      byFile.set(sourceFile, [rewrite]);
    } else {
      rewrites.push(rewrite);
    }
  }
  if (
    byCall.size + retainedCount !== expected ||
    fallbackReasons.reduce((sum, row) => sum + row.count, 0) !== retainedCount
  ) {
    throw new Error("representation decisions do not partition their denominator");
  }
  const sealedByFile = new Map<SourceFile, readonly RepresentationProjectionRewrite[]>();
  for (const [sourceFile, rewrites] of byFile) {
    sealedByFile.set(sourceFile, Object.freeze([...rewrites]));
  }
  return Object.freeze({
    profile,
    identityCandidateCount,
    inverseCandidateCount,
    optimizedCount: byCall.size,
    retainedCount,
    fallbackReasons,
    identityCallables,
    storedFlows,
    rewriteFor(call: Node): RepresentationProjectionRewrite | undefined {
      return byCall.get(call);
    },
    rewritesFor(sourceFile: SourceFile): readonly RepresentationProjectionRewrite[] {
      return sealedByFile.get(sourceFile) ?? noRewrites;
    },
  });
}

function optimized(
  call: Node,
  kind: RepresentationProjectionRewrite["kind"],
  argument: Node,
): RepresentationProjectionRewrite {
  return Object.freeze({ call, kind, argument });
}
