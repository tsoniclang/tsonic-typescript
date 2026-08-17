import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
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

export type RepresentationProjectionDecision =
  | {
      readonly kind: "optimized";
      readonly call: Node;
      readonly rewrite: RepresentationProjectionRewrite;
    }
  | {
      readonly kind: "retained";
      readonly call: Node;
      readonly candidate: "identity" | "inverse";
      readonly reason: RepresentationProjectionRetentionReason;
    };

export interface RepresentationProjectionPlan {
  readonly profile: RepresentationProjectionProfile;
  readonly identityCandidateCount: number;
  readonly inverseCandidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly decisions: readonly RepresentationProjectionDecision[];
  readonly retentions: readonly Extract<
    RepresentationProjectionDecision,
    { readonly kind: "retained" }
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
): RepresentationProjectionPlan {
  if (profile !== "preserve" && profile !== "closed-direct") {
    throw new Error(`unsupported representation projection profile '${String(profile)}'`);
  }
  const decisions: RepresentationProjectionDecision[] = [];
  const storedCandidates: ProjectionCallShape[] = [];
  let identityCandidateCount = 0;
  let inverseCandidateCount = 0;
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const identity = identityCallArgument(source, program, call);
    if (identity.kind !== "unrelated") {
      identityCandidateCount += 1;
      decisions.push(profile === "preserve"
        ? retained(call, "identity", "profile-preserved")
        : identity.kind === "proved"
        ? optimized(call, "identity", identity.argument)
        : retained(call, "identity", identity.reason));
      continue;
    }
    const projection = projectionCallShape(source, program, call);
    if (projection.kind === "unrelated") {
      continue;
    }
    inverseCandidateCount += 1;
    if (profile === "preserve") {
      decisions.push(retained(call, "inverse", "profile-preserved"));
      continue;
    }
    if (projection.kind === "retained") {
      decisions.push(retained(call, "inverse", projection.reason));
      continue;
    }
    const inverse = inverseProjectionArgument(
      source,
      program,
      projection,
    );
    if (inverse.kind === "proved") {
      decisions.push(optimized(call, "inverse", inverse.argument));
    } else if (inverse.kind === "retained" && inverse.reason !== "unpaired-projection") {
      decisions.push(retained(call, "inverse", inverse.reason));
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
    decisions.push(argument !== undefined && storedFlows.projectionFor(projection.call)
      ? optimized(projection.call, "stored", argument)
      : retained(projection.call, "inverse", "unpaired-projection"));
  }
  return sealPlan(
    source,
    profile,
    identityCandidateCount,
    inverseCandidateCount,
    decisions,
    storedFlows,
    createIdentityCallablePlan(
      source,
      program,
      profile,
      new Set(decisions.flatMap((decision) =>
        decision.kind === "optimized" ? [decision.call] : []
      )),
    ),
  );
}

function sealPlan(
  source: TargetSourceProgram,
  profile: RepresentationProjectionProfile,
  identityCandidateCount: number,
  inverseCandidateCount: number,
  decisions: readonly RepresentationProjectionDecision[],
  storedFlows: StoredRepresentationFlowPlan,
  identityCallables: IdentityCallablePlan,
): RepresentationProjectionPlan {
  const expected = identityCandidateCount + inverseCandidateCount;
  if (decisions.length !== expected) {
    throw new Error(
      `representation decision mismatch: candidates ${expected}, decisions ${decisions.length}`,
    );
  }
  const storedProjectionCount = decisions.filter((decision) =>
    decision.kind === "optimized" && decision.rewrite.kind === "stored"
  ).length;
  if (
    storedProjectionCount !== storedFlows.projectionCount ||
    storedFlows.flowCount !== storedFlows.constructionCount
  ) {
    throw new Error("stored representation decisions are incoherent");
  }
  const byCall = new Map<Node, RepresentationProjectionRewrite>();
  const byFile = new Map<SourceFile, RepresentationProjectionRewrite[]>();
  const retentions: Extract<
    RepresentationProjectionDecision,
    { readonly kind: "retained" }
  >[] = [];
  for (const decision of decisions) {
    if (decision.kind === "retained") {
      retentions.push(decision);
      continue;
    }
    if (byCall.has(decision.call)) {
      throw new Error("one representation call cannot be rewritten twice");
    }
    byCall.set(decision.call, decision.rewrite);
    const sourceFile = source.ast.getSourceFile(decision.call);
    if (sourceFile === undefined) {
      throw new Error("planned representation call has no source file");
    }
    const rewrites = byFile.get(sourceFile);
    if (rewrites === undefined) {
      byFile.set(sourceFile, [decision.rewrite]);
    } else {
      rewrites.push(decision.rewrite);
    }
  }
  if (byCall.size + retentions.length !== expected) {
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
    retainedCount: retentions.length,
    decisions: Object.freeze([...decisions]),
    retentions: Object.freeze(retentions),
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
): RepresentationProjectionDecision {
  return Object.freeze({
    kind: "optimized" as const,
    call,
    rewrite: Object.freeze({ call, kind, argument }),
  });
}

function retained(
  call: Node,
  candidate: "identity" | "inverse",
  reason: RepresentationProjectionRetentionReason,
): RepresentationProjectionDecision {
  return Object.freeze({ kind: "retained" as const, call, candidate, reason });
}
