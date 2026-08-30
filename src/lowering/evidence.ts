import type { PointerFlowBlocker } from "./pointer/flow-graph.js";
import type {
  ClosedPointerFlowPlan,
  PointerFlowRepresentation,
} from "./pointer/flow-plan.js";
import type { PointerFlowFamilyHotspot } from "./pointer/flow-family-hotspots.js";
import type {
  PointerProjectionCallablePlan,
  ProjectionCallableRetentionReason,
} from "./pointer/projection-callable-plan.js";
import type { OptimizationOccurrence } from "./occurrence.js";
import type { TypeScriptOptimizationProfile } from "./profile.js";
import {
  canonicalRepresentationTransportContract,
  type RepresentationTransportContract,
} from "./representation/transport-contract.js";
import type {
  TypeScriptSourceExecutionProfile,
} from "../source-contract/execution.js";
import type { TargetProgramIndexOperations } from "./program-index.js";
import type {
  IdentityCallableRetentionReason,
} from "./representation/callable-plan.js";
import type {
  RepresentationProjectionPlan,
  RepresentationProjectionRetentionReason,
} from "./representation/plan.js";
import type {
  DirectLogicalFieldRetentionReason,
} from "./representation/field/shape.js";
import type { ScalarClassRetentionReason } from "./scalar/class-flow.js";
import type {
  ScalarProjectionRetentionReason,
  ScalarRepresentationPlan,
} from "./scalar/plan.js";

export interface OptimizationCount<Value extends string> {
  readonly value: Value;
  readonly count: number;
}

export interface OptimizationReasonEvidence<Reason extends string> {
  readonly reason: Reason;
  readonly count: number;
  readonly examples: readonly OptimizationOccurrence[];
}

export type PointerOptimizationEvidence =
  | {
      readonly profile: "location";
      readonly analyzed: false;
      readonly projectionCallables: ProjectionCallableOptimizationEvidence;
    }
  | {
      readonly profile: "closed-direct";
      readonly analyzed: true;
      readonly componentCount: number;
      readonly optimizedComponentCount: number;
      readonly optimizedFamilyCount: number;
      readonly retainedFamilyCount: number;
      readonly retainedFamilyHotspots: readonly PointerFlowFamilyHotspot[];
      readonly directObjectReplacementCount: number;
      readonly optimizedProjectionReadCount: number;
      readonly optimizedProjectionStoreCount: number;
      readonly optimizedProjectedPropertyLocationCount: number;
      readonly optimizedPointerKeyMapCount: number;
      readonly representations: readonly OptimizationCount<
        PointerFlowRepresentation
      >[];
      readonly fallbackReasons: readonly OptimizationReasonEvidence<
        PointerFlowBlocker
      >[];
      readonly familyFallbackReasons: readonly OptimizationReasonEvidence<
        PointerFlowBlocker
      >[];
      readonly projectionCallables: ProjectionCallableOptimizationEvidence;
    };

export interface ProjectionCallableOptimizationEvidence {
  readonly candidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly fallbackReasons: readonly OptimizationReasonEvidence<
    ProjectionCallableRetentionReason
  >[];
}

export interface ScalarOptimizationEvidence {
  readonly profile: TypeScriptOptimizationProfile["scalarProjections"];
  readonly syntacticProjectionCount: number;
  readonly optimizedProjectionCount: number;
  readonly retainedProjectionCount: number;
  readonly fallbackReasons: readonly OptimizationReasonEvidence<
    ScalarProjectionRetentionReason
  >[];
  readonly scalarClassCandidateCount: number;
  readonly loweredScalarClassCount: number;
  readonly retainedScalarClassCount: number;
  readonly scalarClassFallbackReasons: readonly OptimizationReasonEvidence<
    ScalarClassRetentionReason
  >[];
}

export interface RepresentationProjectionOptimizationEvidence {
  readonly profile: TypeScriptOptimizationProfile["representationProjections"];
  readonly identityCandidateCount: number;
  readonly inverseCandidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly fallbackReasons: readonly OptimizationReasonEvidence<
    RepresentationProjectionRetentionReason
  >[];
  readonly storedFlows: {
    readonly flowCount: number;
    readonly constructionCount: number;
    readonly projectionCount: number;
  };
  readonly identityCallables: {
    readonly candidateCount: number;
    readonly optimizedCount: number;
    readonly retainedCount: number;
    readonly fallbackReasons: readonly OptimizationReasonEvidence<
      IdentityCallableRetentionReason
    >[];
  };
  readonly directLogicalFields: {
    readonly candidateCount: number;
    readonly optimizedCount: number;
    readonly retainedCount: number;
    readonly fallbackReasons: readonly OptimizationReasonEvidence<
      DirectLogicalFieldRetentionReason
    >[];
  };
}

