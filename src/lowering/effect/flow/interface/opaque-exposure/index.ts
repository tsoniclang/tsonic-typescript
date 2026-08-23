import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { InterfaceContractRelevance } from "../relevance.js";
import { analyzeOpaqueInterfaceInputs } from "../opaque-exposure.js";
import type { OpaqueInterfaceExposureSink } from "./model.js";
import { sourceContainsRelevantContracts } from "./relevance.js";

export interface OpaqueInterfaceExposureMeasurements {
  readonly opaqueQueries: number;
  readonly opaqueExpansions: number;
  readonly planQueries: number;
  readonly planExpansions: number;
}

export interface OpaqueInterfaceExposureIndex {
  sourceContains(
    semantics: SourceFileSemantics,
    source: Type,
  ): boolean;
  retainInputs(
    semantics: SourceFileSemantics,
    source: Type,
    target: Type,
    sourceIsFresh: boolean,
    sink: OpaqueInterfaceExposureSink,
  ): void;
  measurements(): OpaqueInterfaceExposureMeasurements;
}

interface OpaqueInterfaceExposurePlan {
  readonly opaqueInputs: readonly Node[];
  readonly contractRoots: readonly Type[];
  readonly valueContractRoots: readonly Type[];
}

interface OpaqueInterfaceExposureFileCache {
  readonly relevance: Map<Type, boolean>;
  readonly freshPlans: Map<Type, Map<Type, OpaqueInterfaceExposurePlan>>;
  readonly sharedPlans: Map<Type, Map<Type, OpaqueInterfaceExposurePlan>>;
}

const emptyPlan: OpaqueInterfaceExposurePlan = Object.freeze({
  opaqueInputs: Object.freeze([]),
  contractRoots: Object.freeze([]),
  valueContractRoots: Object.freeze([]),
});

export function createOpaqueInterfaceExposureIndex(
  source: TargetSourceProgram,
  relevance: InterfaceContractRelevance,
): OpaqueInterfaceExposureIndex {
  const files = new WeakMap<Node, OpaqueInterfaceExposureFileCache>();
  let opaqueQueries = 0;
  let opaqueExpansions = 0;
  let planQueries = 0;
  let planExpansions = 0;
  const cacheFor = (
    semantics: SourceFileSemantics,
  ): OpaqueInterfaceExposureFileCache => {
    let cache = files.get(semantics.sourceFile);
    if (cache === undefined) {
      cache = {
        relevance: new Map(),
        freshPlans: new Map(),
        sharedPlans: new Map(),
      };
      files.set(semantics.sourceFile, cache);
    }
    return cache;
  };
  const sourceContains = (
    semantics: SourceFileSemantics,
    selectedSource: Type,
  ): boolean => {
    opaqueQueries += 1;
    const cache = cacheFor(semantics).relevance;
    if (!cache.has(selectedSource)) {
      opaqueExpansions += 1;
    }
    return sourceContainsRelevantContracts(
      semantics,
      selectedSource,
      relevance,
      cache,
    );
  };
  return Object.freeze({
    sourceContains,
    retainInputs(
      semantics: SourceFileSemantics,
      sourceType: Type,
      targetType: Type,
      sourceIsFresh: boolean,
      sink: OpaqueInterfaceExposureSink,
    ): void {
      planQueries += 1;
      const selectedSource = semantics.types.withoutMissingOrUndefined(sourceType);
      const selectedTarget = semantics.types.withoutMissingOrUndefined(targetType);
      if (selectedSource === undefined || selectedTarget === undefined) {
        replayPlan(emptyPlan, semantics, sink);
        return;
      }
      const file = cacheFor(semantics);
      const plans = sourceIsFresh ? file.freshPlans : file.sharedPlans;
      let targets = plans.get(selectedSource);
      if (targets === undefined) {
        targets = new Map();
        plans.set(selectedSource, targets);
      }
      let plan = targets.get(selectedTarget);
      if (plan === undefined) {
        planExpansions += 1;
        plan = createPlan(
          source,
          semantics,
          selectedSource,
          selectedTarget,
          sourceIsFresh,
          relevance,
          file.relevance,
        );
        targets.set(selectedTarget, plan);
      }
      replayPlan(plan, semantics, sink);
    },
    measurements(): OpaqueInterfaceExposureMeasurements {
      return Object.freeze({
        opaqueQueries,
        opaqueExpansions,
        planQueries,
        planExpansions,
      });
    },
  });
}

function createPlan(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceIsFresh: boolean,
  relevance: InterfaceContractRelevance,
  relevanceCache: Map<Type, boolean>,
): OpaqueInterfaceExposurePlan {
  const opaqueInputs = new Set<Node>();
  const contractRoots = new Set<Type>();
  const valueContractRoots = new Set<Type>();
  analyzeOpaqueInterfaceInputs(
    source,
    semantics,
    sourceType,
    targetType,
    sourceIsFresh,
    relevance,
    relevanceCache,
    {
      markOpaqueInput(declaration) {
        opaqueInputs.add(declaration);
      },
      markExposedContracts(_semantics, root) {
        contractRoots.add(root);
      },
      markExposedValueContracts(_semantics, root) {
        valueContractRoots.add(root);
      },
    },
  );
  return Object.freeze({
    opaqueInputs: Object.freeze([...opaqueInputs]),
    contractRoots: Object.freeze([...contractRoots]),
    valueContractRoots: Object.freeze([...valueContractRoots]),
  });
}

function replayPlan(
  plan: OpaqueInterfaceExposurePlan,
  semantics: SourceFileSemantics,
  sink: OpaqueInterfaceExposureSink,
): void {
  for (const declaration of plan.opaqueInputs) {
    sink.markOpaqueInput(declaration);
  }
  for (const root of plan.contractRoots) {
    sink.markExposedContracts(semantics, root);
  }
  for (const root of plan.valueContractRoots) {
    sink.markExposedValueContracts(semantics, root);
  }
}
