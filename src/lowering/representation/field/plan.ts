import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindPropertyAccessExpression } from "@tsonic/tsts/target-ast";

import type { SourceIdentityResolver } from "../../occurrence.js";
import type { TargetProgramIndex } from "../../program-index.js";
import {
  createOptimizationRetentionLedger,
  type BoundedOptimizationReasonEvidence,
} from "../../retention-evidence.js";
import type { RepresentationBindingProof } from "../binding-proof.js";
import {
  directLogicalFieldRetentionReasons,
  createDirectLogicalFieldShapeResolver,
  type DirectLogicalFieldRetentionReason,
  type DirectLogicalFieldShapeStatistics,
} from "./shape.js";

export interface DirectLogicalFieldRewrite {
  readonly access: Node;
  readonly projectionCall: Node;
  readonly logicalName: string;
}

export interface DirectLogicalFieldPlan {
  readonly candidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly construction: DirectLogicalFieldShapeStatistics;
  readonly fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    DirectLogicalFieldRetentionReason
  >[];
  ownsProjectionCall(call: Node): boolean;
  rewriteFor(access: Node): DirectLogicalFieldRewrite | undefined;
  rewritesFor(sourceFile: SourceFile): readonly DirectLogicalFieldRewrite[];
}

const noRewrites = Object.freeze([]) as readonly DirectLogicalFieldRewrite[];

export function createDirectLogicalFieldPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindingProof: RepresentationBindingProof,
  profile: "preserve" | "closed-direct",
  sourceIdentityFor: SourceIdentityResolver,
): DirectLogicalFieldPlan {
  const rewrites: DirectLogicalFieldRewrite[] = [];
  const shapes = createDirectLogicalFieldShapeResolver(
    source,
    program,
    bindingProof,
  );
  const retentions = createOptimizationRetentionLedger(
    source,
    sourceIdentityFor,
    directLogicalFieldRetentionReasons,
  );
  let candidateCount = 0;
  for (const access of program.nodesOfKind(KindPropertyAccessExpression)) {
    const result = shapes.resolve(access);
    if (result.kind === "unrelated") {
      continue;
    }
    candidateCount += 1;
    if (profile === "preserve") {
      retentions.record("profile-preserved", access);
      continue;
    }
    if (result.kind === "retained") {
      retentions.record(result.reason, access);
      continue;
    }
    rewrites.push(Object.freeze({
      access,
      projectionCall: result.shape.projection.call,
      logicalName: result.shape.logicalName,
    }));
  }
  return sealPlan(
    source,
    candidateCount,
    rewrites,
    retentions.count,
    retentions.seal(),
    shapes.statistics(),
  );
}

function sealPlan(
  source: TargetSourceProgram,
  candidateCount: number,
  rewrites: readonly DirectLogicalFieldRewrite[],
  retainedCount: number,
  fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    DirectLogicalFieldRetentionReason
  >[],
  construction: DirectLogicalFieldShapeStatistics,
): DirectLogicalFieldPlan {
  if (
    rewrites.length + retainedCount !== candidateCount ||
    fallbackReasons.reduce((sum, row) => sum + row.count, 0) !== retainedCount
  ) {
    throw new Error("direct logical-field decisions do not partition their denominator");
  }
  const byAccess = new Map<Node, DirectLogicalFieldRewrite>();
  const byProjectionCall = new Map<Node, DirectLogicalFieldRewrite>();
  const byFile = new Map<SourceFile, DirectLogicalFieldRewrite[]>();
  for (const rewrite of rewrites) {
    if (
      byAccess.has(rewrite.access) ||
      byProjectionCall.has(rewrite.projectionCall)
    ) {
      throw new Error("one direct logical-field projection was selected twice");
    }
    const sourceFile = source.ast.getSourceFile(rewrite.access);
    if (sourceFile === undefined) {
      throw new Error("direct logical-field projection has no source file");
    }
    byAccess.set(rewrite.access, rewrite);
    byProjectionCall.set(rewrite.projectionCall, rewrite);
    const fileRewrites = byFile.get(sourceFile);
    if (fileRewrites === undefined) {
      byFile.set(sourceFile, [rewrite]);
    } else {
      fileRewrites.push(rewrite);
    }
  }
  const sealedByFile = new Map<SourceFile, readonly DirectLogicalFieldRewrite[]>();
  for (const [sourceFile, fileRewrites] of byFile) {
    sealedByFile.set(sourceFile, Object.freeze([...fileRewrites]));
  }
  return Object.freeze({
    candidateCount,
    optimizedCount: rewrites.length,
    retainedCount,
    fallbackReasons,
    construction,
    ownsProjectionCall(call: Node): boolean {
      return byProjectionCall.has(call);
    },
    rewriteFor(access: Node): DirectLogicalFieldRewrite | undefined {
      return byAccess.get(access);
    },
    rewritesFor(sourceFile: SourceFile): readonly DirectLogicalFieldRewrite[] {
      return sealedByFile.get(sourceFile) ?? noRewrites;
    },
  });
}
