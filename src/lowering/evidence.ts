import type { PointerFlowBlocker } from "./pointer/flow-graph.js";
import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "./occurrence.js";
import type { TargetSourceProgram } from "@tsonic/target-api";
import type {
  ClosedPointerFlowPlan,
  PointerFlowRepresentation,
} from "./pointer/flow-plan.js";
import type { TypeScriptOptimizationProfile } from "./profile.js";
import {
  scalarProjectionRetentionReasons,
  type ScalarProjectionRetentionReason,
  type ScalarRepresentationPlan,
} from "./scalar/plan.js";
import {
  scalarClassRetentionReasons,
  type ScalarClassRetentionReason,
} from "./scalar/class-flow.js";
import type { TargetProgramIndexOperations } from "./program-index.js";
import type {
  CooperativeEffectFallbackReason,
  CooperativeEffectPlanSummary,
} from "./effect/fallback.js";
import type { InterfaceDispatchEvidence } from "./effect/interface-dispatch.js";

export interface OptimizationCount<Value extends string> {
  readonly value: Value;
  readonly count: number;
}

export interface OptimizationReasonEvidence<Reason extends string> {
  readonly reason: Reason;
  readonly count: number;
  readonly examples: readonly OptimizationOccurrence[];
}

export interface OptimizationPropagatedReasonCount<Reason extends string> {
  readonly reason: Reason;
  readonly directCount: number;
  readonly retainedCount: number;
  readonly directExamples: readonly import("./effect/fallback.js").CooperativeEffectFallbackOccurrence[];
}

export type PointerOptimizationEvidence =
  | {
      readonly profile: "location";
      readonly analyzed: false;
    }
  | {
      readonly profile: "closed-direct";
      readonly analyzed: true;
      readonly componentCount: number;
      readonly optimizedComponentCount: number;
      readonly optimizedFamilyCount: number;
      readonly optimizedProjectionReadCount: number;
      readonly optimizedProjectionStoreCount: number;
      readonly representations: readonly OptimizationCount<PointerFlowRepresentation>[];
      readonly fallbackReasons: readonly OptimizationReasonEvidence<PointerFlowBlocker>[];
      readonly familyFallbackReasons: readonly OptimizationReasonEvidence<PointerFlowBlocker>[];
    };

export interface ScalarOptimizationEvidence {
  readonly profile: TypeScriptOptimizationProfile["scalarProjections"];
  readonly syntacticProjectionCount: number;
  readonly optimizedProjectionCount: number;
  readonly retainedProjectionCount: number;
  readonly fallbackReasons: readonly OptimizationReasonEvidence<ScalarProjectionRetentionReason>[];
  readonly scalarClassCandidateCount: number;
  readonly loweredScalarClassCount: number;
  readonly retainedScalarClassCount: number;
  readonly scalarClassFallbackReasons: readonly OptimizationReasonEvidence<ScalarClassRetentionReason>[];
}

export type CooperativeEffectOptimizationEvidence =
  | {
      readonly profile: "preserve";
      readonly analyzed: false;
      readonly interfaceDispatch: InterfaceDispatchEvidence;
    }
  | {
      readonly profile: "closed-direct";
      readonly analyzed: true;
      readonly candidateCount: number;
      readonly settledCallableCount: number;
      readonly retainedCallableCount: number;
      readonly settledAwaitCount: number;
      readonly fallbackReasons: readonly OptimizationPropagatedReasonCount<CooperativeEffectFallbackReason>[];
      readonly propagation: {
        readonly vertexCount: number;
        readonly edgeCount: number;
        readonly workCount: number;
      };
      readonly resultConsumption: {
        readonly callEntries: number;
        readonly referenceEntries: number;
        readonly ownerEvaluations: number;
        readonly consumerEdges: number;
      };
      readonly interfaceDispatch: InterfaceDispatchEvidence;
    };

export interface TypeScriptOptimizationEvidence {
  readonly schemaVersion: 11;
  readonly profileIdentity: string;
  readonly sourceMembership: readonly string[];
  readonly programIndex: TargetProgramIndexOperations;
  readonly pointer: PointerOptimizationEvidence;
  readonly scalar: ScalarOptimizationEvidence;
  readonly cooperativeEffects: CooperativeEffectOptimizationEvidence;
}

export function createTypeScriptOptimizationEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  profile: TypeScriptOptimizationProfile,
  sourceMembership: readonly string[],
  programIndex: TargetProgramIndexOperations,
  pointerPlan: ClosedPointerFlowPlan | undefined,
  scalarPlan: ScalarRepresentationPlan,
  effectSummary: CooperativeEffectPlanSummary | undefined,
): TypeScriptOptimizationEvidence {
  return Object.freeze({
    schemaVersion: 11 as const,
    profileIdentity: profile.identity,
    sourceMembership: Object.freeze([...sourceMembership]),
    programIndex,
    pointer: pointerEvidence(profile, pointerPlan),
    scalar: scalarEvidence(source, sourceIdentityFor, profile, scalarPlan),
    cooperativeEffects: effectEvidence(profile, effectSummary),
  });
}

function scalarEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
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
  const byReason = new Map<
    ScalarProjectionRetentionReason,
    OptimizationOccurrence[]
  >();
  for (const retention of plan.retentions) {
    const occurrences = byReason.get(retention.reason);
    const occurrence = optimizationOccurrence(
      source,
      retention.access,
      sourceIdentityFor,
    );
    if (occurrences === undefined) {
      byReason.set(retention.reason, [occurrence]);
    } else {
      occurrences.push(occurrence);
    }
  }
  const fallbackReasons = scalarProjectionRetentionReasons.flatMap((reason) => {
    const occurrences = byReason.get(reason);
    return occurrences === undefined
      ? []
      : [Object.freeze({
          reason,
          count: occurrences.length,
          examples: Object.freeze(
            [...occurrences]
              .sort(compareOptimizationOccurrences)
              .slice(0, 8),
          ),
        })];
  });
  const retainedTotal = fallbackReasons.reduce(
    (total, entry) => total + entry.count,
    0,
  );
  if (retainedTotal !== plan.retainedProjectionCount) {
    throw new Error("scalar retention evidence lost a decision row");
  }
  const classByReason = new Map<
    ScalarClassRetentionReason,
    OptimizationOccurrence[]
  >();
  for (const retention of plan.scalarClassRetentions) {
    const occurrence = optimizationOccurrence(
      source,
      retention.declaration,
      sourceIdentityFor,
    );
    const occurrences = classByReason.get(retention.reason);
    if (occurrences === undefined) {
      classByReason.set(retention.reason, [occurrence]);
    } else {
      occurrences.push(occurrence);
    }
  }
  const scalarClassFallbackReasons = scalarClassRetentionReasons.flatMap(
    (reason) => {
      const occurrences = classByReason.get(reason);
      return occurrences === undefined
        ? []
        : [Object.freeze({
            reason,
            count: occurrences.length,
            examples: Object.freeze(
              [...occurrences]
                .sort(compareOptimizationOccurrences)
                .slice(0, 8),
            ),
          })];
    },
  );
  const retainedClassTotal = scalarClassFallbackReasons.reduce(
    (total, entry) => total + entry.count,
    0,
  );
  if (
    retainedClassTotal !== plan.retainedScalarClassCount ||
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
    fallbackReasons: Object.freeze(fallbackReasons),
    scalarClassCandidateCount: plan.scalarClassCandidateCount,
    loweredScalarClassCount: plan.loweredScalarClassCount,
    retainedScalarClassCount: plan.retainedScalarClassCount,
    scalarClassFallbackReasons: Object.freeze(scalarClassFallbackReasons),
  });
}

function pointerEvidence(
  profile: TypeScriptOptimizationProfile,
  plan: ClosedPointerFlowPlan | undefined,
): PointerOptimizationEvidence {
  if (profile.pointerFlows === "location") {
    if (plan !== undefined) {
      throw new Error("canonical pointer profile cannot carry a closed-flow plan");
    }
    return Object.freeze({ profile: "location", analyzed: false });
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
    optimizedProjectionReadCount: plan.optimizedProjectionReadCount,
    optimizedProjectionStoreCount: plan.optimizedProjectionStoreCount,
    representations: countValues(
      plan.components.map((component) => component.representation),
    ),
    fallbackReasons: plan.fallbackReasons,
    familyFallbackReasons: plan.familyFallbackReasons,
  });
}

function effectEvidence(
  profile: TypeScriptOptimizationProfile,
  summary: CooperativeEffectPlanSummary | undefined,
): CooperativeEffectOptimizationEvidence {
  if (profile.cooperativeEffects === "preserve") {
    if (summary !== undefined) {
      throw new Error("preserved cooperative effects cannot carry a closed plan");
    }
    return Object.freeze({
      profile: "preserve",
      analyzed: false,
      interfaceDispatch: Object.freeze({
        profile: profile.interfaceDispatch,
        analyzed: false,
      }),
    });
  }
  if (summary === undefined) {
    throw new Error("closed cooperative effects require a closed plan");
  }
  return Object.freeze({
    profile: "closed-direct",
    analyzed: true,
    candidateCount: summary.candidateCount,
    settledCallableCount: summary.settledCallableCount,
    retainedCallableCount: summary.retainedCallableCount,
    settledAwaitCount: summary.settledAwaitCount,
    fallbackReasons: Object.freeze(summary.fallbackReasons.map((entry) =>
      Object.freeze({
        reason: entry.reason,
        directCount: entry.directCallableCount,
        retainedCount: entry.retainedCallableCount,
        directExamples: entry.directExamples,
      })
    )),
    propagation: Object.freeze({
      vertexCount: summary.propagation.vertices,
      edgeCount: summary.propagation.edges,
      workCount: summary.propagation.work,
    }),
    resultConsumption: summary.resultConsumption,
    interfaceDispatch: summary.interfaceDispatch,
  });
}

function countValues<Value extends string>(
  values: readonly Value[],
): readonly OptimizationCount<Value>[] {
  return counted(values).map(([value, count]) => Object.freeze({ value, count }));
}

function counted<Value extends string>(
  values: readonly Value[],
): readonly (readonly [Value, number])[] {
  const counts = new Map<Value, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze([...counts]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([value, count]) => Object.freeze([value, count] as const)));
}
