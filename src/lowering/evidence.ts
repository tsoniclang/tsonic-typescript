import type { PointerFlowBlocker } from "./pointer/flow-graph.js";
import type { OptimizationOccurrence } from "./occurrence.js";
import type {
  ClosedPointerFlowPlan,
  PointerFlowRepresentation,
} from "./pointer/flow-plan.js";
import type { TypeScriptOptimizationProfile } from "./profile.js";
import type { ScalarRepresentationPlan } from "./scalar/plan.js";
import type {
  CooperativeEffectFallbackReason,
  CooperativeEffectPlanSummary,
} from "./effect/fallback.js";

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
}

export type CooperativeEffectOptimizationEvidence =
  | {
      readonly profile: "preserve";
      readonly analyzed: false;
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
    };

export interface TypeScriptOptimizationEvidence {
  readonly schemaVersion: 4;
  readonly pointer: PointerOptimizationEvidence;
  readonly scalar: ScalarOptimizationEvidence;
  readonly cooperativeEffects: CooperativeEffectOptimizationEvidence;
}

export function createTypeScriptOptimizationEvidence(
  profile: TypeScriptOptimizationProfile,
  pointerPlan: ClosedPointerFlowPlan | undefined,
  scalarPlan: ScalarRepresentationPlan,
  effectSummary: CooperativeEffectPlanSummary | undefined,
): TypeScriptOptimizationEvidence {
  return Object.freeze({
    schemaVersion: 4 as const,
    pointer: pointerEvidence(profile, pointerPlan),
    scalar: Object.freeze({
      profile: profile.scalarProjections,
      syntacticProjectionCount: scalarPlan.syntacticProjectionCount,
      optimizedProjectionCount: scalarPlan.projectionCount,
      retainedProjectionCount: scalarPlan.retainedProjectionCount,
    }),
    cooperativeEffects: effectEvidence(profile, effectSummary),
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
    return Object.freeze({ profile: "preserve", analyzed: false });
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