export interface TypeScriptOptimizationEvidence {
  readonly schemaVersion: 30;
  readonly sourceExecution: TypeScriptSourceExecutionProfile;
  readonly profileIdentity: string;
  readonly sourceMembership: readonly string[];
  readonly programIndex: TargetProgramIndexOperations;
  readonly pointer: PointerOptimizationEvidence;
  readonly scalar: ScalarOptimizationEvidence;
  readonly representationProjections: RepresentationProjectionOptimizationEvidence;
  readonly representationTransports: {
    readonly digest: string;
    readonly contractCount: number;
    readonly selectedCallCount: number;
  };
}

export function createTypeScriptOptimizationEvidence(
  sourceExecution: TypeScriptSourceExecutionProfile,
  profile: TypeScriptOptimizationProfile,
  sourceMembership: readonly string[],
  programIndex: TargetProgramIndexOperations,
  pointerPlan: ClosedPointerFlowPlan | undefined,
  pointerProjectionCallables: PointerProjectionCallablePlan,
  scalarPlan: ScalarRepresentationPlan,
  representationPlan: RepresentationProjectionPlan,
  representationTransports: RepresentationTransportContract =
    canonicalRepresentationTransportContract(),
): TypeScriptOptimizationEvidence {
  return Object.freeze({
    schemaVersion: 30 as const,
    sourceExecution,
    profileIdentity: profile.identity,
    sourceMembership: Object.freeze([...sourceMembership]),
    programIndex,
    pointer: pointerEvidence(
      profile,
      pointerPlan,
      pointerProjectionCallables,
    ),
    scalar: scalarEvidence(profile, scalarPlan),
    representationProjections: representationEvidence(
      profile,
      representationPlan,
    ),
    representationTransports: Object.freeze({
      digest: representationTransports.digest,
      contractCount: representationTransports.callables.length,
      selectedCallCount: pointerPlan?.representationTransportCallCount ?? 0,
    }),
  });
}

function representationEvidence(
  profile: TypeScriptOptimizationProfile,
  plan: RepresentationProjectionPlan,
): RepresentationProjectionOptimizationEvidence {
  if (
    plan.profile !== profile.representationProjections ||
    plan.optimizedCount + plan.retainedCount !==
      plan.identityCandidateCount + plan.inverseCandidateCount
  ) {
    throw new Error(
      "representation evidence received an incoherent decision plan",
    );
  }
  if (
    plan.fallbackReasons.reduce((total, entry) => total + entry.count, 0) !==
      plan.retainedCount
  ) {
    throw new Error("representation evidence lost a decision row");
  }
  if (
    plan.identityCallables.optimizedCount +
        plan.identityCallables.retainedCount !==
      plan.identityCallables.candidateCount ||
    plan.identityCallables.fallbackReasons.reduce(
        (total, entry) => total + entry.count,
        0,
      ) !== plan.identityCallables.retainedCount
  ) {
    throw new Error("identity-callable evidence lost a decision row");
  }
  if (
    plan.directLogicalFields.optimizedCount +
        plan.directLogicalFields.retainedCount !==
      plan.directLogicalFields.candidateCount ||
    plan.directLogicalFields.fallbackReasons.reduce(
        (total, entry) => total + entry.count,
        0,
      ) !== plan.directLogicalFields.retainedCount
  ) {
    throw new Error("direct logical-field evidence lost a decision row");
  }
  return Object.freeze({
    profile: plan.profile,
    identityCandidateCount: plan.identityCandidateCount,
    inverseCandidateCount: plan.inverseCandidateCount,
    optimizedCount: plan.optimizedCount,
    retainedCount: plan.retainedCount,
    fallbackReasons: plan.fallbackReasons,
    storedFlows: Object.freeze({
      flowCount: plan.storedFlows.flowCount,
      constructionCount: plan.storedFlows.constructionCount,
      projectionCount: plan.storedFlows.projectionCount,
    }),
    identityCallables: Object.freeze({
      candidateCount: plan.identityCallables.candidateCount,
      optimizedCount: plan.identityCallables.optimizedCount,
      retainedCount: plan.identityCallables.retainedCount,
      fallbackReasons: plan.identityCallables.fallbackReasons,
    }),
    directLogicalFields: Object.freeze({
      candidateCount: plan.directLogicalFields.candidateCount,
      optimizedCount: plan.directLogicalFields.optimizedCount,
      retainedCount: plan.directLogicalFields.retainedCount,
      fallbackReasons: plan.directLogicalFields.fallbackReasons,
    }),
  });
}

function scalarEvidence(
  profile: TypeScriptOptimizationProfile,
  plan: ScalarRepresentationPlan,
): ScalarOptimizationEvidence {
  if (
    plan.profile !== profile.scalarProjections ||
    plan.projectionCount + plan.retainedProjectionCount !==
      plan.syntacticProjectionCount
  ) {
    throw new Error("scalar evidence received an incoherent decision plan");
  }
  if (
    plan.fallbackReasons.reduce((total, entry) => total + entry.count, 0) !==
      plan.retainedProjectionCount
  ) {
    throw new Error("scalar retention evidence lost a decision row");
  }
  if (
    plan.scalarClassFallbackReasons.reduce(
        (total, entry) => total + entry.count,
        0,
      ) !== plan.retainedScalarClassCount ||
    plan.loweredScalarClassCount + plan.retainedScalarClassCount !==
      plan.scalarClassCandidateCount
  ) {
    throw new Error("scalar class evidence lost a decision row");
  }
  return Object.freeze({
    profile: profile.scalarProjections,
    syntacticProjectionCount: plan.syntacticProjectionCount,
    optimizedProjectionCount: plan.projectionCount,
    retainedProjectionCount: plan.retainedProjectionCount,
    fallbackReasons: plan.fallbackReasons,
    scalarClassCandidateCount: plan.scalarClassCandidateCount,
    loweredScalarClassCount: plan.loweredScalarClassCount,
    retainedScalarClassCount: plan.retainedScalarClassCount,
    scalarClassFallbackReasons: plan.scalarClassFallbackReasons,
  });
}

function pointerEvidence(
  profile: TypeScriptOptimizationProfile,
  plan: ClosedPointerFlowPlan | undefined,
  projectionCallables: PointerProjectionCallablePlan,
): PointerOptimizationEvidence {
  const callables = projectionCallableEvidence(
    profile,
    projectionCallables,
  );
  if (profile.pointerFlows === "location") {
    if (plan !== undefined) {
      throw new Error(
        "canonical pointer profile cannot carry a closed-flow plan",
      );
    }
    return Object.freeze({
      profile: "location",
      analyzed: false,
      projectionCallables: callables,
    });
  }
  if (plan === undefined) {
    throw new Error("closed pointer profile requires a closed-flow plan");
  }
  return Object.freeze({
    profile: "closed-direct",
    analyzed: true,
    componentCount: plan.components.length,
    optimizedComponentCount: plan.optimizedComponentCount,
    optimizedFamilyCount: plan.optimizedFamilyCount,
    retainedFamilyCount: plan.retainedFamilyCount,
    retainedFamilyHotspots: plan.retainedFamilyHotspots,
    directObjectReplacementCount: plan.directObjectReplacementCount,
    optimizedProjectionReadCount: plan.optimizedProjectionReadCount,
    optimizedProjectionStoreCount: plan.optimizedProjectionStoreCount,
    optimizedProjectedPropertyLocationCount:
      plan.optimizedProjectedPropertyLocationCount,
    optimizedPointerKeyMapCount: plan.optimizedPointerKeyMapCount,
    representations: countValues(
      plan.components.map((component) => component.representation),
    ),
    fallbackReasons: plan.fallbackReasons,
    familyFallbackReasons: plan.familyFallbackReasons,
    projectionCallables: callables,
  });
}

function projectionCallableEvidence(
  profile: TypeScriptOptimizationProfile,
  plan: PointerProjectionCallablePlan,
): ProjectionCallableOptimizationEvidence {
  if (
    plan.profile !== profile.pointerFlows ||
    plan.optimizedCount + plan.retainedCount !== plan.candidateCount ||
    plan.fallbackReasons.reduce((sum, row) => sum + row.count, 0) !==
      plan.retainedCount
  ) {
    throw new Error("pointer projection-callable evidence is incoherent");
  }
  return Object.freeze({
    candidateCount: plan.candidateCount,
    optimizedCount: plan.optimizedCount,
    retainedCount: plan.retainedCount,
    fallbackReasons: plan.fallbackReasons,
  });
}

function countValues<Value extends string>(
  values: readonly Value[],
): readonly OptimizationCount<Value>[] {
  const counts = new Map<Value, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze([...counts]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([value, count]) => Object.freeze({ value, count })));
}
